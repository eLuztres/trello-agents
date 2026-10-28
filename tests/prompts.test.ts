import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planStageRun } from '../src/stages.ts';
import type { CardState } from '../src/state.ts';
import type { TrelloCard } from '../src/trello.ts';

const CARD: TrelloCard = { id: 'c1', idShort: 7, idList: 'l1', name: 'Cart total', desc: '', shortUrl: 'https://trello.com/c/x', labels: [] };
const CARD_STATE: CardState = { idShort: 7, name: 'Cart total', repo: 'webStore', branch: 'card/7-cart-total', worktree: '/tmp/wt' };

const promptOf = (stage: 'plan' | 'build' | 'review') => planStageRun(stage, CARD, CARD_STATE, 'main', []).prompt;

describe('stage prompts', () => {
  it('asks the plan for a verdict that picks Ready or Backlog', () => {
    assert.match(promptOf('plan'), /Verdict: ready.*Ready/);
    assert.match(promptOf('plan'), /Verdict: questions.*Backlog/);
  });

  it('asks build and review for videos of UI changes, or "no UI change"', () => {
    for (const stage of ['build', 'review'] as const) {
      assert.match(promptOf(stage), /card-7-desktop\.webm.*375px.*card-7-phone\.webm/);
      assert.match(promptOf(stage), /🎬 Video: no UI change/);
    }
    assert.doesNotMatch(promptOf('plan'), /recordVideo/);
  });
});
