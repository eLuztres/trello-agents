// Uncommitted → Committed → Pushed: plain git, started only by your own moves.
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from '../config.ts';
import { readCommitMessage, readHandOver, withHandOver } from './description.ts';
import { BOT_PREFIX } from './events.ts';
import { notifyDesktop } from './notify.ts';
import { MergeConflictError, ShipBlockedError, isCommitOnBranch, pushBranch, removeCardWorktree, squashIntoTarget } from './ship-git.ts';
import { videoForTrello } from './shrink-video.ts';
import { REVIEW_VIDEO_DIR, VIDEO_DIR } from './stages.ts';
import type { CardState } from './state.ts';
import { trello, type TrelloCard } from './trello.ts';
import { waitForDeployment, type DeployResult } from './vercel.ts';

const targetBranchOf = (cardState: CardState) => CONFIG.targetBranches[cardState.repo] ?? CONFIG.baseBranch;

/** After a "ready" review: writes What changed, the videos and the commit message into the description. */
export async function handOverReview(card: TrelloCard, report: string, videoLinks: string[], uncommittedListId: string): Promise<void> {
  const handOver = readHandOver(report);
  if (!handOver) {
    await trello.addComment(card.id, `${BOT_PREFIX} The review is ready, but its report has no "What changed" or "Commit message" section. Write the commit message under \`## Commit message\` in the description before moving the card to Committed.`);
  }
  // Fresh copy: you may have edited the description while the review ran.
  const { desc } = await trello.getCard(card.id);
  if (handOver) await trello.setDescription(card.id, withHandOver(desc, { ...handOver, videoLinks }));
  await trello.moveCard(card.id, uncommittedListId);
}

/** Uploads the videos a build or review recorded and returns Markdown links to them. */
export async function attachVideos(card: TrelloCard): Promise<string[]> {
  const prefix = `card-${card.idShort}-`;
  const files = (await readdir(VIDEO_DIR).catch(() => [])).filter((name) => name.startsWith(prefix));
  const links: string[] = [];
  for (const name of files) {
    const filePath = path.join(VIDEO_DIR, name);
    try {
      const uploadPath = await videoForTrello(filePath);
      const attachment = await trello.attachFile(card.id, uploadPath);
      links.push(`[${name.slice(prefix.length).replace(/\.\w+$/, '')}](${attachment.url})`);
      // Attached once: a later review records fresh videos. The newest also replaces the older one on the review page.
      await mkdir(REVIEW_VIDEO_DIR, { recursive: true });
      await copyFile(filePath, path.join(REVIEW_VIDEO_DIR, name));
      await rm(filePath);
      if (uploadPath !== filePath) await rm(uploadPath);
    } catch (error) {
      console.error(`Card #${card.idShort}: video ${name} not attached: ${(error as Error).message}`);
    }
  }
  return links;
}

/** How many times a merge conflict goes back to a build before the card waits for you. */
export const MAX_CONFLICT_RETRIES = 2;

/**
 * Squashes the card branch into the target branch with the message from the description.
 * `onConflict` takes over a merge conflict (a build that merges the target branch in) instead of reporting it.
 */
export async function commitCard(card: TrelloCard, cardState: CardState, uncommittedListId: string, onConflict?: (details: string) => Promise<void>): Promise<boolean> {
  const repoPath = CONFIG.repos[cardState.repo];
  const targetBranch = targetBranchOf(cardState);

  if (cardState.commitHash && (await isCommitOnBranch(repoPath, cardState.commitHash, targetBranch))) {
    await trello.addComment(card.id, `${BOT_PREFIX} Already committed as \`${cardState.commitHash}\` on \`${targetBranch}\`. Pushing now.`);
    return true;
  }

  try {
    const message = readCommitMessage(card.desc);
    if (!message) throw new ShipBlockedError('The description has no commit message. Write it under `## Commit message` and move the card again.');
    cardState.commitHash = await squashIntoTarget(repoPath, cardState.branch, targetBranch, message);
  } catch (error) {
    if (error instanceof MergeConflictError && onConflict && (cardState.conflictRetries ?? 0) < MAX_CONFLICT_RETRIES) {
      cardState.conflictRetries = (cardState.conflictRetries ?? 0) + 1;
      await onConflict(error.message);
      return false;
    }
    await reportBlocked(card, 'Nothing committed', error, uncommittedListId);
    return false;
  }

  cardState.conflictRetries = 0;
  await trello.addComment(card.id, `${BOT_PREFIX} Committed as \`${cardState.commitHash}\` on \`${targetBranch}\`. Pushing now.`);
  notifyDesktop(`#${card.idShort} committed`, card.name);
  return true;
}

/** Your move to Pushed: pushes the target branch, waits for Vercel and cleans up the card's worktree. */
export async function pushCard(card: TrelloCard, cardState: CardState, uncommittedListId: string, committedListId: string, signal: AbortSignal): Promise<boolean> {
  const repoPath = CONFIG.repos[cardState.repo];
  const targetBranch = targetBranchOf(cardState);

  if (!cardState.commitHash || !(await isCommitOnBranch(repoPath, cardState.commitHash, targetBranch))) {
    await reportBlocked(card, 'Nothing pushed', new ShipBlockedError(`This card has no commit on \`${targetBranch}\` yet. Move it to **Committed** first.`), uncommittedListId);
    return false;
  }

  let sha: string;
  try {
    sha = await pushBranch(repoPath, targetBranch);
  } catch (error) {
    await reportBlocked(card, 'Nothing pushed', error, committedListId);
    return false;
  }
  notifyDesktop(`#${card.idShort} pushed, waiting for Vercel`, card.name);

  const isCleanedUp = await removeCardWorktree(repoPath, cardState.worktree, cardState.branch);
  const cleanUpNote = isCleanedUp ? 'Worktree and branch removed.' : `The worktree \`${cardState.worktree}\` and branch \`${cardState.branch}\` were kept: remove them by hand.`;

  const deploy = await waitForDeployment(repoPath, sha, signal);
  const pushed = `\`${targetBranch}\` (${sha.slice(0, 7)})`;
  await trello.addComment(card.id, `${BOT_PREFIX} ${describeDeploy(deploy, pushed)}\n\n${cleanUpNote}`);
  notifyDesktop(`#${card.idShort} ${DEPLOY_NOTIFICATIONS[deploy.kind]}`, card.name);
  return true;
}

const DEPLOY_NOTIFICATIONS: Record<DeployResult['kind'], string> = { live: 'is live', failed: 'deploy failed', unknown: 'pushed' };

function describeDeploy(deploy: DeployResult, pushed: string): string {
  switch (deploy.kind) {
    case 'live':
      return `Pushed ${pushed} and live: ${deploy.url}`;
    case 'failed':
      return `Pushed ${pushed}, but the deploy failed: ${deploy.reason}. Logs: ${deploy.logsUrl} (or \`vercel inspect --logs ${deploy.url}\`)`;
    case 'unknown':
      return `Pushed ${pushed}. Deploy status unknown: ${deploy.reason}.`;
  }
}

async function reportBlocked(card: TrelloCard, title: string, error: unknown, backToListId: string): Promise<void> {
  const reason = error instanceof ShipBlockedError ? error.message : `Unexpected error: ${(error as Error).message}`;
  await trello.addComment(card.id, `${BOT_PREFIX} **${title}.** ${reason}\n\nThe card goes back so you can move it again once that's sorted.`);
  await trello.moveCard(card.id, backToListId);
  notifyDesktop(`#${card.idShort}: ${title.toLowerCase()}`, card.name);
}
