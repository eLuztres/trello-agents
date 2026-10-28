import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const POLL_INTERVAL_MS = 15_000;
// Vercel needs a moment after the push to create the deployment.
const APPEAR_TIMEOUT_MS = 3 * 60_000;
const BUILD_TIMEOUT_MS = 20 * 60_000;
const FAILED_STATES = ['ERROR', 'CANCELED'];

interface VercelDeployment {
  url: string;
  name: string;
  state: string;
  errorMessage?: string;
}

export type DeployResult =
  | { kind: 'live'; url: string }
  | { kind: 'failed'; reason: string; logsUrl: string; url: string }
  | { kind: 'unknown'; reason: string };

async function findDeployment(repoPath: string, sha: string): Promise<{ deployment?: VercelDeployment; team: string }> {
  // Vercel CLI because it's logged in already and the repo is linked in .vercel/project.json.
  const { stdout } = await execFileAsync(
    'vercel',
    ['ls', '--json', '--limit', '1', '--meta', `githubCommitSha=${sha}`, '--non-interactive'],
    { cwd: repoPath, timeout: 60_000 },
  );
  const { deployments, contextName } = JSON.parse(stdout) as { deployments: VercelDeployment[]; contextName: string };
  return { deployment: deployments[0], team: contextName };
}

/** Waits for the Vercel deployment of a pushed commit. */
export async function waitForDeployment(repoPath: string, sha: string, signal: AbortSignal): Promise<DeployResult> {
  if (!existsSync(path.join(repoPath, '.vercel', 'project.json'))) {
    return { kind: 'unknown', reason: 'the repo is not linked to a Vercel project (`vercel link`)' };
  }

  const startedAt = Date.now();
  while (!signal.aborted) {
    const elapsed = Date.now() - startedAt;
    let found: Awaited<ReturnType<typeof findDeployment>>;
    try {
      found = await findDeployment(repoPath, sha);
    } catch (error) {
      return { kind: 'unknown', reason: `the Vercel CLI failed (${(error as Error).message.split('\n')[0]})` };
    }
    const { deployment, team } = found;

    if (deployment?.state === 'READY') return { kind: 'live', url: `https://${deployment.url}` };
    if (deployment && FAILED_STATES.includes(deployment.state)) {
      return {
        kind: 'failed',
        reason: deployment.errorMessage ?? deployment.state.toLowerCase(),
        logsUrl: `https://vercel.com/${team}/${deployment.name}`,
        url: deployment.url,
      };
    }
    if (!deployment && elapsed > APPEAR_TIMEOUT_MS) return { kind: 'unknown', reason: 'no Vercel deployment showed up for this commit' };
    if (elapsed > BUILD_TIMEOUT_MS) return { kind: 'unknown', reason: `the deployment is still ${deployment?.state.toLowerCase()} after 20 minutes` };

    await sleep(POLL_INTERVAL_MS, undefined, { signal }).catch(() => undefined);
  }
  return { kind: 'unknown', reason: 'stopped waiting because the card moved' };
}
