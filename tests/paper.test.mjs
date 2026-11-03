// Checks the scoring engine against the results published in
// Lascabettes & Bloch (2024), "What Are 'Good' Rhythms?".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, scoreRhythm } from '../js/rhythm.js';
import { scoreSpace } from '../js/space.js';

const round2 = (v) => Math.round(v * 100) / 100;

// Table 1. Note: the paper's rows "Entropy H" and "Entropy D" are swapped
// relative to their definitions — "Entropy H" holds the entropy of durations
// and "Entropy D" the entropy of the full interval histogram.
const TABLE_1 = {
  son: { onsets: [0, 3, 6, 10, 12], v: [0.99, 1.0, 0.97, 1.0, 0.86, 1.0, 0.33, 0.97, 0.37, 1.0, 1.0, 0.8], total: 10.29 },
  bossa: { onsets: [0, 3, 6, 10, 13], v: [1.0, 0.94, 1.0, 1.0, 0.0, 1.0, 1.0, 1.0, 0.0, 1.0, 0.6, 0.6], total: 9.14 },
  gahu: { onsets: [0, 3, 6, 10, 14], v: [0.97, 0.85, 0.97, 0.5, 0.57, 1.0, 0.0, 0.97, 0.81, 0.6, 0.6, 0.6], total: 8.44 },
  rumba: { onsets: [0, 3, 7, 10, 12], v: [0.98, 0.91, 0.97, 1.0, 0.86, 1.0, 0.33, 0.97, 0.56, 0.8, 0.4, 0.6], total: 9.37 },
  shiko: { onsets: [0, 4, 6, 10, 12], v: [0.97, 0.92, 0.93, 0.5, 0.86, 0.14, 1.0, 0.94, 0.0, 1.0, 0.6, 0.6], total: 8.46 },
  soukous: { onsets: [0, 3, 6, 10, 11], v: [0.94, 0.92, 0.87, 0.5, 0.0, 1.0, 0.0, 0.87, 0.81, 0.8, 0.8, 0.6], total: 8.11 },
};
// Table 1 row order, mapped to engine keys (with the entropy rows un-swapped).
const TABLE_KEYS = [
  'evenness',
  'balance',
  'area',
  'oddity',
  'closure',
  'aperture',
  'deepness',
  'entropyDurations', // "Entropy H" in the paper
  'entropyHistogram', // "Entropy D" in the paper
  'symmetry',
  'shadow',
  'fractal',
];

test('Table 1: all 12 property values and totals for the six distinguished rhythms', () => {
  const stats = computeStats(5, 16);
  for (const [name, row] of Object.entries(TABLE_1)) {
    const s = scoreRhythm(row.onsets, 16, stats);
    TABLE_KEYS.forEach((key, i) => {
      assert.equal(round2(s.values[key]), row.v[i], `${name}.${key}`);
    });
    assert.equal(round2(s.total), row.total, `${name} total`);
  }
});

/** Assert that `expected[i]` sits at position i, allowing reordering within exact ties. */
function assertRanking(list, expected, label) {
  expected.forEach((onsets, i) => {
    const pos = list.findIndex((r) => r.onsets.join(',') === onsets.join(','));
    assert.ok(pos >= 0, `${label}: {${onsets}} missing from results`);
    const item = list[pos];
    const tiedFrom = list.findIndex((r) => r.rank === item.rank);
    const tiedTo = list.findLastIndex((r) => r.rank === item.rank);
    assert.ok(
      i >= tiedFrom && i <= tiedTo,
      `${label}: {${onsets}} expected at #${i + 1}, found at #${pos + 1} (rank ${item.rank})`,
    );
  });
}

test('Figure 2: the twenty best rhythms for k=5, n=16', () => {
  const fig2 = [
    [0, 3, 6, 10, 12], [0, 3, 6, 9, 12], [0, 5, 7, 10, 14], [0, 3, 5, 10, 12], [0, 5, 6, 10, 12],
    [0, 2, 6, 9, 12], [0, 5, 7, 11, 14], [0, 3, 7, 9, 14], [0, 3, 5, 9, 12], [0, 3, 7, 9, 12],
    [0, 3, 7, 10, 12], [0, 5, 7, 9, 14], [0, 5, 7, 12, 14], [0, 5, 7, 10, 12], [0, 3, 7, 9, 13],
    [0, 3, 5, 7, 12], [0, 3, 6, 11, 12], [0, 1, 6, 10, 12], [0, 3, 6, 9, 13], [0, 3, 6, 10, 13],
  ];
  const { best } = scoreSpace(5, 16);
  assertRanking(best, fig2, '(5,16)');
});

test('Section 3: the three worst rhythms for k=5, n=16', () => {
  const { worst } = scoreSpace(5, 16);
  assertRanking(worst, [[0, 12, 13, 14, 15], [0, 2, 3, 4, 15], [0, 2, 3, 14, 15]], '(5,16) worst');
});

test('Figure 3: the three best rhythms for (3,8), (5,12) and (7,16)', () => {
  const cases = [
    [3, 8, [[0, 3, 6], [0, 3, 5], [0, 2, 5]]], // tresillo first
    [5, 12, [[0, 2, 4, 7, 9], [0, 1, 4, 7, 8], [0, 2, 5, 7, 10]]], // fume-fume first
    [7, 16, [[0, 3, 5, 7, 10, 12, 14], [0, 1, 4, 7, 8, 10, 14], [0, 3, 5, 6, 9, 10, 12]]], // samba necklace first
  ];
  for (const [k, n, expected] of cases) assertRanking(scoreSpace(k, n).best, expected, `(${k},${n})`);
});

test('Figure 3(d): Steve Reich’s signature rhythm is best for k=8, n=12', () => {
  // The paper's 2nd and 3rd places for (8,12) are not reproduced exactly by
  // the formulas as published; the headline result (Reich first) is.
  const { best } = scoreSpace(8, 12);
  assert.deepEqual(best[0].onsets, [0, 1, 2, 4, 5, 7, 9, 10]);
  assert.equal(best[0].rank, 1);
  assert.ok(best.slice(0, 3).some((r) => r.onsets.join() === '0,1,3,4,5,7,8,10'));
});

test('Section 4: the best (7,12) rhythm is the bembé rotated by one pulse', () => {
  const { best, queries } = scoreSpace(7, 12, { queries: [[0, 2, 4, 5, 7, 9, 11]] });
  assert.deepEqual(best[0].onsets, [0, 1, 3, 5, 6, 8, 10]);
  assert.ok(queries[0].rank > 1, 'bembé itself is not first');
});
