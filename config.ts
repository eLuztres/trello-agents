import path from 'node:path';
import type { AgentStage, Stage } from './src/events.ts';

const WORKSPACE = path.resolve(import.meta.dirname, '..');

export interface Config {
  boardId: string;
  /** Trello list names for each automated stage (the first is where cards are moved to); a stage without lists is skipped. Other lists (like Done) stop the agent. */
  lists: Partial<Record<Stage, string[]>>;
  /** A review with verdict "ready" moves the card here, to wait for your OK. */
  readyList: string;
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
  // To Do and Doing both build right away (no plan step); the builder moves the card to Testing when it's done.
  // Uncommitted → Committed → Pushed: only your own moves commit and push, no agent runs there.
  lists: { build: ['To Do', 'Doing'], review: ['Testing'], commit: ['Committed'], push: ['Pushed'] },
  readyList: 'Uncommitted',
  repos: {
    webStore: path.join(WORKSPACE, 'webStore'),
    custom: path.join(WORKSPACE, 'custom'),
    'shop-emlets': path.join(WORKSPACE, 'shop-emlets'),
    'shop-baifo': path.join(WORKSPACE, 'shop-baifo'),
  },
  defaultRepo: 'shop-baifo',
  manualLabels: ['manual'],
  baseBranch: 'main',
  // Once shop-baifo has a develop branch, commit there (and let Pushed promote it).
  targetBranches: { 'shop-baifo': 'main' },
  worktreeRoot: path.join(WORKSPACE, '.worktrees'),
  maxParallelJobs: 2,
  pollIntervalSeconds: 30,
  maxBudgetUsd: { plan: 2, build: 10, review: 5 },
};
