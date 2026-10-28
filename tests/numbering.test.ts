import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toBranchName } from '../src/card.ts';
import { numberedName } from '../src/numbering.ts';

describe('numberedName', () => {
  it('puts the card number in front', () => {
    assert.equal(numberedName(12, 'Fix the cart'), '#12 Fix the cart');
  });

  it('leaves a numbered name alone', () => {
    assert.equal(numberedName(12, '#12 Fix the cart'), '#12 Fix the cart');
  });

  it('replaces a wrong number, e.g. from a copied card', () => {
    assert.equal(numberedName(13, '#12 Fix the cart'), '#13 Fix the cart');
  });
});

describe('toBranchName with a numbered name', () => {
  it('names the number once', () => {
    assert.equal(toBranchName(12, '#12 Fix the cart'), 'card/12-fix-the-cart');
  });
});
