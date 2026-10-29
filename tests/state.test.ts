import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SHUTDOWN, statusAfterAbort } from '../src/state.ts';

describe('status after an abort', () => {
  it('leaves the job running on a shutdown, so the next start resumes it', () => {
    const controller = new AbortController();
    controller.abort(SHUTDOWN);
    assert.equal(statusAfterAbort(controller.signal.reason), 'running');
  });

  it('marks the job stopped when the card moved or you commented stop', () => {
    const controller = new AbortController();
    controller.abort();
    assert.equal(statusAfterAbort(controller.signal.reason), 'stopped');
  });
});
