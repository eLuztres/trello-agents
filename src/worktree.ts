import { execFile } from 'node:child_process';
import { lstatSync, existsSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Linked instead of installed per card: fast, and lint/tests work. Both are gitignored in the repos.
const SHARED_FROM_REPO = ['node_modules', '.env'];

export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout;
}

export async function ensureWorktree(repoPath: string, worktreePath: string, branch: string, baseBranch: string): Promise<void> {
  if (!existsSync(worktreePath)) {
    const hasBranch = await git(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).then(
      () => true,
      () => false,
    );
    const args = hasBranch ? [worktreePath, branch] : ['-b', branch, worktreePath, baseBranch];
    await git(repoPath, ['worktree', 'add', ...args]);
  }

  for (const name of SHARED_FROM_REPO) {
    const source = path.join(repoPath, name);
    const target = path.join(worktreePath, name);
    if (existsSync(source) && !lstatSync(target, { throwIfNoEntry: false })) symlinkSync(source, target);
  }
}

/** Commits what the agent left uncommitted, so every stage ends in a clean branch. */
export async function commitLeftovers(worktreePath: string, message: string): Promise<boolean> {
  const status = await git(worktreePath, ['status', '--porcelain']);
  if (!status.trim()) return false;
  await git(worktreePath, ['add', '-A']);
  await git(worktreePath, ['commit', '-m', message]);
  return true;
}
