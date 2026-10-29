import path from 'node:path';
import type { AgentStage, Stage } from './src/events.ts';

const WORKSPACE = path.resolve(import.meta.dirname, '..');

export interface Config {
  boardId: string;
  /** Trello list names for each automated stage (the first is where cards are moved to); a stage without lists is skipped. Other lists (like Done) stop the agent, and comments there get a chat reply. */
  lists: Partial<Record<Stage, string[]>>;
  /** A plan without open questions moves the card here (no agent); you move it on to build it. */
  plannedList: string;
  /** A plan with open questions moves the card back here; your answer as a comment plans it again. */
  backlogList: string;
  /** A review with verdict "ready" moves the card here, to wait for your OK. */
  uncommittedList: string;
  /** A card lands here once it's committed, pushed and deployed. */
  doneList: string;
  /** Builds run here: the daemon moves the card in from To Do when the build starts. */
  buildingList: string;
  /** Only the daemon puts cards here; your own drop into one is undone. */
  aiLists: string[];
  /** The colored label a card wears while an agent works on it. */
  workingLabel: { name: string; color: string };
  /** A card label with one of these names picks the repo, otherwise defaultRepo is used. */
  repos: Record<string, string>;
  defaultRepo: string;
  /** Cards with one of these labels are done by hand: they never start an agent. */
  manualLabels: string[];
  baseBranch: string;
  /** Where Committed squashes a card and Pushed pushes, per repo. Repos not listed use baseBranch. */
  targetBranches: Record<string, string>;
  worktreeRoot: string;
  maxParallelJobs: number;
  pollIntervalSeconds: number;
  maxBudgetUsd: Record<AgentStage, number>;
}

export const CONFIG: Config = {
  boardId: 'd5Qaotvz',
  // ✋ lists are yours to drop cards in, 🤖 lists only the agents fill. Planning ends in Ready (or Backlog with questions).
  // To Do starts a build, which runs in Doing and moves on to Testing. Committed is the OK for all of it: commit, push and Done follow on their own. Pushed only re-pushes.
  lists: { plan: ['✋ Planning'], build: ['✋ To Do', '🤖 Doing'], review: ['🤖 Testing'], commit: ['✋ Committed'], push: ['✋ Pushed'] },
  plannedList: '🤖 Ready',
  backlogList: '✋ Backlog',
  uncommittedList: '🤖 Uncommitted',
  doneList: '✋ Done',
  buildingList: '🤖 Doing',
  aiLists: ['🤖 Ready', '🤖 Doing', '🤖 Testing', '🤖 Uncommitted'],
  workingLabel: { name: '🤖 AI working', color: 'purple' },
  repos: {
    webStore: path.join(WORKSPACE, 'webStore'),
    custom: path.join(WORKSPACE, 'custom'),
    'shop-emlets': path.join(WORKSPACE, 'shop-emlets'),
    'shop-baifo': path.join(WORKSPACE, 'shop-baifo'),
    'trello-agents': path.join(WORKSPACE, 'trello-agents'),
  },
  defaultRepo: 'shop-baifo',
  manualLabels: ['manual'],
  baseBranch: 'main',
  // Once shop-baifo has a develop branch, commit there (and let Pushed promote it).
  targetBranches: { 'shop-baifo': 'main' },
  worktreeRoot: path.join(WORKSPACE, '.worktrees'),
  maxParallelJobs: 10,
  pollIntervalSeconds: 30,
  maxBudgetUsd: { plan: 2, build: 10, review: 5, chat: 0.5 },
};
