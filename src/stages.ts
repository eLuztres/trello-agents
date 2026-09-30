import { randomUUID } from 'node:crypto';
import type { PermissionMode } from './claude.ts';
import type { Stage } from './events.ts';
import type { CardState } from './state.ts';
import type { TrelloCard } from './trello.ts';

export interface StageRun {
  prompt: string;
  permissionMode: PermissionMode;
  sessionId: string;
  shouldResume: boolean;
  disallowedTools: string[];
}

export const STAGE_TITLES: Record<Stage, string> = { plan: 'Planning', build: 'Building', review: 'Testing & docs' };

export const SYSTEM_PROMPT = [
  'You are a developer agent started by a Trello board automation. The chef (the repo owner) steers you through the card.',
  'Nobody can answer questions during this run, so never ask. Make reasonable assumptions instead.',
  'Your final message is posted as a Trello comment: keep it clear, and list your assumptions and open questions there.',
].join(' ');

function stageTask(stage: Stage, card: TrelloCard, baseBranch: string): string {
  switch (stage) {
    case 'plan':
      return [
        'Stage: PLAN (read-only). Explore the code and write an implementation plan for this card. Do not change any files.',
        'End with the complete plan in Markdown as your final message: goal, files to change, steps, tests, open questions.',
      ].join('\n');
    case 'build':
      return [
        'Stage: BUILD. The chef approved the plan. Implement it (or continue it, and handle any chef comment above) following AGENTS.md.',
        'Run `npm run lint` and `npm run test` and fix what fails. Commit on the current branch with a clear message.',
        'End with a short summary of what changed and what the chef should check.',
      ].join('\n');
    case 'review':
      return [
        'Stage: TESTING. You are the reviewer and tech writer, not the author of this change.',
        `1. Review \`git diff ${baseBranch}...HEAD\` for bugs and AGENTS.md violations. Fix clear problems.`,
        '2. Run `npm run lint` and `npm run test`. Fix failures.',
        `3. Write \`docs/changes/card-${card.idShort}.md\` (what changed, why, how to test it by hand) and update existing docs the change affects.`,
        '4. Commit on the current branch.',
        'End with a report: verdict (ready / not ready), lint and test results, problems found and fixed, and what to check by hand.',
      ].join('\n');
  }
}

function cardBrief(card: TrelloCard, cardState: CardState, baseBranch: string): string {
  return [
    `Trello card #${card.idShort}: ${card.name}`,
    card.shortUrl,
    '',
    card.desc || '(no description)',
    '',
    `Repo: ${cardState.repo}. You are in a git worktree on branch \`${cardState.branch}\`, based on \`${baseBranch}\`.`,
  ].join('\n');
}

/** Plan and build share a session; review starts fresh unless it's answering a comment. */
export function planStageRun(stage: Stage, card: TrelloCard, cardState: CardState, baseBranch: string, feedback?: string): StageRun {
  const existingSessionId = stage === 'review' ? (feedback ? cardState.reviewSessionId : undefined) : cardState.devSessionId;
  const shouldResume = Boolean(existingSessionId);

  const prompt = [
    shouldResume ? '' : cardBrief(card, cardState, baseBranch),
    feedback ? `The chef commented on the card:\n${feedback}` : '',
    stageTask(stage, card, baseBranch),
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    prompt,
    permissionMode: stage === 'plan' ? 'plan' : 'auto',
    sessionId: existingSessionId ?? randomUUID(),
    shouldResume,
    // Headless runs can't show a plan-approval or question dialog: the Trello card is the dialog.
    disallowedTools: ['AskUserQuestion', 'ExitPlanMode'],
  };
}
