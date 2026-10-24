import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { CONFIG } from '../config.ts';
import { pickRepo, toBranchName } from './card.ts';
import { runClaude } from './claude.ts';
import { BOT_PREFIX, toCardEvent, type CardEvent, type Stage } from './events.ts';
import { notifyDesktop } from './notify.ts';
import { STAGE_TITLES, SYSTEM_PROMPT, planStageRun } from './stages.ts';
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
let listIdByStage: Record<Stage, string>;
let stageByListId: Record<string, Stage>;

function resolveLists(lists: TrelloList[]): Record<Stage, string> {
  const entries = Object.entries(CONFIG.lists).map(([stage, listName]) => {
    const list = lists.find((candidate) => candidate.name === listName);
    if (!list) throw new Error(`No list "${listName}" on the board. Lists: ${lists.map((l) => l.name).join(', ')}`);
    return [stage, list.id];
  });
  return Object.fromEntries(entries) as Record<Stage, string>;
}

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
  const stage = job.stage ?? stageByListId[card.idList];
  if (!stage) return;

  if (card.labels.some((label) => CONFIG.manualLabels.includes(label.name.toLowerCase()))) {
    await trello.addComment(card.id, `${BOT_PREFIX} This card is labeled for manual work, so no agent starts. Move it on yourself when it's done.`);
    return;
  }

  const cardState = ensureCardState(card);
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
    cardState.lastStatus = status;
    saveState(state);

    const report = result.text.slice(0, MAX_COMMENT_LENGTH);
    await trello.addComment(
      card.id,
      [
        `${BOT_PREFIX} **${STAGE_TITLES[stage]} ${status}** · $${result.costUsd.toFixed(2)}`,
        report,
        `---\nBranch \`${cardState.branch}\` · take over: \`${takeOver}\`\n${nextStepHint(stage, result.isSuccess)}`,
      ].join('\n\n'),
    );
    notifyDesktop(`${title} ${status}`, card.name);
    console.log(`${title}: ${status}`);

    if (result.isSuccess && stage === 'build') await trello.moveCard(card.id, listIdByStage.review);
  } catch (error) {
    cardState.lastStatus = signal.aborted ? 'stopped' : 'failed';
    saveState(state);
    if (signal.aborted) return console.log(`${title}: stopped because the card moved`);

    await trello.addComment(card.id, `${BOT_PREFIX} **${STAGE_TITLES[stage]} failed** before finishing. See \`${logFile}\` and the daemon output.`);
    notifyDesktop(`${title} failed`, card.name);
    throw error;
  }
}

function nextStepHint(stage: Stage, isSuccess: boolean): string {
  if (!isSuccess) return 'Next: comment to retry with instructions, or take over in the terminal.';
  const { plan, build, review } = CONFIG.lists;
  if (stage === 'plan') return `Next: comment to change the plan, or move the card to **${build}** to approve it.`;
  if (stage === 'build') return `Moving the card to **${review}** for review and docs.`;
  return `Next: check the branch and move the card to **Done**, or back to **${build}** / **${plan}**.`;
}

async function main(): Promise<void> {
  mkdirSync(LOG_DIR, { recursive: true });
  mkdirSync(CONFIG.worktreeRoot, { recursive: true });

  const me = await trello.getMe();
  listIdByStage = resolveLists(await trello.getLists(CONFIG.boardId));
  stageByListId = Object.fromEntries(Object.entries(listIdByStage).map(([stage, listId]) => [listId, stage as Stage]));
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
