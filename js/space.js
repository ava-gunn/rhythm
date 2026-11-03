// Exhaustive scoring of every rhythm with k onsets over n pulses (x1 = 0).
//
// Pass 1 computes raw property values once per rhythm and stores them in
// compact typed arrays while tracking min/max for normalisation.
// Pass 2 turns raw values into totals, keeps the best/worst candidates in
// bounded heaps, builds a score histogram and counts ranks for query rhythms.
// Candidates are finally re-scored exactly in float64 for display.

import {
  createContext,
  rawProperties,
  finalizeStats,
  normalize,
  forEachRhythm,
  countRhythms,
  NORMALIZED_KEYS,
} from './rhythm.js';

export const MAX_N = 32;
export const MAX_RHYTHMS = 2_000_000;
/** Above this many rhythms, continuous values are stored as float32. */
const FLOAT64_LIMIT = 300_000;
/** Spaces this small return every rhythm, sorted. */
const RETURN_ALL_LIMIT = 2_000;
const HIST_BINS = 40;

const CONTINUOUS = ['evenness', 'balance', 'area', 'entropyHistogram', 'entropyDurations'];

/**
 * @param {number} k onsets
 * @param {number} n pulses
 * @param {object} [opts]
 * @param {number} [opts.limit=1000]   size of the best list
 * @param {number} [opts.worstLimit=200] size of the worst list
 * @param {number[][]} [opts.queries=[]] rhythms (onset arrays) to rank
 * @param {(fraction: number) => void} [opts.onProgress]
 */
export function scoreSpace(k, n, opts = {}) {
  validate(k, n);
  const { limit = 1000, worstLimit = 200, queries = [], onProgress } = opts;
  const N = countRhythms(k, n);
  const F = N <= (opts.float64Limit ?? FLOAT64_LIMIT) ? Float64Array : Float32Array;
  const eps = F === Float64Array ? 1e-9 : 2e-5;

  const cont = CONTINUOUS.map(() => new F(N));
  const x2 = new Uint8Array(N);
  const xk = new Uint8Array(N);
  const opp = new Uint8Array(N); // onsets with an onset opposite (n even)
  const deep = new Uint16Array(N);
  const rawHits = new Uint8Array(N); // symmetry + shadow + fractal, in units of 1/k

  const min = {},
    max = {};
  for (const key of NORMALIZED_KEYS) {
    min[key] = Infinity;
    max[key] = -Infinity;
  }

  const ctx = createContext(n, k);
  const out = {};
  const progressEvery = 1 << 14;
  let i = 0;

  // ---- Pass 1
  forEachRhythm(k, n, (x) => {
    rawProperties(x, ctx, out);
    for (let c = 0; c < CONTINUOUS.length; c++) cont[c][i] = out[CONTINUOUS[c]];
    x2[i] = x[1];
    xk[i] = x[k - 1];
    opp[i] = n % 2 === 0 ? Math.round((1 - out.oddity) * k) : 0;
    deep[i] = out.deepness;
    rawHits[i] = Math.round((out.symmetry + out.shadow + out.fractal) * k);
    for (const key of NORMALIZED_KEYS) {
      const v = out[key];
      if (v < min[key]) min[key] = v;
      if (v > max[key]) max[key] = v;
    }
    i++;
    if (onProgress && (i & (progressEvery - 1)) === 0) onProgress((0.85 * i) / N);
  });

  const stats = finalizeStats(k, n, min, max);

  // Per-property affine maps and lookup tables for the discrete properties.
  const w = {};
  for (const key of NORMALIZED_KEYS) {
    w[key] = stats.active[key] ? 1 / (max[key] - min[key]) : 0;
  }
  const norm = (key, v) => (stats.active[key] ? clamp01((v - min[key]) * w[key]) : 0);
  const closureLUT = new Float64Array(n);
  const apertureLUT = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    closureLUT[v] = norm('closure', 1 - ctx.orbit[v] / n);
    apertureLUT[v] = norm('aperture', ctx.orbit[v] / n);
  }
  const oddLUT = new Float64Array(k + 1);
  for (let c = 0; c <= k; c++) oddLUT[c] = n % 2 === 0 ? norm('oddity', 1 - c / k) : 0;
  const deepLUT = new Float64Array(ctx.pairs + 1);
  for (let v = 0; v <= ctx.pairs; v++) deepLUT[v] = norm('deepness', v);
  const cMin = CONTINUOUS.map((key) => min[key]);
  const cW = CONTINUOUS.map((key) => w[key]);

  const approxTotal = (idx) => {
    let t = closureLUT[xk[idx]] + apertureLUT[x2[idx]] + oddLUT[opp[idx]] + deepLUT[deep[idx]];
    for (let c = 0; c < CONTINUOUS.length; c++) {
      if (cW[c] !== 0) t += clamp01((cont[c][idx] - cMin[c]) * cW[c]);
    }
    return t + rawHits[idx] / k;
  };

  // ---- Pass 2
  const returnAll = N <= RETURN_ALL_LIMIT;
  const margin = 64;
  const best = new BoundedHeap(returnAll ? N : Math.min(N, limit + margin), true);
  const worst = new BoundedHeap(returnAll ? 0 : Math.min(N, worstLimit + margin), false);

  for (const q of queries) {
    if (q.length !== k || q[0] !== 0) throw new Error(`Query {${q}} is not a rhythm with k=${k} starting at 0`);
  }
  const queryTotals = queries.map((q) => scoreExact(q, n, stats).total);
  const greater = queries.map(() => 0);
  const totals = new F(N);
  let tMin = Infinity,
    tMax = -Infinity,
    tSum = 0;

  i = 0;
  forEachRhythm(k, n, (x) => {
    const t = approxTotal(i);
    totals[i] = t;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
    tSum += t;
    if (best.accepts(t, i)) best.push(t, i, maskOf(x));
    if (worst.capacity && worst.accepts(t, i)) worst.push(t, i, maskOf(x));
    for (let q = 0; q < queryTotals.length; q++) if (t > queryTotals[q] + eps) greater[q]++;
    i++;
    if (onProgress && (i & (progressEvery - 1)) === 0) onProgress(0.85 + (0.15 * i) / N);
  });

  // Histogram of totals (for the distribution chart).
  const bins = new Array(HIST_BINS).fill(0);
  const span = tMax - tMin || 1;
  for (let j = 0; j < N; j++) {
    let b = Math.floor(((totals[j] - tMin) / span) * HIST_BINS);
    if (b >= HIST_BINS) b = HIST_BINS - 1;
    bins[b]++;
  }
  const median = quantileFromHistogram(bins, tMin, span, N, 0.5);

  // Exact re-scoring of the candidates.
  const exact = (entry) => {
    const onsets = fromMask(entry.mask, n);
    const s = scoreExact(onsets, n, stats);
    return { onsets, total: s.total, values: s.values, index: entry.index };
  };
  const bestList = best.items().map(exact);
  bestList.sort((a, b) => b.total - a.total || a.index - b.index);
  rankWithin(bestList, eps);

  let worstList;
  if (returnAll) {
    worstList = bestList.slice().reverse();
  } else {
    worstList = worst.items().map(exact);
    worstList.sort((a, b) => a.total - b.total || b.index - a.index);
    // Rank from the top: 1 + #(score > s) = N − #(score ≤ s) + 1.
    for (const item of worstList) {
      let le = 0;
      for (const other of worstList) if (other.total <= item.total + eps) le++;
      item.rank = N - le + 1;
    }
  }

  const trim = (list, size) => list.slice(0, returnAll ? N : size).map(({ index, ...rest }) => rest);

  return {
    k,
    n,
    count: N,
    stats,
    best: trim(bestList, limit),
    worst: trim(worstList, worstLimit),
    complete: returnAll,
    distribution: { min: tMin, max: tMax, mean: tSum / N, median, bins },
    // Every rhythm's total (enumeration order), for ranking arbitrary rhythms.
    totals,
    epsilon: eps,
    queries: queries.map((q, j) => ({ onsets: q, total: queryTotals[j], rank: greater[j] + 1 })),
  };
}

export function scoreExact(onsets, n, stats) {
  const x = Int32Array.from(onsets);
  const ctx = createContext(n, x.length);
  const raw = rawProperties(x, ctx, {});
  return { raw, ...normalize(raw, stats) };
}

export function validate(k, n) {
  if (!Number.isInteger(k) || !Number.isInteger(n)) throw new Error('k and n must be integers');
  if (n < 3 || n > MAX_N) throw new Error(`n must be between 3 and ${MAX_N}`);
  if (k < 2 || k > n - 1) throw new Error('k must be between 2 and n − 1');
  const N = countRhythms(k, n);
  if (N > MAX_RHYTHMS) {
    throw new Error(
      `${N.toLocaleString('en-US')} rhythms is too many to score on this device (limit ${MAX_RHYTHMS.toLocaleString('en-US')}).`,
    );
  }
}

function rankWithin(sortedDesc, eps) {
  // Items are sorted by total, descending; ties share the best rank.
  let rank = 1;
  for (let j = 0; j < sortedDesc.length; j++) {
    if (j > 0 && sortedDesc[j - 1].total - sortedDesc[j].total > eps) rank = j + 1;
    sortedDesc[j].rank = rank;
  }
}

function quantileFromHistogram(bins, lo, span, N, q) {
  const target = q * N;
  let acc = 0;
  for (let b = 0; b < bins.length; b++) {
    if (acc + bins[b] >= target) {
      const frac = bins[b] ? (target - acc) / bins[b] : 0;
      return lo + ((b + frac) / bins.length) * span;
    }
    acc += bins[b];
  }
  return lo + span;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function maskOf(x) {
  let m = 0;
  for (let j = 0; j < x.length; j++) m |= 1 << x[j];
  return m >>> 0;
}

function fromMask(mask, n) {
  const out = [];
  for (let j = 0; j < n; j++) if ((mask >>> j) & 1) out.push(j);
  return out;
}

/**
 * Keeps the `capacity` best (or worst) entries by score. Ties are resolved
 * towards the lower enumeration index so results are deterministic.
 */
class BoundedHeap {
  constructor(capacity, keepHighest) {
    this.capacity = capacity;
    this.keepHighest = keepHighest;
    this.scores = new Float64Array(capacity);
    this.indices = new Int32Array(capacity);
    this.masks = new Uint32Array(capacity);
    this.size = 0;
  }
  // `a` is "worse" than `b` → it belongs nearer the root (to be evicted first).
  worse(sa, ia, sb, ib) {
    if (sa !== sb) return this.keepHighest ? sa < sb : sa > sb;
    return ia > ib;
  }
  accepts(score, index) {
    if (this.size < this.capacity) return true;
    return this.worse(this.scores[0], this.indices[0], score, index);
  }
  push(score, index, mask) {
    if (this.size < this.capacity) {
      let j = this.size++;
      this.set(j, score, index, mask);
      while (j > 0) {
        const p = (j - 1) >> 1;
        if (!this.worse(this.scores[j], this.indices[j], this.scores[p], this.indices[p])) break;
        this.swap(j, p);
        j = p;
      }
    } else {
      this.set(0, score, index, mask);
      let j = 0;
      for (;;) {
        const l = 2 * j + 1,
          r = l + 1;
        let m = j;
        if (l < this.size && this.worse(this.scores[l], this.indices[l], this.scores[m], this.indices[m])) m = l;
        if (r < this.size && this.worse(this.scores[r], this.indices[r], this.scores[m], this.indices[m])) m = r;
        if (m === j) break;
        this.swap(j, m);
        j = m;
      }
    }
  }
  set(j, s, i, m) {
    this.scores[j] = s;
    this.indices[j] = i;
    this.masks[j] = m;
  }
  swap(a, b) {
    const s = this.scores[a],
      i = this.indices[a],
      m = this.masks[a];
    this.set(a, this.scores[b], this.indices[b], this.masks[b]);
    this.set(b, s, i, m);
  }
  items() {
    const out = [];
    for (let j = 0; j < this.size; j++) out.push({ score: this.scores[j], index: this.indices[j], mask: this.masks[j] });
    return out;
  }
}
