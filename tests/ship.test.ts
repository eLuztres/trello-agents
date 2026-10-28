import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { readCommitMessage, readHandOver, readSection, readVerdict, withHandOver } from '../src/description.ts';
import { ShipBlockedError, squashIntoTarget, withCoAuthor } from '../src/ship-git.ts';

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

  it('refuses when the checkout has uncommitted changes', async () => {
    writeFileSync(path.join(root, 'a.txt'), 'dirty\n');
    await assert.rejects(squashIntoTarget(root, 'card/1', 'main', 'msg'), ShipBlockedError);
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
});
