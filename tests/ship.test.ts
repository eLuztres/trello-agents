import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it, mock } from 'node:test';
import { readCommitMessage, readHandOver, readSection, readVerdict, withHandOver } from '../src/description.ts';
import { ShipBlockedError, squashIntoTarget, withCoAuthor } from '../src/ship-git.ts';
import { attachVideos, toGif, videoLink } from '../src/ship.ts';
import { REVIEW_VIDEO_DIR, VIDEO_DIR } from '../src/stages.ts';
import { trello, type TrelloCard } from '../src/trello.ts';

const REPORT = [
  'All good, 3 tests added.',
  '',
  '**Verdict: ready**',
  '',
  '## What changed',
  'The cart shows the total.',
  '',
  '## Commit message',
  '```',
  'Show the cart total',
  '',
  '- rounds with round2',
  '```',
].join('\n');

describe('description hand-over', () => {
  it('reads the verdict, also in bold and not confusing "not ready"', () => {
    assert.equal(readVerdict(REPORT), 'ready');
    assert.equal(readVerdict('Verdict: not ready'), 'not ready');
    assert.equal(readVerdict('no verdict here'), undefined);
  });

  it('reads a plan verdict with open questions', () => {
    assert.equal(readVerdict('## Plan\n…\nVerdict: questions'), 'questions');
  });

  it('reads a section up to the next heading', () => {
    assert.equal(readSection(REPORT, 'What changed'), 'The cart shows the total.');
    assert.equal(readSection(REPORT, 'Missing'), undefined);
  });

  it('reads the commit message with or without fences', () => {
    assert.equal(readCommitMessage(REPORT), 'Show the cart total\n\n- rounds with round2');
    assert.equal(readCommitMessage('## Commit message\nMy own words'), 'My own words');
    assert.equal(readCommitMessage('## Commit message\n```\n```'), undefined);
  });

  it('appends the hand-over and replaces an earlier one, keeping the card text', () => {
    const handOver = readHandOver(REPORT);
    assert.ok(handOver);
    const first = withHandOver('Make the cart nicer.', { ...handOver, videoLinks: ['[desktop](u1)'] });
    const second = withHandOver(first, { whatChanged: 'New text.', commitMessage: 'New message', videoLinks: [] });
    assert.equal(second, 'Make the cart nicer.\n\n## What changed\nNew text.\n\n## Commit message\n```\nNew message\n```');
    assert.match(first, /## Video\n\[desktop\]\(u1\)/);
    assert.equal(readCommitMessage(first), 'Show the cart total\n\n- rounds with round2');
  });
});

describe('withCoAuthor', () => {
  it('adds the line once', () => {
    assert.match(withCoAuthor('Subject'), /^Subject\n\nCo-Authored-By: Claude/);
    assert.equal(withCoAuthor('Subject\n\nCo-authored-by: Me <me@x>'), 'Subject\n\nCo-authored-by: Me <me@x>');
  });
});

describe('squashIntoTarget', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ship-'));
  after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const commitFile = (name: string, text: string) => {
    writeFileSync(path.join(root, name), text);
    git('add', name);
    git('commit', '-qm', `edit ${name}`);
  };

  git('init', '-qb', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  commitFile('a.txt', 'one\n');
  git('checkout', '-qb', 'card/1');
  commitFile('a.txt', 'card\n');
  commitFile('b.txt', 'new\n');
  git('checkout', '-q', 'main');

  it('refuses when a file the card changes has uncommitted changes', async () => {
    writeFileSync(path.join(root, 'a.txt'), 'dirty\n');
    await assert.rejects(squashIntoTarget(root, 'card/1', 'main', 'msg'), /files this card changes[\s\S]*a\.txt/);
    git('checkout', '--', 'a.txt');
  });

  it('refuses a conflict and leaves the checkout clean', async () => {
    commitFile('a.txt', 'main\n');
    await assert.rejects(squashIntoTarget(root, 'card/1', 'main', 'msg'), /Conflicting files:\na\.txt/);
    assert.equal(git('status', '--porcelain', '--untracked-files=no'), '');
    git('reset', '-q', '--hard', 'HEAD~1');
  });

  it('commits the branch as one commit with the message', async () => {
    const hash = await squashIntoTarget(root, 'card/1', 'main', 'Card one');
    assert.equal(git('rev-parse', '--short', 'HEAD'), hash);
    assert.equal(git('log', '-1', '--format=%B'), 'Card one\n\nCo-Authored-By: Claude <noreply@anthropic.com>');
    assert.equal(git('rev-list', '--count', 'HEAD'), '2');
  });

  it('refuses when there is nothing left to commit', async () => {
    await assert.rejects(squashIntoTarget(root, 'card/1', 'main', 'again'), /Nothing to commit/);
  });

  it('commits next to unrelated uncommitted work and leaves it alone', async () => {
    commitFile('other.txt', 'base\n');
    git('checkout', '-qb', 'card/4', 'main');
    commitFile('card-4.txt', 'new\n');
    git('checkout', '-q', 'main');
    writeFileSync(path.join(root, 'other.txt'), 'someone else is working here\n');
    writeFileSync(path.join(root, 'draft.txt'), 'untracked\n');

    await squashIntoTarget(root, 'card/4', 'main', 'Card four');
    assert.equal(git('log', '-1', '--format=%s'), 'Card four');
    assert.equal(git('show', '--name-only', '--format=', 'HEAD'), 'card-4.txt');
    assert.equal(git('status', '--porcelain'), 'M other.txt\n?? draft.txt');
    git('checkout', '--', 'other.txt');
    rmSync(path.join(root, 'draft.txt'));
  });

  it('commits two cards moved at the same time one after the other', async () => {
    for (const card of ['card/2', 'card/3']) {
      git('checkout', '-qb', card, 'main');
      commitFile(`${card.replace('/', '-')}.txt`, 'new\n');
    }
    git('checkout', '-q', 'main');
    const hashes = await Promise.all([squashIntoTarget(root, 'card/2', 'main', 'Card two'), squashIntoTarget(root, 'card/3', 'main', 'Card three')]);
    assert.notEqual(hashes[0], hashes[1]);
    assert.equal(git('log', '-2', '--format=%s'), 'Card three\nCard two');
  });
});

describe('change videos', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'videos-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('links the GIF first and the recording as the full video', () => {
    assert.equal(videoLink('desktop', 'https://t/a.gif', 'https://t/a.webm'), '[desktop](https://t/a.gif) ([full video](https://t/a.webm))');
    assert.equal(videoLink('phone', 'https://t/b.gif'), '[phone](https://t/b.gif)');
  });

  it('turns a recording into a GIF with the same name', async () => {
    const videoPath = path.join(dir, 'card-1-desktop.webm');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=10', videoPath]);
    const gifPath = await toGif(videoPath);
    assert.equal(gifPath, path.join(dir, 'card-1-desktop.gif'));
    assert.equal(readFileSync(gifPath).subarray(0, 6).toString(), 'GIF89a');
  });
});

describe('attachVideos', () => {
  const card = { id: 'c1', idShort: 999_328 } as TrelloCard;
  const recording = path.join(VIDEO_DIR, `card-${card.idShort}-desktop.webm`);
  const leftovers = () => readdirSync(VIDEO_DIR).filter((name) => name.startsWith(`card-${card.idShort}-`));
  const record = () => {
    mkdirSync(VIDEO_DIR, { recursive: true });
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=10', recording]);
  };
  after(() => {
    mock.restoreAll();
    // A successful upload also copies the recording to the review page folder.
    rmSync(path.join(REVIEW_VIDEO_DIR, path.basename(recording)), { force: true });
  });

  it('attaches the GIF and the recording, makes the GIF the cover and cleans up', async () => {
    record();
    const attached: string[] = [];
    mock.method(trello, 'attachFile', async (_cardId: string, filePath: string) => {
      attached.push(path.basename(filePath));
      return { id: path.extname(filePath), url: `https://t/${path.basename(filePath)}`, name: path.basename(filePath) };
    });
    const setCover = mock.method(trello, 'setCover', async () => ({}));
    const links = await attachVideos(card);
    assert.deepEqual(attached, ['card-999328-desktop.gif', 'card-999328-desktop.webm']);
    assert.deepEqual(links, ['[desktop](https://t/card-999328-desktop.gif) ([full video](https://t/card-999328-desktop.webm))']);
    assert.deepEqual(setCover.mock.calls[0].arguments, ['c1', '.gif']);
    assert.deepEqual(leftovers(), []);
  });

  it('still attaches the recording when the GIF upload fails', async () => {
    record();
    mock.method(trello, 'attachFile', async (_cardId: string, filePath: string) => {
      if (filePath.endsWith('.gif')) throw new Error('file too large');
      return { id: 'webm', url: `https://t/${path.basename(filePath)}`, name: path.basename(filePath) };
    });
    const setCover = mock.method(trello, 'setCover', async () => ({}));
    mock.method(console, 'error', () => {});
    assert.deepEqual(await attachVideos(card), ['[desktop](https://t/card-999328-desktop.webm)']);
    assert.equal(setCover.mock.callCount(), 0);
    assert.deepEqual(leftovers(), []);
  });

  it('keeps the recording for a retry but leaves no GIF behind when an upload fails', async () => {
    record();
    mock.method(trello, 'attachFile', async () => { throw new Error('Trello down'); });
    const setCover = mock.method(trello, 'setCover', async () => ({}));
    mock.method(console, 'error', () => {});
    assert.deepEqual(await attachVideos(card), []);
    assert.equal(setCover.mock.callCount(), 0);
    assert.deepEqual(leftovers(), ['card-999328-desktop.webm']);
    rmSync(recording);
  });
});
