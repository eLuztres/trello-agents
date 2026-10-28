// The reviewer's hand-over lives in the card description, where you can edit the commit message before committing.

const WHAT_CHANGED = 'What changed';
const VIDEO = 'Video';
const COMMIT_MESSAGE = 'Commit message';
const FENCE_LINE = /^```.*$/gm;

export type Verdict = 'ready' | 'not ready';

export interface ReviewHandOver {
  whatChanged: string;
  commitMessage: string;
  videoLinks: string[];
}

/** The text under `## <heading>`, up to the next `## ` heading. */
export function readSection(markdown: string, heading: string): string | undefined {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`);
  if (start === -1) return undefined;
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
}

/** The commit message as you left it: with or without the ``` fences. */
export function readCommitMessage(description: string): string | undefined {
  const message = readSection(description, COMMIT_MESSAGE)?.replace(FENCE_LINE, '').trim();
  return message || undefined;
}

export function readVerdict(report: string): Verdict | undefined {
  const match = report.match(/^[*_\s]*verdict[*_\s]*:[*_\s]*(not ready|ready)/im);
  return match?.[1].toLowerCase() as Verdict | undefined;
}

/** Replaces an earlier hand-over (a second review), keeping your own description above it. */
export function withHandOver(description: string, handOver: ReviewHandOver): string {
  const start = description.search(new RegExp(`^## ${WHAT_CHANGED}\\s*$`, 'm'));
  const ownText = (start === -1 ? description : description.slice(0, start)).trimEnd();
  const sections = [
    `## ${WHAT_CHANGED}\n${handOver.whatChanged}`,
    handOver.videoLinks.length ? `## ${VIDEO}\n${handOver.videoLinks.join(' · ')}` : '',
    `## ${COMMIT_MESSAGE}\n\`\`\`\n${handOver.commitMessage}\n\`\`\``,
  ];
  return [ownText, ...sections].filter(Boolean).join('\n\n');
}

/** Reads the hand-over sections from the reviewer's final report. */
export function readHandOver(report: string): Omit<ReviewHandOver, 'videoLinks'> | undefined {
  const whatChanged = readSection(report, WHAT_CHANGED);
  const commitMessage = readCommitMessage(report);
  return whatChanged && commitMessage ? { whatChanged, commitMessage } : undefined;
}
