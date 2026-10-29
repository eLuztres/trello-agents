import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { CONFIG } from '../config.ts';
import type { PermissionMode } from './claude.ts';
import type { AgentStage, Stage } from './events.ts';
import type { CardState } from './state.ts';
import type { TrelloCard } from './trello.ts';

export interface StageRun {
  prompt: string;
  permissionMode: PermissionMode;
  sessionId: string;
  shouldResume: boolean;
  disallowedTools: string[];
}

export const STAGE_TITLES: Record<Stage, string> = { plan: 'Planning', build: 'Building', review: 'Testing & docs', chat: 'Chat', commit: 'Committing', push: 'Pushing' };

/** Build and review record here, outside the worktree so the videos never get committed. */
export const VIDEO_DIR = path.resolve(import.meta.dirname, '..', 'logs', 'videos');
/** The review page (npm run videos) plays the videos from here once they're attached to the card. */
export const REVIEW_VIDEO_DIR = path.join(os.homedir(), 'Videos', 'changes');

/** The chat agent ends with this line when the chef's comment asks to start the work. */
export const BUILD_MARKER = 'ACTION: build';

const MAX_BRIEF_COMMENTS = 20;
const MAX_BRIEF_COMMENT_LENGTH = 2000;

export const SYSTEM_PROMPT = [
  'You are a developer agent started by a Trello board automation. The chef (the repo owner) steers you through the card.',
  'Nobody can answer questions during this run, so never ask. Make reasonable assumptions instead.',
  'Your final message is posted as a Trello comment. Keep it short and in plain words: what was done or found, the result',
  '(link a screenshot or video for UI work), and what is next. List your assumptions and open questions there.',
  'No logs, command output or tool dumps in it: those stay in the log file.',
].join(' ');

/** The daemon attaches the recorded files to the card and links them at the top of the comment. */
function videoRule(card: TrelloCard): string {
  return [
    `UI change? Record the changed pages with Playwright (\`recordVideo\`, a few seconds each, save with \`page.video().saveAs()\`; a GIF is fine too): desktop to \`${VIDEO_DIR}/card-${card.idShort}-desktop.webm\` and 375px phone width to \`${VIDEO_DIR}/card-${card.idShort}-phone.webm\`.`,
    'Record new videos in every run that changed anything visible, even if the card already has videos: never reuse older ones. Show the changed flow step by step, the way a visitor clicks and scrolls through it, slow enough to follow.',
    'The daemon uploads them to the card and puts "🎬 Video: <link>" at the top of your comment. No visible change? Start your final message with "🎬 Video: no UI change".',
  ].join(' ');
}

function stageTask(stage: AgentStage, card: TrelloCard, baseBranch: string): string {
  switch (stage) {
    case 'plan':
      return [
        'Stage: PLAN (read-only). Explore the code and write an implementation plan for this card. Do not change any files.',
        'End with the complete plan in Markdown as your final message: goal, files to change, steps, tests, open questions.',
        `Ask only what you cannot decide yourself. Finish with \`Verdict: ready\` on its own line when nothing is left to ask the chef (the card moves to ${CONFIG.plannedList}),`,
        `or \`Verdict: questions\` when the chef must answer something first (the card moves back to ${CONFIG.backlogList} until the chef answers in a comment).`,
      ].join('\n');
    case 'build':
      return [
        'Stage: BUILD. Implement this card (or continue it, and handle any chef comment above) following AGENTS.md.',
        'Run `npm run lint` and `npm run test` and fix what fails. Commit on the current branch with a clear message.',
        videoRule(card),
        'End with a short summary of what changed and what the chef should check.',
      ].join('\n');
    case 'review':
      return [
        'Stage: TESTING. You are the reviewer and tech writer, not the author of this change.',
        `1. Review \`git diff ${baseBranch}...HEAD\` for bugs and AGENTS.md violations. Fix clear problems.`,
        '2. Write the tests the change is missing (complex logic, server actions, bug fixes), following the repo\'s existing tests.',
        '3. Run `npm run lint` and `npm run test`. Fix failures.',
        `4. Write \`docs/changes/card-${card.idShort}.md\` (what changed, why, how to test it by hand) and update existing docs the change affects.`,
        '5. Commit on the current branch.',
        `6. ${videoRule(card)}`,
        'End with a report: tests added, lint and test results, problems found and fixed, and what to check by hand. Finish the report with exactly these three parts, in this order:',
        '`Verdict: ready` or `Verdict: not ready` on its own line.',
        '`## What changed` followed by 3-5 plain lines for the chef, without code.',
        '`## Commit message` followed by a ``` block with the proposed message: a short subject line, a blank line, then a few "- " lines. Nothing after the block.',
      ].join('\n');
    case 'chat':
      return [
        'Stage: CHAT (read-only). Read the card, its comments and the code, then reply to the chef\'s comment.',
        'Change no files, make no commits. Answer the question, or say what you would do and why, in plain short words.',
        `End with one clear next step, like "Move to ${CONFIG.lists.build?.[0]} and I build it" or "Need from you: …".`,
        `Only if the comment asks you to start the work (like "do it" or "build it"), add \`${BUILD_MARKER}\` as the very last line: the card then moves to ${CONFIG.lists.build?.[0]} and gets built.`,
      ].join('\n');
  }
}

/** Comments come newest first, like Trello returns them; the brief shows the latest ones oldest first. */
function cardBrief(card: TrelloCard, cardState: CardState, baseBranch: string, comments: string[]): string {
  const recentComments = comments.slice(0, MAX_BRIEF_COMMENTS).reverse();
  return [
    `Trello card #${card.idShort}: ${card.name}`,
    card.shortUrl,
    '',
    card.desc || '(no description)',
    '',
    ...(recentComments.length ? ['Comments so far (oldest first, 🤖 ones are from agents):', ...recentComments.map(formatComment), ''] : []),
    `Repo: ${cardState.repo}. You are in a git worktree on branch \`${cardState.branch}\`, based on \`${baseBranch}\`.`,
  ].join('\n');
}

function formatComment(text: string): string {
  const shortened = text.length > MAX_BRIEF_COMMENT_LENGTH ? `${text.slice(0, MAX_BRIEF_COMMENT_LENGTH)} …` : text;
  return `- ${shortened.replace(/\n/g, '\n  ')}`;
}

/** Strips the chat agent's build marker from its reply and tells whether it was there. */
export function takeBuildRequest(text: string): { text: string; shouldBuild: boolean } {
  const lines = text.trimEnd().split('\n');
  // The prompt shows the marker in backticks, so agents sometimes copy them.
  const shouldBuild = lines.at(-1)?.trim().replace(/^`|`$/g, '') === BUILD_MARKER;
  return { text: shouldBuild ? lines.slice(0, -1).join('\n').trimEnd() : text, shouldBuild };
}

/** Your comment on a card you are checking (Testing, Uncommitted) asks for another round of building;
    a plain question only gets an answer, so asking "why?" doesn't cost a whole build. */
export function isChangeRequest(listId: string, checkListIds: string[], feedback: string): boolean {
  const text = feedback.trim();
  return checkListIds.includes(listId) && text !== '' && !text.endsWith('?');
}

function existingSessionId(stage: AgentStage, cardState: CardState, feedback?: string): string | undefined {
  if (stage === 'chat') return undefined; // the comments in the brief are the conversation
  if (stage === 'review') return feedback ? cardState.reviewSessionId : undefined;
  return cardState.devSessionId;
}

function feedbackPrompt(stage: AgentStage, feedback: string): string {
  const answerFirst = stage === 'chat' ? '' : '\nStart your final message by answering this comment directly, then report as usual.';
  return `The chef commented on the card:\n${feedback}${answerFirst}`;
}

/** The build after a clash: main moved on, and the builder resolves it before anything else. */
function updateBranchTask(targetBranch: string): string {
  return [
    `First: \`${targetBranch}\` moved on and this branch clashes with it. Update the branch onto ${targetBranch}: run \`git merge ${targetBranch}\`,`,
    'resolve the conflicts keeping what both sides meant, and commit the merge. Then go on with the build below; the card goes through Testing again.',
  ].join(' ');
}

/** Plan and build share a session; review starts fresh unless it's answering a comment; chat always starts fresh. */
export function planStageRun(stage: AgentStage, card: TrelloCard, cardState: CardState, baseBranch: string, comments: string[], feedback?: string): StageRun {
  const sessionId = existingSessionId(stage, cardState, feedback);
  const shouldResume = Boolean(sessionId);
  const isReadOnly = stage === 'plan' || stage === 'chat';

  const prompt = [
    shouldResume ? '' : cardBrief(card, cardState, baseBranch, comments),
    feedback ? feedbackPrompt(stage, feedback) : '',
    stage === 'build' && cardState.updateOnto ? updateBranchTask(cardState.updateOnto) : '',
    stageTask(stage, card, baseBranch),
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    prompt,
    permissionMode: isReadOnly ? 'plan' : 'auto',
    sessionId: sessionId ?? randomUUID(),
    shouldResume,
    // Headless runs can't show a plan-approval or question dialog: the Trello card is the dialog.
    disallowedTools: ['AskUserQuestion', 'ExitPlanMode', ...(stage === 'chat' ? ['Edit', 'Write', 'NotebookEdit'] : [])],
  };
}
