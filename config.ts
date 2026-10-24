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
  /** Cards with one of these labels are done by hand: they never start an agent. */
  manualLabels: string[];
  baseBranch: string;
  worktreeRoot: string;
  maxParallelJobs: number;
  pollIntervalSeconds: number;
  maxBudgetUsd: Record<Stage, number>;
}

export const CONFIG: Config = {
  boardId: 'd5Qaotvz',
  lists: { plan: 'To Do', build: 'Doing', review: 'Testing' },
  repos: {
    webStore: path.join(WORKSPACE, 'webStore'),
    custom: path.join(WORKSPACE, 'custom'),
    'shop-emlets': path.join(WORKSPACE, 'shop-emlets'),
    'shop-baifo': path.join(WORKSPACE, 'shop-baifo'),
  },
  defaultRepo: 'shop-baifo',
  manualLabels: ['manual'],
  baseBranch: 'main',
  worktreeRoot: path.join(WORKSPACE, '.worktrees'),
  maxParallelJobs: 2,
  pollIntervalSeconds: 30,
  maxBudgetUsd: { plan: 2, build: 10, review: 5 },
};
