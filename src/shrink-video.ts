import { execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Trello's free plan refuses attachments over 10 MB; stay a little below.
const MAX_ATTACHMENT_BYTES = 9.5 * 1024 * 1024;
// Halved after each try that is still too big. Recorded webm files often state a wrong length, so it can't be computed.
const START_KBPS = 600;
const MAX_TRIES = 3;

/** A copy small enough for Trello (720p, lower bitrate), or the file itself when it already fits. */
export async function videoForTrello(filePath: string): Promise<string> {
  const { base, ext, dir } = path.parse(filePath);
  if (!['.webm', '.mp4'].includes(ext) || (await stat(filePath)).size <= MAX_ATTACHMENT_BYTES) return filePath;
  // Same file name in a subfolder, so the attachment keeps the name the card links show.
  await mkdir(path.join(dir, 'small'), { recursive: true });
  const smallPath = path.join(dir, 'small', base);
  const codec = ext === '.mp4' ? ['-c:v', 'libx264', '-preset', 'veryfast'] : ['-c:v', 'libvpx-vp9', '-deadline', 'good', '-cpu-used', '5', '-row-mt', '1'];
  for (let attempt = 0, kbps = START_KBPS; attempt < MAX_TRIES; attempt++, kbps /= 2) {
    await execFileAsync('ffmpeg', ['-loglevel', 'error', '-y', '-i', filePath, '-vf', 'scale=-2:min(720\\,ih)', ...codec, '-b:v', `${kbps}k`, '-an', smallPath]);
    if ((await stat(smallPath)).size <= MAX_ATTACHMENT_BYTES) break;
  }
  return smallPath;
}
