import { git } from './worktree.ts';

const CO_AUTHOR = 'Co-Authored-By: Claude <noreply@anthropic.com>';

/** Something in the way of a commit or push, said in plain words for the card comment. */
export class ShipBlockedError extends Error {}

const gitOutput = (error: unknown) => {
  const { stdout = '', stderr = '' } = error as { stdout?: string; stderr?: string };
  return `${stdout}\n${stderr}`.trim();
};

const isGitOk = (cwd: string, args: string[]) =>
  git(cwd, args).then(
    () => true,
    () => false,
  );

export function withCoAuthor(message: string): string {
  return /^co-authored-by:/im.test(message) ? message : `${message.trim()}\n\n${CO_AUTHOR}`;
}

export const isCommitOnBranch = (repoPath: string, hash: string, branch: string) =>
  isGitOk(repoPath, ['merge-base', '--is-ancestor', hash, branch]);

// One squash at a time: two cards committed together would share the main checkout's index.
let squashQueue: Promise<unknown> = Promise.resolve();

/** Brings the card branch into the target branch as one commit, in the repo's main checkout. Returns the short hash. */
export function squashIntoTarget(repoPath: string, branch: string, targetBranch: string, message: string): Promise<string> {
  const result = squashQueue.then(() => squash(repoPath, branch, targetBranch, message));
  squashQueue = result.catch(() => undefined);
  return result;
}

async function squash(repoPath: string, branch: string, targetBranch: string, message: string): Promise<string> {
  if (!(await isGitOk(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]))) {
    throw new ShipBlockedError(`The card branch \`${branch}\` doesn't exist, so there is nothing to commit.`);
  }
  const currentBranch = (await git(repoPath, ['branch', '--show-current'])).trim();
  if (currentBranch !== targetBranch) {
    throw new ShipBlockedError(`The main checkout (\`${repoPath}\`) is on \`${currentBranch || 'a detached HEAD'}\`, not \`${targetBranch}\`. Switch it to \`${targetBranch}\` and move the card again.`);
  }
  const changes = (await git(repoPath, ['status', '--porcelain', '--untracked-files=no'])).trim();
  if (changes) {
    throw new ShipBlockedError(`The main checkout (\`${repoPath}\`) has uncommitted changes. Commit or put them aside, then move the card again:\n\`\`\`\n${changes}\n\`\`\``);
  }

  try {
    await git(repoPath, ['merge', '--squash', branch]);
  } catch (error) {
    const conflicts = await git(repoPath, ['diff', '--name-only', '--diff-filter=U']).catch(() => '');
    await undoSquash(repoPath);
    const details = conflicts.trim() ? `Conflicting files:\n${conflicts.trim()}` : gitOutput(error);
    throw new ShipBlockedError(`\`${branch}\` doesn't merge cleanly into \`${targetBranch}\`, so nothing was committed.\n\`\`\`\n${details}\n\`\`\``);
  }

  if (!(await git(repoPath, ['diff', '--cached', '--name-only'])).trim()) {
    throw new ShipBlockedError(`Nothing to commit: \`${targetBranch}\` already has every change of \`${branch}\`.`);
  }
  try {
    await git(repoPath, ['commit', '-m', withCoAuthor(message)]);
  } catch (error) {
    await undoSquash(repoPath);
    throw new ShipBlockedError(`The commit failed, so nothing was committed:\n\`\`\`\n${gitOutput(error)}\n\`\`\``);
  }
  return (await git(repoPath, ['rev-parse', '--short', 'HEAD'])).trim();
}

// Safe because squashIntoTarget only starts on a checkout without uncommitted changes.
async function undoSquash(repoPath: string): Promise<void> {
  await git(repoPath, ['reset', '--hard', 'HEAD']);
}

/** Pushes the branch to origin and returns the full hash that was pushed. */
export async function pushBranch(repoPath: string, branch: string): Promise<string> {
  try {
    await git(repoPath, ['push', 'origin', branch]);
  } catch (error) {
    throw new ShipBlockedError(`GitHub didn't take the push of \`${branch}\`:\n\`\`\`\n${gitOutput(error)}\n\`\`\``);
  }
  return (await git(repoPath, ['rev-parse', branch])).trim();
}

/** Removes the card's worktree and branch. Returns false (and keeps them) if the worktree has unsaved work. */
export async function removeCardWorktree(repoPath: string, worktreePath: string, branch: string): Promise<boolean> {
  if (!(await isGitOk(repoPath, ['worktree', 'remove', worktreePath]))) return false;
  // -D because a squash leaves the branch looking unmerged.
  return isGitOk(repoPath, ['branch', '-D', branch]);
}
