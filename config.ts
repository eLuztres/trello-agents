import path from 'node:path';
import type { Stage } from './src/events.ts';

const WORKSPACE = path.resolve(import.meta.dirname, '..');

export interface Config {
  boardId: string;
  /** Trello list name for each automated stage. Other lists (like Done) stop the agent. */
  lists: Record<Stage, string>;
  /** A card label with one of these names picks the repo, otherwise defaultRepo is used. */
  repos: Record<string, string>;
  defaultRepo: string;
  baseBranch: string;
  worktreeRoot: string;
  maxParallelJobs: number;
  pollIntervalSeconds: number;
  maxBudgetUsd: Record<Stage, number>;
}

export const CONFIG: Config = {
  boardId: 'CkzfM3eh',
  lists: { plan: 'To Do', build: 'Doing', review: 'Testing' },
  repos: {
    webStore: path.join(WORKSPACE, 'webStore'),
    custom: path.join(WORKSPACE, 'custom'),
  },
  defaultRepo: 'webStore',
  baseBranch: 'main',
  worktreeRoot: path.join(WORKSPACE, '.worktrees'),
  maxParallelJobs: 2,
  pollIntervalSeconds: 30,
  maxBudgetUsd: { plan: 2, build: 10, review: 5 },
};
