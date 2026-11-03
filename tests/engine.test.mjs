import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStats,
  countRhythms,
  createContext,
  forEachRhythm,
  normalize,
  rawProperties,
  rotateToOnset,
  necklaceKey,
  durations,
  boxNotation,
  euclidean,
  scoreRhythm,
} from '../js/rhythm.js';
import { scoreSpace, validate, MAX_RHYTHMS } from '../js/space.js';

test('countRhythms matches enumeration', () => {
  for (const [k, n] of [[2, 3], [3, 8], [5, 16], [7, 12], [8, 12], [4, 9]]) {
    let c = 0;
    forEachRhythm(k, n, () => c++);
    assert.equal(c, countRhythms(k, n), `(${k},${n})`);
  }
  assert.equal(countRhythms(12, 24), 1352078);
});

test('enumeration yields sorted rhythms starting at 0', () => {
  forEachRhythm(4, 9, (x) => {
    assert.equal(x[0], 0);
    for (let i = 1; i < x.length; i++) assert.ok(x[i] > x[i - 1] && x[i] < 9);
  });
});

test('helpers', () => {
  assert.deepEqual(rotateToOnset([0, 3, 6, 10, 12], 16, 1), [0, 3, 7, 9, 13]);
  assert.deepEqual(rotateToOnset([0, 3, 6, 10, 12], 16, 5), [0, 3, 6, 10, 12]);
  assert.deepEqual(durations([0, 3, 6, 10, 12], 16), [3, 3, 4, 2, 4]);
  assert.equal(boxNotation([0, 3, 6], 8), 'x..x..x.');
  assert.deepEqual(euclidean(5, 16), [0, 3, 6, 9, 12]);
  // Bossa-nova is a rotation of E(5,16); son is not.
  assert.equal(necklaceKey([0, 3, 6, 10, 13], 16), necklaceKey(euclidean(5, 16), 16));
  assert.notEqual(necklaceKey([0, 3, 6, 10, 12], 16), necklaceKey(euclidean(5, 16), 16));
});

test('odd n: oddity is undefined and excluded from the score', () => {
  const stats = computeStats(4, 9);
  assert.equal(stats.active.oddity, false);
  assert.equal(stats.maxScore, 11);
  const s = scoreRhythm([0, 2, 4, 6], 9, stats);
  assert.equal(s.values.oddity, null);
});

test('prime n: closure and aperture are constant and excluded', () => {
  const stats = computeStats(4, 13);
  assert.equal(stats.active.closure, false);
  assert.equal(stats.active.aperture, false);
  assert.equal(stats.active.oddity, false);
  assert.equal(stats.maxScore, 9);
});

test('scoreSpace agrees with brute force (exact path)', () => {
  const k = 6,
    n = 14;
  const stats = computeStats(k, n);
  const ctx = createContext(n, k);
  const all = [];
  forEachRhythm(k, n, (x) => all.push({ onsets: [...x], total: normalize(rawProperties(x, ctx, {}), stats).total }));
  all.sort((a, b) => b.total - a.total);
  const res = scoreSpace(k, n, { limit: 50 });
  assert.equal(res.count, all.length);
  assert.ok(res.complete);
  res.best.slice(0, 50).forEach((r, i) => assert.ok(Math.abs(r.total - all[i].total) < 1e-9));
  assert.ok(Math.abs(res.distribution.max - all[0].total) < 1e-9);
  assert.equal(
    res.distribution.bins.reduce((a, b) => a + b, 0),
    all.length,
  );
});

test('scoreSpace float32 path ranks like the exact path', () => {
  const k = 7,
    n = 18; // 12,376 rhythms
  const exact = scoreSpace(k, n, { limit: 40, worstLimit: 20 });
  const approx = scoreSpace(k, n, { limit: 40, worstLimit: 20, float64Limit: 0 });
  assert.deepEqual(
    approx.best.map((r) => r.total.toFixed(9)),
    exact.best.map((r) => r.total.toFixed(9)),
  );
  assert.deepEqual(
    approx.worst.map((r) => r.total.toFixed(9)),
    exact.worst.map((r) => r.total.toFixed(9)),
  );
  assert.deepEqual(
    approx.best.map((r) => r.rank),
    exact.best.map((r) => r.rank),
  );
});

test('query ranks', () => {
  const res = scoreSpace(5, 16, { queries: [[0, 3, 6, 10, 12], [0, 3, 6, 10, 13], [0, 3, 6, 10, 11]] });
  assert.equal(res.queries[0].rank, 1); // son
  assert.equal(res.queries[1].rank, 19); // bossa-nova ties with Fig. 2(s)
  assert.ok(res.queries[2].rank > 20);
});

test('worst list ranks count from the top', () => {
  const k = 6,
    n = 16; // 3003 rhythms → not the "return everything" path
  const res = scoreSpace(k, n, { limit: 10, worstLimit: 10 });
  assert.equal(res.complete, false);
  // rank = 1 + number of rhythms scoring strictly higher, so ties share a rank.
  const tied = res.worst.filter((r) => Math.abs(r.total - res.worst[0].total) < 1e-9).length;
  assert.equal(res.worst[0].rank, res.count - tied + 1);
  assert.ok(res.worst[0].total <= res.worst[1].total);
  // Cross-check against the exact path, which returns every rhythm.
  const all = scoreSpace(k, n, { limit: 5000 });
  const brute = all.best.find((r) => r.onsets.join() === res.worst[0].onsets.join());
  assert.equal(brute.rank, res.worst[0].rank);
});

test('validate rejects bad and oversized spaces', () => {
  assert.throws(() => validate(1, 8));
  assert.throws(() => validate(8, 8));
  assert.throws(() => validate(3, 33));
  assert.throws(() => validate(14, 28), /too many/);
  assert.ok(countRhythms(14, 28) > MAX_RHYTHMS);
  assert.doesNotThrow(() => validate(12, 24));
});

test('every (k, n) with n ≤ 14 scores without NaN and within its maximum', () => {
  for (let n = 3; n <= 14; n++) {
    for (let k = 2; k <= n - 1; k++) {
      const res = scoreSpace(k, n);
      const { maxScore } = res.stats;
      assert.ok(maxScore >= 3 && maxScore <= 12, `(${k},${n}) maxScore ${maxScore}`);
      for (const r of [...res.best, ...res.worst]) {
        assert.ok(Number.isFinite(r.total), `(${k},${n}) total`);
        assert.ok(r.total >= -1e-9 && r.total <= maxScore + 1e-9, `(${k},${n}) total ${r.total} > ${maxScore}`);
        for (const [key, v] of Object.entries(r.values)) {
          if (v !== null) assert.ok(v >= 0 && v <= 1, `(${k},${n}) ${key}=${v}`);
          else assert.equal(res.stats.active[key], false);
        }
      }
      assert.equal(res.best[0].rank, 1);
      assert.equal(res.distribution.bins.reduce((a, b) => a + b, 0), res.count);
    }
  }
});
