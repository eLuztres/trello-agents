import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BUILD_MARKER, planStageRun, takeBuildRequest } from '../src/stages.ts';
import type { CardState } from '../src/state.ts';
import type { TrelloCard } from '../src/trello.ts';

const CARD: TrelloCard = { id: 'card1', idShort: 7, idList: 'backlog', name: 'Coupons', desc: 'Add coupons', shortUrl: 'https://trello.com/c/x', labels: [] };
const CARD_STATE: CardState = { idShort: 7, name: 'Coupons', repo: 'shop-baifo', branch: 'card/7-coupons', worktree: '/tmp/wt', devSessionId: 'dev-session' };

describe('takeBuildRequest', () => {
  it('strips the marker from the last line', () => {
    assert.deepEqual(takeBuildRequest(`Sure, I build it.\n\n${BUILD_MARKER}\n`), { text: 'Sure, I build it.', shouldBuild: true });
  });

  it('leaves replies without the marker alone', () => {
    const text = `I would not build it yet. Need from you: the coupon rules.`;
    assert.deepEqual(takeBuildRequest(text), { text, shouldBuild: false });
  });

  it('accepts the marker in backticks, as the prompt shows it', () => {
    assert.deepEqual(takeBuildRequest(`On it.\n\`${BUILD_MARKER}\``), { text: 'On it.', shouldBuild: true });
  });

  it('ignores the marker when it is not the last line', () => {
    assert.equal(takeBuildRequest(`${BUILD_MARKER}\nbut not yet`).shouldBuild, false);
  });
});

describe('planStageRun', () => {
  it('runs chat read-only in a fresh session, with the comments in the brief', () => {
    const run = planStageRun('chat', CARD, CARD_STATE, 'main', ['newest question', 'older note'], 'newest question');
    assert.equal(run.permissionMode, 'plan');
    assert.equal(run.shouldResume, false);
    assert.notEqual(run.sessionId, 'dev-session');
    assert.ok(run.disallowedTools.includes('Edit') && run.disallowedTools.includes('Write'));
    assert.ok(run.prompt.indexOf('- older note') < run.prompt.indexOf('- newest question'));
    assert.match(run.prompt, /Stage: CHAT/);
  });

  it('asks a resumed build to answer the comment first', () => {
    const run = planStageRun('build', CARD, CARD_STATE, 'main', [], 'use Zod');
    assert.equal(run.shouldResume, true);
    assert.equal(run.sessionId, 'dev-session');
    assert.match(run.prompt, /use Zod\nStart your final message by answering this comment directly/);
  });

  it('starts review fresh, but resumes its session to answer a comment', () => {
    const cardState = { ...CARD_STATE, reviewSessionId: 'review-session' };
    assert.equal(planStageRun('review', CARD, cardState, 'main', []).shouldResume, false);
    const run = planStageRun('review', CARD, cardState, 'main', [], 'add a test');
    assert.equal(run.sessionId, 'review-session');
    assert.equal(run.permissionMode, 'auto');
    assert.ok(!run.disallowedTools.includes('Edit'));
  });

  it('does not ask chat to answer first, it only answers', () => {
    const run = planStageRun('chat', CARD, CARD_STATE, 'main', [], 'why?');
    assert.doesNotMatch(run.prompt, /Start your final message by answering/);
  });

  it('keeps only the 20 newest comments and shortens long ones', () => {
    const comments = Array.from({ length: 25 }, (_, index) => `comment ${index}`);
    comments[0] = 'x'.repeat(2500);
    const run = planStageRun('chat', CARD, CARD_STATE, 'main', comments, 'hi');
    assert.match(run.prompt, /comment 19\n/);
    assert.doesNotMatch(run.prompt, /comment 20\n/);
    assert.match(run.prompt, /- x{2000} …/);
    assert.doesNotMatch(run.prompt, /x{2001}/);
  });

  it('leaves out the comments section when there are none', () => {
    const run = planStageRun('chat', CARD, CARD_STATE, 'main', [], 'hi');
    assert.doesNotMatch(run.prompt, /Comments so far/);
  });
});
