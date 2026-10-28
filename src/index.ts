import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { CONFIG } from '../config.ts';
import { pickRepo, toBranchName } from './card.ts';
import { runClaude } from './claude.ts';
import { readVerdict } from './description.ts';
import { BOT_PREFIX, isGitStage, toCardEvent, type AgentStage, type CardEvent, type GitStage, type Stage } from './events.ts';
import { notifyDesktop } from './notify.ts';
import { attachVideos, commitCard, handOverReview, pushCard } from './ship.ts';
import { STAGE_TITLES, SYSTEM_PROMPT, VIDEO_DIR, planStageRun } from './stages.ts';
import { loadState, saveState, type CardState } from './state.ts';
import { trello, type TrelloCard, type TrelloList } from './trello.ts';
import { commitLeftovers, ensureWorktree } from './worktree.ts';

const LOG_DIR = path.resolve(import.meta.dirname, '..', 'logs');
const MAX_COMMENT_LENGTH = 15_000; // Trello's limit is 16384

interface Job {
  cardId: string;
  /** Unset for comments: the card's current list decides. */
  stage?: Stage;
  feedback?: string;
}

const state = loadState();
const queue: Job[] = [];
const running = new Map<string, AbortController>();
let stageByListId: Record<string, Stage>;
let uncommittedListId: string;
let plannedListId: string;
let backlogListId: string;

function findList(lists: TrelloList[], listName: string): TrelloList {
  const list = lists.find((candidate) => candidate.name === listName);
  if (!list) throw new Error(`No list "${listName}" on the board. Lists: ${lists.map((l) => l.name).join(', ')}`);
  return list;
}

function resolveLists(lists: TrelloList[]): Record<string, Stage> {
  const entries = Object.entries(CONFIG.lists).flatMap(([stage, listNames]) =>
    listNames.map((listName) => [findList(lists, listName).id, stage]),
  );
  return Object.fromEntries(entries);
}

/** The stage's first list, where cards are moved to. */
const firstListId = (stage: Stage) => Object.keys(stageByListId).find((listId) => stageByListId[listId] === stage);

async function poll(myMemberId: string): Promise<void> {
  const actions = (await trello.getBoardActions(CONFIG.boardId, state.lastActionId)).reverse();

  // First start: skip history, so old cards don't all start agents at once.
  if (!state.lastActionId) {
    state.lastActionId = actions.at(-1)?.id;
    saveState(state);
    return;
  }

  for (const action of actions) {
    if (action.id <= state.lastActionId) continue;
    const event = toCardEvent(action, stageByListId, myMemberId);
    if (event) schedule(event);
    state.lastActionId = action.id;
  }
  saveState(state);
  startQueuedJobs();
}

function schedule(event: CardEvent): void {
  if (event.kind === 'commented') {
    // Comments wait for a running job instead of interrupting it.
    queue.push({ cardId: event.cardId, feedback: event.text });
    return;
  }
  // A move means you changed your mind: stop whatever this card was doing.
  running.get(event.cardId)?.abort();
  removeQueuedJobs(event.cardId);
  if (event.stage) queue.push({ cardId: event.cardId, stage: event.stage });
}

function removeQueuedJobs(cardId: string): void {
  for (let index = queue.length - 1; index >= 0; index--) {
    if (queue[index].cardId === cardId) queue.splice(index, 1);
  }
}

function startQueuedJobs(): void {
  while (running.size < CONFIG.maxParallelJobs) {
    const index = queue.findIndex((job) => !running.has(job.cardId));
    if (index === -1) return;
    const [job] = queue.splice(index, 1);
    const controller = new AbortController();
    running.set(job.cardId, controller);

    runJob(job, controller.signal)
      .catch((error: Error) => console.error(`Card ${job.cardId}: ${error.message}`))
      .finally(() => {
        running.delete(job.cardId);
        startQueuedJobs();
      });
  }
}

function ensureCardState(card: TrelloCard): CardState {
  const existing = state.cards[card.id];
  if (existing) return existing;

  const repo = pickRepo(card.labels.map((label) => label.name), Object.keys(CONFIG.repos), CONFIG.defaultRepo);
  const cardState: CardState = {
    idShort: card.idShort,
    name: card.name,
    repo,
    branch: toBranchName(card.idShort, card.name),
    worktree: path.join(CONFIG.worktreeRoot, `${repo}-card-${card.idShort}`),
  };
  state.cards[card.id] = cardState;
  return cardState;
}

async function runJob(job: Job, signal: AbortSignal): Promise<void> {
  const card = await trello.getCard(job.cardId);
  const stage = job.stage ?? stageByListId[card.idList] ?? replanStage(card, job);
  if (!stage) return;

  if (card.labels.some((label) => CONFIG.manualLabels.includes(label.name.toLowerCase()))) {
    await trello.addComment(card.id, `${BOT_PREFIX} This card is labeled for manual work, so no agent starts. Move it on yourself when it's done.`);
    return;
  }

  const cardState = ensureCardState(card);
  if (isGitStage(stage)) {
    // Comments never commit or push: only your move into the list does.
    if (job.stage) await runGitStage(stage, card, cardState, signal);
    return;
  }
  const title = `#${card.idShort} ${STAGE_TITLES[stage]}`;
  const logFile = path.join(LOG_DIR, `card-${card.idShort}.log`);
  const run = planStageRun(stage, card, cardState, CONFIG.baseBranch, job.feedback);
  const takeOver = `cd ${cardState.worktree} && claude --resume ${run.sessionId}`;

  cardState.lastStage = stage;
  cardState.lastStatus = 'running';
  if (stage === 'review') cardState.reviewSessionId = run.sessionId;
  else cardState.devSessionId = run.sessionId;
  saveState(state);
  console.log(`${title}: started (log: ${logFile})`);

  try {
    await ensureWorktree(CONFIG.repos[cardState.repo], cardState.worktree, cardState.branch, CONFIG.baseBranch);
    await trello.addComment(card.id, `${BOT_PREFIX} **${STAGE_TITLES[stage]}** started. Follow along: \`tail -f ${logFile}\``);

    const result = await runClaude(
      {
        ...run,
        cwd: cardState.worktree,
        maxBudgetUsd: CONFIG.maxBudgetUsd[stage],
        appendSystemPrompt: SYSTEM_PROMPT,
        logFile,
      },
      signal,
    );
    if (stage !== 'plan') await commitLeftovers(cardState.worktree, `card #${card.idShort}: ${stage} leftovers`);

    const status = result.isSuccess ? 'done' : 'failed';
    const isReady = stage !== 'build' && result.isSuccess && readVerdict(result.text) === 'ready';
    const videoLinks = stage === 'plan' ? [] : await attachVideos(card);
    cardState.lastStatus = status;
    saveState(state);

    const report = result.text.slice(0, MAX_COMMENT_LENGTH);
    await trello.addComment(
      card.id,
      [
        `${BOT_PREFIX} **${STAGE_TITLES[stage]} ${status}** · $${result.costUsd.toFixed(2)}`,
        videoLinks.length ? `🎬 Video: ${videoLinks.join(' · ')}` : '',
        report,
        `---\nBranch \`${cardState.branch}\` · take over: \`${takeOver}\`\n${nextStepHint(stage, result.isSuccess, isReady)}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
    notifyDesktop(`${title} ${status}`, card.name);
    console.log(`${title}: ${status}`);

    const reviewListId = firstListId('review');
    if (result.isSuccess && stage === 'build' && reviewListId) await trello.moveCard(card.id, reviewListId);
    if (result.isSuccess && stage === 'plan') await moveAfterPlan(card, isReady);
    if (isReady && stage === 'review') await handOverReview(card, result.text, videoLinks, uncommittedListId);
  } catch (error) {
    cardState.lastStatus = signal.aborted ? 'stopped' : 'failed';
    saveState(state);
    if (signal.aborted) return console.log(`${title}: stopped because the card moved`);

    await trello.addComment(card.id, `${BOT_PREFIX} **${STAGE_TITLES[stage]} failed** before finishing. See \`${logFile}\` and the daemon output.`);
    notifyDesktop(`${title} failed`, card.name);
    throw error;
  }
}

/** Your comment on a planned card in Backlog (answers) or Ready (changes) plans it again. */
function replanStage(card: TrelloCard, job: Job): Stage | undefined {
  const wasPlanned = state.cards[card.id]?.lastStage === 'plan';
  const isAfterPlan = card.idList === backlogListId || card.idList === plannedListId;
  return job.feedback && wasPlanned && isAfterPlan ? 'plan' : undefined;
}

/** Ready rests until you move it on; Backlog waits for your answer. */
async function moveAfterPlan(card: TrelloCard, isReady: boolean): Promise<void> {
  const listId = isReady ? plannedListId : backlogListId;
  if (card.idList !== listId) await trello.moveCard(card.id, listId);
}

async function runGitStage(stage: GitStage, card: TrelloCard, cardState: CardState, signal: AbortSignal): Promise<void> {
  cardState.lastStage = stage;
  cardState.lastStatus = 'running';
  saveState(state);
  console.log(`#${card.idShort} ${STAGE_TITLES[stage]}`);

  const committedListId = firstListId('commit');
  const isDone =
    stage === 'commit'
      ? await commitCard(card, cardState, uncommittedListId)
      : committedListId && (await pushCard(card, cardState, uncommittedListId, committedListId, signal));
  cardState.lastStatus = isDone ? 'done' : 'failed';
  saveState(state);
}

function nextStepHint(stage: AgentStage, isSuccess: boolean, isReady: boolean): string {
  if (!isSuccess) return 'Next: comment to retry with instructions, or take over in the terminal.';
  const [build, review, commit] = [CONFIG.lists.build?.join(' or '), CONFIG.lists.review?.[0], CONFIG.lists.commit?.[0]];
  if (stage === 'plan' && isReady) return `Moving the card to **${CONFIG.plannedList}**. Move it to **${build}** when you want it built, or comment to change the plan.`;
  if (stage === 'plan') return `Moving the card to **${CONFIG.backlogList}**. Answer the questions in a comment and I plan again.`;
  if (stage === 'build') return `Moving the card to **${review}** for review and docs.`;
  if (isReady) return `Moving the card to **${CONFIG.uncommittedList}**. Check the description and edit the commit message there if you like, then move the card to **${commit}** to commit it.`;
  return `Not ready: comment what to change, or move the card back to **${build}** with a comment.`;
}

async function main(): Promise<void> {
  mkdirSync(LOG_DIR, { recursive: true });
  mkdirSync(CONFIG.worktreeRoot, { recursive: true });
  mkdirSync(VIDEO_DIR, { recursive: true });

  const me = await trello.getMe();
  const lists = await trello.getLists(CONFIG.boardId);
  stageByListId = resolveLists(lists);
  uncommittedListId = findList(lists, CONFIG.uncommittedList).id;
  plannedListId = findList(lists, CONFIG.plannedList).id;
  backlogListId = findList(lists, CONFIG.backlogList).id;
  console.log(`Watching board ${CONFIG.boardId} as @${me.username}. Only your own cards, moves and comments start agents.`);

  while (true) {
    try {
      await poll(me.id);
    } catch (error) {
      console.error(`Poll failed: ${(error as Error).message}`);
    }
    await sleep(CONFIG.pollIntervalSeconds * 1000);
  }
}

await main();
