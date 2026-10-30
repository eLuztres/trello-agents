import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { videoForTrello } from '../src/shrink-video.ts';

describe('videoForTrello', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'shrink-video-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps a video that already fits', async () => {
    const filePath = path.join(dir, 'card-1-small.webm');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1', '-c:v', 'libvpx-vp9', filePath]);
    assert.equal(await videoForTrello(filePath), filePath);
  });

  it('keeps a GIF whatever its size', async () => {
    const filePath = path.join(dir, 'card-1-big.gif');
    writeFileSync(filePath, Buffer.alloc(11 * 1024 * 1024));
    assert.equal(await videoForTrello(filePath), filePath);
  });
});
