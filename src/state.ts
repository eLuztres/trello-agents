import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const STATE_FILE = path.resolve(import.meta.dirname, '..', 'state.json');

export interface CardState {
  idShort: number;
  name: string;
  repo: string;
  branch: string;
  worktree: string;
  /** Shared by plan and build, so the builder remembers the plan and your feedback. */
  devSessionId?: string;
  /** The reviewer gets its own session for a fresh look at the diff. */
  reviewSessionId?: string;
  /** Set by the commit stage; the push stage needs it. */
  commitHash?: string;
  /** How often a merge conflict sent the card back to a build, so it can't loop forever. */
  conflictRetries?: number;
  lastStage?: string;
  lastStatus?: 'running' | 'done' | 'failed' | 'stopped';
}

export interface State {
  lastActionId?: string;
  cards: Record<string, CardState>;
}

export function loadState(): State {
  return existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State) : { cards: {} };
}

export function saveState(state: State): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/** The abort reason when the daemon stops, as opposed to your card move or `stop` comment. */
export const SHUTDOWN = 'shutdown';

/** A shutdown leaves the job `running`, so the next start resumes it. */
export function statusAfterAbort(reason: unknown): 'running' | 'stopped' {
  return reason === SHUTDOWN ? 'running' : 'stopped';
}
