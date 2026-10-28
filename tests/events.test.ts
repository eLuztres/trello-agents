import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickRepo, toBranchName } from '../src/card.ts';
import { BOT_PREFIX, replanStage, toCardEvent, type Stage } from '../src/events.ts';
import type { TrelloAction } from '../src/trello.ts';

const ME = 'me';
const STAGE_BY_LIST_ID: Record<string, Stage> = { todo: 'plan', doing: 'build', testing: 'review' };

function action(overrides: Partial<TrelloAction>): TrelloAction {
  return { id: '1', type: 'updateCard', idMemberCreator: ME, data: { card: { id: 'card1' } }, ...overrides };
}

describe('toCardEvent', () => {
  it('starts the plan stage for a card created in To Do', () => {
    const event = toCardEvent(action({ type: 'createCard', data: { card: { id: 'card1' }, list: { id: 'todo' } } }), STAGE_BY_LIST_ID, ME);
    assert.deepEqual(event, { kind: 'moved', cardId: 'card1', stage: 'plan' });
  });

  it('maps a move to the target list stage', () => {
    const event = toCardEvent(action({ data: { card: { id: 'card1' }, listAfter: { id: 'doing' } } }), STAGE_BY_LIST_ID, ME);
    assert.deepEqual(event, { kind: 'moved', cardId: 'card1', stage: 'build' });
  });

  it('returns a null stage for a move to an unautomated list like Done', () => {
    const event = toCardEvent(action({ data: { card: { id: 'card1' }, listAfter: { id: 'done' } } }), STAGE_BY_LIST_ID, ME);
    assert.deepEqual(event, { kind: 'moved', cardId: 'card1', stage: null });
  });

  it('ignores card updates that are not moves', () => {
    assert.equal(toCardEvent(action({}), STAGE_BY_LIST_ID, ME), null);
  });

  it('ignores actions by other members', () => {
    const event = toCardEvent(action({ idMemberCreator: 'someone', data: { card: { id: 'card1' }, listAfter: { id: 'doing' } } }), STAGE_BY_LIST_ID, ME);
    assert.equal(event, null);
  });

  it('turns your comments into feedback but ignores bot comments', () => {
    const comment = (text: string) => action({ type: 'commentCard', data: { card: { id: 'card1' }, text } });
    assert.deepEqual(toCardEvent(comment('Use Zod here'), STAGE_BY_LIST_ID, ME), { kind: 'commented', cardId: 'card1', text: 'Use Zod here' });
    assert.equal(toCardEvent(comment(`${BOT_PREFIX} Plan done`), STAGE_BY_LIST_ID, ME), null);
  });
});

describe('toBranchName', () => {
  it('slugs the card name', () => {
    assert.equal(toBranchName(12, 'Fix Cart Total (Rounding!)'), 'card/12-fix-cart-total-rounding');
  });

  it('drops accents and falls back to the number', () => {
    assert.equal(toBranchName(3, 'Überprüfung'), 'card/3-uberprufung');
    assert.equal(toBranchName(4, '🚀'), 'card/4');
  });
});

describe('pickRepo', () => {
  const repos = ['webStore', 'custom'];

  it('picks the repo named by a label, ignoring case', () => {
    assert.equal(pickRepo(['bug', 'Custom'], repos, 'webStore'), 'custom');
  });

  it('falls back to the default repo', () => {
    assert.equal(pickRepo(['bug'], repos, 'webStore'), 'webStore');
  });
});

describe('replanStage', () => {
  const AFTER_PLAN = ['backlog', 'ready'];

  it('plans again on a comment in Backlog or Ready after a finished plan', () => {
    assert.equal(replanStage('plan', 'done', 'backlog', AFTER_PLAN), 'plan');
    assert.equal(replanStage('plan', 'done', 'ready', AFTER_PLAN), 'plan');
  });

  it('ignores comments on cards that were never planned or are elsewhere', () => {
    assert.equal(replanStage(undefined, undefined, 'backlog', AFTER_PLAN), undefined);
    assert.equal(replanStage('build', 'done', 'backlog', AFTER_PLAN), undefined);
    assert.equal(replanStage('plan', 'done', 'done', AFTER_PLAN), undefined);
  });

  it('ignores comments after a plan you stopped by moving the card away', () => {
    assert.equal(replanStage('plan', 'stopped', 'backlog', AFTER_PLAN), undefined);
  });
});
