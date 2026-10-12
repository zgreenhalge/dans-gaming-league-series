import assert from 'node:assert/strict';
import { tallyVotes, validateSuperlativeOrder, validateSuperlativeTitle, validateSuperlativeVotes } from './superlatives';
import { test, report } from './test-support/miniTest';

test('validateSuperlativeOrder requires a permutation of the current ids', () => {
  assert.deepEqual(validateSuperlativeOrder([1, 2, 3], [3, 1, 2]), { ok: true, value: [3, 1, 2] });
  assert.equal(validateSuperlativeOrder([1, 2, 3], [1, 2]).ok, false);
  assert.equal(validateSuperlativeOrder([1, 2, 3], [1, 1, 2]).ok, false);
  assert.equal(validateSuperlativeOrder([1, 2, 3], [1, 2, 9]).ok, false);
  assert.equal(validateSuperlativeOrder([1], 'x').ok, false);
});

test('validateSuperlativeTitle trims and bounds titles', () => {
  assert.deepEqual(validateSuperlativeTitle('  Best Teammate '), { ok: true, value: 'Best Teammate' });
  assert.equal(validateSuperlativeTitle('   ').ok, false);
  assert.equal(validateSuperlativeTitle(42).ok, false);
  assert.equal(validateSuperlativeTitle('x'.repeat(81)).ok, false);
});

test('validateSuperlativeVotes checks superlatives, nominees, and one vote per superlative', () => {
  const ok = validateSuperlativeVotes([1, 2], [10, 11], [{ superlative_id: 1, nominee_player_id: 10 }]);
  assert.deepEqual(ok, { ok: true, value: [{ superlative_id: 1, nominee_player_id: 10 }] });
  assert.equal(validateSuperlativeVotes([1], [10], [{ superlative_id: 9, nominee_player_id: 10 }]).ok, false);
  assert.equal(validateSuperlativeVotes([1], [10], [{ superlative_id: 1, nominee_player_id: 99 }]).ok, false);
  assert.equal(
    validateSuperlativeVotes([1], [10, 11], [
      { superlative_id: 1, nominee_player_id: 10 },
      { superlative_id: 1, nominee_player_id: 11 },
    ]).ok,
    false,
  );
  assert.equal(validateSuperlativeVotes([1], [10], 'x').ok, false);
  // Ids are not coerced: a boolean, string, or array never stands in for a real id.
  assert.equal(validateSuperlativeVotes([1], [10], [{ superlative_id: true, nominee_player_id: 10 }]).ok, false);
  assert.equal(validateSuperlativeVotes([1], [10], [{ superlative_id: 1, nominee_player_id: '10' }]).ok, false);
  assert.equal(validateSuperlativeVotes([1], [10], [{ superlative_id: [1], nominee_player_id: 10 }]).ok, false);
});

test('tallyVotes orders by votes, then player id', () => {
  assert.deepEqual(tallyVotes([5, 3, 5, 3, 7]), [
    { player_id: 3, votes: 2 },
    { player_id: 5, votes: 2 },
    { player_id: 7, votes: 1 },
  ]);
  assert.deepEqual(tallyVotes([]), []);
});

report();
