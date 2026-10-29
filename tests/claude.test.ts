import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { after, describe, it } from 'node:test';
import { runClaude, type ClaudeRun } from '../src/claude.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'claude-test-'));
const pidFile = path.join(dir, 'shell.pid');
after(() => rmSync(dir, { recursive: true, force: true }));

// A fake claude that, like the real one, starts a shell and ignores SIGTERM.
writeFileSync(path.join(dir, 'claude'), `#!/bin/sh\ntrap '' TERM\nsleep 30 &\necho $! > ${pidFile}\nwait\n`);
chmodSync(path.join(dir, 'claude'), 0o755);
process.env.PATH = `${dir}${path.delimiter}${process.env.PATH}`;

const RUN: ClaudeRun = {
  cwd: dir,
  prompt: '',
  permissionMode: 'auto',
  sessionId: 'test',
  shouldResume: false,
  maxBudgetUsd: 1,
  appendSystemPrompt: '',
  disallowedTools: [],
  logFile: path.join(dir, 'run.log'),
};

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPid(): Promise<number> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const pid = Number(readFileSync(pidFile, { flag: 'a+', encoding: 'utf8' }));
    if (pid) return pid;
    await sleep(50);
  }
  throw new Error('fake claude did not start');
}

describe('stopping an agent', () => {
  it('kills claude and the shells it started', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const result = runClaude(RUN, controller.signal);
    const shellPid = await waitForPid();

    controller.abort('shutdown');
    await assert.rejects(result, /stopped/);
    assert.ok(Date.now() - started < 5_000, 'took as long as the shell, so it was not killed');
    await sleep(100);
    assert.equal(isAlive(shellPid), false);
  });
});
