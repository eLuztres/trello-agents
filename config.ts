import os from 'node:os';
import path from 'node:path';
import type { AgentStage, Stage } from './src/events.ts';

const WORKSPACE = path.resolve(import.meta.dirname, '..');

export interface Config {
  /** Keeps each board's state, logs and videos apart: card numbers start at 1 on every board. */
  name: string;
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
  /** How the agents check their work (lint, tests). */
  checks: string;
  /** How the agents get into the app for the videos. */
  videoLogin: string;
  /** The review writes docs/changes/card-<n>.md into the repo. */
  shouldWriteChangeDocs: boolean;
  /** Committed only marks the card branch as done: nothing is squashed into the target branch or pushed. */
  isLocalOnly: boolean;
}

const BAIFO: Config = {
  name: 'baifo',
  boardId: 'd5Qaotvz',
  // ✋ lists are yours to drop cards in, 🤖 lists only the agents fill. Planning ends in Ready (or Backlog with questions).
  // To Do starts a build, which runs in Doing and moves on to Testing. Committed is the OK for all of it: commit, push and Done follow on their own. Pushed only re-pushes.
  // No review stage: you asked to stop the Testing agent, so a finished build goes straight to Uncommitted.
  lists: { plan: ['✋ Planning'], build: ['✋ To Do', '🤖 Doing'], commit: ['✋ Committed'], push: ['✋ Pushed'] },
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
  checks: 'Run `npm run lint` and `npm run test` and fix what fails.',
  videoLogin: 'Admin pages: sign in through the normal sign-in form as the local test admin, `LOCAL_TEST_ADMIN_EMAIL` / `LOCAL_TEST_ADMIN_PASSWORD` from the worktree `.env` (never print the password, never forge a session).',
  shouldWriteChangeDocs: true,
  isLocalOnly: false,
};

const VIRTIMO = path.join(os.homedir(), 'VirtimoRepos');

// Virtimo's BPC WebTSM tickets from Jira: same lists, but nothing leaves this machine. You push the card branch yourself.
const BPC: Config = {
  ...BAIFO,
  name: 'bpc',
  boardId: '3e6DyCWx',
  repos: {
    'bpc-fe-webtsm': path.join(VIRTIMO, 'bpc-fe-webtsm'),
    'bpc-be-webtsm': path.join(VIRTIMO, 'bpc-be-webtsm'),
    'bpc-docs': path.join(VIRTIMO, 'bpc-docs'),
  },
  defaultRepo: 'bpc-fe-webtsm',
  // No push: Pushed is a plain list here.
  lists: { plan: BAIFO.lists.plan, build: BAIFO.lists.build, review: BAIFO.lists.review, commit: BAIFO.lists.commit },
  baseBranch: 'origin/develop',
  targetBranches: {},
  worktreeRoot: path.join(VIRTIMO, '.worktrees'),
  maxParallelJobs: 3,
  checks: 'Frontend: run `npm run lint` and fix what fails. Backend: run `mvn -q test` and fix what fails. Start every commit message with the Jira key from the card name (e.g. `BPC-11830 …`).',
  videoLogin: 'The app is the local BPC at `BPC_URL`, signed in as `BPC_USER` / `BPC_PASSWORD` (from the environment; never print the password). Deploy the changed module into it first (see the repo docs and the webtsm skill). No BPC reachable? Say so in your final message instead of a video. '
    + 'Videos show mock data only: the WebTSM Viewer `1787088176493` (api_id `docs-mock`, the mock PowerTSM on `localhost:8099`) and its Manager `1787139062045`. Never open, record or change other WebTSM instances or the `module_apis` entries that point to real TSM systems (`virtimodev01`, `repo2dev01`). '
    + 'Mock not answering on 8099? Start it with `PORT=8099 node ~/.claude/skills/webtsm/scripts/mock-powertsm/server.js`. Empty search? Rebuild the cache of that Viewer (Cache-Verwaltung → "Cache neu erstellen").',
  shouldWriteChangeDocs: false,
  isLocalOnly: true,
};

export const CONFIG: Config = process.env.BOARD === 'bpc' ? BPC : BAIFO;
