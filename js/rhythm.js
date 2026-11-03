// Scoring engine for "good" rhythms.
//
// Implements the 12 properties from Lascabettes & Bloch, "What Are 'Good'
// Rhythms? Generating Rhythms Based on the Properties Set Out in The Geometry
// of Musical Rhythm" (MCM 2024).
//
// A rhythm with k onsets over n pulses is a sorted array of distinct integers
// in [0, n) whose first element is 0 (the paper's x1 = 0 convention).
//
// Nine properties are min-max normalised over every rhythm with the same
// (k, n); symmetry, shadow and fractal are used as-is (they already lie in
// [0, 1]), exactly as described in Section 2 of the paper.

const TAU = Math.PI * 2;

export const PROPERTIES = [
  {
    key: 'evenness',
    label: 'Evenness',
    normalized: true,
    short: 'How close the onsets are to a regular polygon.',
    detail:
      'Measures how well the onsets are spread out in time. It is highest for Euclidean rhythms, which come as close as possible to a regular polygon (Milne et al.).',
    formula: '| (1/k) Σ exp(2πi (xⱼ/n − j/k)) |',
  },
  {
    key: 'balance',
    label: 'Balance',
    normalized: true,
    short: 'How close the polygon’s centroid is to the centre.',
    detail:
      'A balanced rhythm has its centre of mass at the centre of the circle. This is not the same as evenness: the son clave is more balanced than the bossa-nova, even though the bossa-nova is more even.',
    formula: '1 − | (1/k) Σ exp(2πi xⱼ/n) |',
  },
  {
    key: 'area',
    label: 'Area',
    normalized: true,
    short: 'Area of the rhythm’s polygon.',
    detail:
      'Spread-out onsets give a large polygon. It is computed as a sum of isosceles triangles meeting at the centre of the circle.',
    formula: '½ Σ sin(2π dⱼ/n)',
  },
  {
    key: 'oddity',
    label: 'Oddity',
    normalized: true,
    evenOnly: true,
    short: 'Few pairs of onsets exactly half a cycle apart.',
    detail:
      'Rhythmic oddity (Arom): no two onsets split the cycle into two equal halves. The score is the share of onsets that have no partner directly opposite them. It is only defined when n is even.',
    formula: '1 − (1/k) |R ∩ (R + n/2)|',
  },
  {
    key: 'closure',
    label: 'Closure',
    normalized: true,
    short: 'The last onset falls on a strong beat.',
    detail:
      'Toussaint’s closure, made gradual: the smaller the orbit of the last onset (the subgroup it generates in ℤₙ), the stronger the beat. Landing on a strong beat feels like a resolution.',
    formula: '1 − |Orb(xₖ)| / n',
  },
  {
    key: 'aperture',
    label: 'Aperture',
    normalized: true,
    short: 'The second onset falls on a weak beat.',
    detail:
      'The counterpart of closure: a second onset on a weak beat (large orbit) creates tension early in the cycle. This partly explains why the tresillo works so well.',
    formula: '|Orb(x₂)| / n',
  },
  {
    key: 'deepness',
    label: 'Deepness',
    normalized: true,
    short: 'Each interval occurs a different number of times.',
    detail:
      'In a deep rhythm, the multiplicities in the full interval histogram are exactly 1, 2, …, k−1. The score is based on how far the sorted histogram is from the best-fitting ramp.',
    formula: 'k(k−1)/2 − minₚ Σⱼ | hⱼ − max(0, j+1−p) |',
  },
  {
    key: 'entropyHistogram',
    label: 'Interval entropy',
    normalized: true,
    short: 'All the intervals between onsets occur about equally often.',
    detail:
      'Shannon entropy of the normalised full interval-content histogram (distances between every pair of onsets). A flat histogram scores highest.',
    formula: '− Σ pⱼ log₂ pⱼ',
  },
  {
    key: 'entropyDurations',
    label: 'Duration entropy',
    normalized: true,
    short: 'The gaps between consecutive onsets are similar.',
    detail:
      'Entropy of the durations between consecutive onsets, using dⱼ/n as a probability distribution. This is another way of rewarding onsets that are spread out in time.',
    formula: '− Σ (dⱼ/n) log₂ (dⱼ/n)',
  },
  {
    key: 'symmetry',
    label: 'Symmetry',
    normalized: false,
    short: 'The polygon has a mirror axis.',
    detail:
      'The largest fraction of onsets that a single reflection of the circle maps back onto onsets.',
    formula: 'maxⱼ (1/k) |Sⱼ(R) ∩ R|',
  },
  {
    key: 'shadow',
    label: 'Shadow',
    normalized: false,
    short: 'The shadow has the same contour as the rhythm.',
    detail:
      'The shadow rhythm puts its onsets at the midpoints between consecutive onsets. The score compares the cyclic up/down contour of the durations with the contour of the shadow’s durations, over every rotation.',
    formula: 'maxⱼ (1/k) |{ i : crᵢ = csᵢ₊ⱼ }|',
  },
  {
    key: 'fractal',
    label: 'Fractal',
    normalized: false,
    short: 'The opening, stretched out, is still part of the rhythm.',
    detail:
      'Measures self-similarity: take the onsets in the first n/l pulses, multiply them by l, and see whether they land on onsets too. The score is the share of the rhythm that this covers, using the best l.',
    formula: '(1/k) max |R′ ∪ lR′|,  R′ ⊆ R/l,  lR′ ⊆ R',
  },
];

export const PROPERTY_KEYS = PROPERTIES.map((p) => p.key);
export const NORMALIZED_KEYS = PROPERTIES.filter((p) => p.normalized).map((p) => p.key);
export const RAW_KEYS = PROPERTIES.filter((p) => !p.normalized).map((p) => p.key);

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Size of the orbit {x·y mod n}: the subgroup of ℤₙ generated by x. */
export function orbitSize(x, n) {
  return n / gcd(x, n);
}

/**
 * Reusable scratch buffers so the hot loop in the worker does not allocate.
 * One context per (n, k) pair.
 */
export function createContext(n, k) {
  const half = Math.floor(n / 2);
  const cosT = new Float64Array(n);
  const sinT = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    cosT[i] = Math.cos((TAU * i) / n);
    sinT[i] = Math.sin((TAU * i) / n);
  }
  const cosK = new Float64Array(k);
  const sinK = new Float64Array(k);
  for (let j = 0; j < k; j++) {
    cosK[j] = Math.cos((TAU * j) / k);
    sinK[j] = Math.sin((TAU * j) / k);
  }
  // −p log₂ p for durations d/n, indexed by d.
  const durEnt = new Float64Array(n + 1);
  for (let d = 1; d <= n; d++) {
    const p = d / n;
    durEnt[d] = -p * Math.log2(p);
  }
  // −p log₂ p for histogram counts c/(k(k−1)/2), indexed by c.
  const pairs = (k * (k - 1)) / 2;
  const histEnt = new Float64Array(pairs + 1);
  for (let c = 1; c <= pairs; c++) {
    const p = c / pairs;
    histEnt[c] = -p * Math.log2(p);
  }
  const areaT = new Float64Array(n + 1);
  for (let d = 0; d <= n; d++) areaT[d] = Math.sin((TAU * d) / n);
  const orbit = new Int32Array(n);
  for (let x = 0; x < n; x++) orbit[x] = orbitSize(x, n);

  return {
    n,
    k,
    half,
    pairs,
    cosT,
    sinT,
    cosK,
    sinK,
    durEnt,
    histEnt,
    areaT,
    orbit,
    member: new Uint8Array(2 * n),
    durations: new Int32Array(k),
    hist: new Int32Array(half + 1),
    sorted: new Int32Array(half),
    counts: new Int32Array(pairs + 2),
    cr: new Int8Array(k),
    cs: new Int8Array(k),
  };
}

const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

function popcount(v) {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * Compute the raw (un-normalised) value of every property.
 * `x` is a sorted onset array starting at 0, `ctx` from createContext(n, k).
 * Writes into `out` (an object) and returns it.
 */
export function rawProperties(x, ctx, out = {}) {
  const { n, k, half, cosT, sinT, cosK, sinK, member, durations: d } = ctx;

  member.fill(0);
  for (let i = 0; i < k; i++) {
    member[x[i]] = 1;
    member[x[i] + n] = 1;
  }
  for (let i = 0; i < k - 1; i++) d[i] = x[i + 1] - x[i];
  d[k - 1] = x[0] + n - x[k - 1];

  // Evenness and balance: both are magnitudes of complex means.
  let er = 0,
    ei = 0,
    br = 0,
    bi = 0;
  for (let j = 0; j < k; j++) {
    const c = cosT[x[j]],
      s = sinT[x[j]];
    br += c;
    bi += s;
    // exp(i(a − b)) = (cos a cos b + sin a sin b) + i(sin a cos b − cos a sin b)
    er += c * cosK[j] + s * sinK[j];
    ei += s * cosK[j] - c * sinK[j];
  }
  out.evenness = Math.hypot(er, ei) / k;
  out.balance = 1 - Math.hypot(br, bi) / k;

  // Area and duration entropy.
  let area = 0,
    entD = 0;
  for (let j = 0; j < k; j++) {
    area += ctx.areaT[d[j]];
    entD += ctx.durEnt[d[j]];
  }
  out.area = area / 2;
  out.entropyDurations = entD;

  // Oddity: count onsets that have an onset opposite them (n even only).
  if (n % 2 === 0) {
    let opp = 0;
    const h = n / 2;
    for (let i = 0; i < k; i++) if (member[x[i] + h]) opp++;
    out.oddity = 1 - opp / k;
  } else {
    out.oddity = NaN;
  }

  out.closure = 1 - ctx.orbit[x[k - 1]] / n;
  out.aperture = ctx.orbit[x[1]] / n;

  // Full interval-content histogram (geodesic distances 1..⌊n/2⌋).
  const hist = ctx.hist;
  hist.fill(0);
  for (let a = 0; a < k; a++) {
    for (let b = a + 1; b < k; b++) {
      let dist = x[b] - x[a];
      if (dist > half) dist = n - dist;
      hist[dist]++;
    }
  }
  let entH = 0;
  for (let j = 1; j <= half; j++) entH += ctx.histEnt[hist[j]];
  out.entropyHistogram = entH;

  // Deepness: compare the ascending-sorted histogram with the ramp
  // max(0, j + 1 − p) for every shift p and keep the closest one.
  // Counting sort: multiplicities are bounded by the number of pairs.
  const counts = ctx.counts;
  counts.fill(0);
  for (let j = 1; j <= half; j++) counts[hist[j]]++;
  const sorted = ctx.sorted;
  let idx = 0;
  for (let c = 0; c < counts.length; c++) {
    for (let r = counts[c]; r > 0; r--) sorted[idx++] = c;
  }
  let best = Infinity;
  for (let p = 0; p <= half; p++) {
    let dist = 0;
    for (let j = 1; j <= half; j++) {
      const target = j + 1 - p > 0 ? j + 1 - p : 0;
      const diff = sorted[j - 1] - target;
      dist += diff < 0 ? -diff : diff;
      if (dist >= best) break;
    }
    if (dist < best) best = dist;
  }
  out.deepness = ctx.pairs - best;

  // Symmetry: best reflection x ↦ j − x (mod n).
  let bestSym = 0;
  for (let j = 0; j < n; j++) {
    let hits = 0;
    for (let i = 0; i < k; i++) {
      let y = j - x[i];
      if (y < 0) y += n;
      if (member[y]) hits++;
    }
    if (hits > bestSym) bestSym = hits;
    if (bestSym === k) break;
  }
  out.symmetry = bestSym / k;

  // Shadow: contour of durations vs contour of shadow durations.
  // cr_i = sign(d_{i+1} − d_i), cs_i = sign(d_{i+2} − d_i), cyclic in k.
  const cr = ctx.cr,
    cs = ctx.cs;
  for (let i = 0; i < k; i++) {
    cr[i] = sign(d[(i + 1) % k] - d[i]);
    cs[i] = sign(d[(i + 2) % k] - d[i]);
  }
  let bestShadow = 0;
  for (let j = 0; j < k; j++) {
    let hits = 0;
    for (let i = 0; i < k; i++) if (cr[i] === cs[(i + j) % k]) hits++;
    if (hits > bestShadow) bestShadow = hits;
    if (bestShadow === k) break;
  }
  out.shadow = bestShadow / k;

  // Fractal: for each dilation l, R′ is every onset within the first ⌊n/l⌋
  // pulses whose dilation l·x is also an onset. Report |R′ ∪ lR′| / k.
  // The dilation does not wrap around: l·x = n is not treated as pulse 0.
  // (With wrap-around, the paper's Figure 3(b) ranking for k=5, n=12 is not
  // reproduced; without it, Table 1 and Figures 2–3 are, except Fig. 3(d).)
  // n ≤ 32 is enforced by the app, so a 32-bit mask holds the union.
  let bestFrac = 1;
  for (let l = 2; l <= n && bestFrac < k; l++) {
    const limit = Math.floor(n / l);
    let seen = 0;
    for (let i = 0; i < k && x[i] <= limit; i++) {
      const y = l * x[i];
      if (y < n && member[y]) seen |= (1 << x[i]) | (1 << y);
    }
    const union = popcount(seen);
    if (union > bestFrac) bestFrac = union;
  }
  out.fractal = bestFrac / k;

  return out;
}

/** Number of rhythms with k onsets over n pulses and x1 = 0: C(n−1, k−1). */
export function countRhythms(k, n) {
  if (k < 1 || k > n) return 0;
  let r = 1;
  const m = Math.min(k - 1, n - k);
  for (let i = 1; i <= m; i++) r = (r * (n - m - 1 + i)) / i;
  return Math.round(r);
}

/**
 * Iterate every rhythm with k onsets over n pulses starting at 0, in
 * lexicographic order. The callback receives a shared Int32Array: copy it if
 * you need to keep it.
 */
export function forEachRhythm(k, n, fn) {
  const x = new Int32Array(k);
  for (let i = 0; i < k; i++) x[i] = i;
  if (k === 1) {
    fn(x);
    return;
  }
  for (;;) {
    fn(x);
    // Advance positions 1..k−1 (position 0 is fixed at pulse 0).
    let i = k - 1;
    while (i >= 1 && x[i] === n - k + i) i--;
    if (i < 1) return;
    x[i]++;
    for (let j = i + 1; j < k; j++) x[j] = x[j - 1] + 1;
  }
}

/**
 * Compute min/max of every normalised property over all rhythms of (k, n).
 * Fine for small spaces; the worker uses a single-pass version for big ones.
 */
export function computeStats(k, n) {
  const ctx = createContext(n, k);
  const min = {},
    max = {};
  for (const key of NORMALIZED_KEYS) {
    min[key] = Infinity;
    max[key] = -Infinity;
  }
  const out = {};
  forEachRhythm(k, n, (x) => {
    rawProperties(x, ctx, out);
    for (const key of NORMALIZED_KEYS) {
      const v = out[key];
      if (v < min[key]) min[key] = v;
      if (v > max[key]) max[key] = v;
    }
  });
  return finalizeStats(k, n, min, max);
}

/** Decide which properties are defined/informative for (k, n). */
export function finalizeStats(k, n, min, max) {
  const active = {};
  for (const p of PROPERTIES) {
    if (p.evenOnly && n % 2 !== 0) active[p.key] = false;
    else if (p.normalized) active[p.key] = Number.isFinite(min[p.key]) && max[p.key] - min[p.key] > 1e-12;
    else active[p.key] = true;
  }
  const maxScore = Object.values(active).filter(Boolean).length;
  return { k, n, min, max, active, maxScore, count: countRhythms(k, n) };
}

/** Normalise raw properties with stats; inactive properties become null. */
export function normalize(raw, stats) {
  const values = {};
  let total = 0;
  for (const p of PROPERTIES) {
    if (!stats.active[p.key]) {
      values[p.key] = null;
      continue;
    }
    let v = raw[p.key];
    if (p.normalized) {
      v = (v - stats.min[p.key]) / (stats.max[p.key] - stats.min[p.key]);
      // Guard against floating-point noise at the ends of the range.
      if (v < 0) v = 0;
      else if (v > 1) v = 1;
    }
    values[p.key] = v;
    total += v;
  }
  return { values, total };
}

/** Score one rhythm; `stats` must be for the same (k, n). */
export function scoreRhythm(onsets, n, stats) {
  const x = Int32Array.from(onsets);
  const ctx = createContext(n, x.length);
  const raw = rawProperties(x, ctx, {});
  return { raw, ...normalize(raw, stats) };
}

// ---------------------------------------------------------------------------
// Rhythm helpers

/** Validate and normalise an onset list: sorted, unique, in range, contains 0. */
export function canonicalOnsets(onsets, n) {
  const set = [...new Set(onsets.map((v) => ((v % n) + n) % n))].sort((a, b) => a - b);
  return set;
}

/**
 * Rotate so that the onset at index `step` (in onset order) becomes pulse 0.
 * rotateToOnset([0,3,6,10,12], 16, 1) → [0,3,7,9,13].
 */
export function rotateToOnset(onsets, n, step) {
  const k = onsets.length;
  const s = ((step % k) + k) % k;
  const origin = onsets[s];
  return onsets.map((v) => (v - origin + n) % n).sort((a, b) => a - b);
}

/** Bitmask of the onsets (n ≤ 32). */
export function toMask(onsets) {
  let m = 0;
  for (const v of onsets) m |= 1 << v;
  return m >>> 0;
}

export function fromMask(mask, n) {
  const out = [];
  for (let i = 0; i < n; i++) if ((mask >>> i) & 1) out.push(i);
  return out;
}

/** Canonical necklace key: the smallest rotation that starts on an onset. */
export function necklaceKey(onsets, n) {
  let best = null;
  for (let s = 0; s < onsets.length; s++) {
    const r = rotateToOnset(onsets, n, s);
    const key = r.join('.');
    if (best === null || compareArrays(r, best.r) < 0) best = { r, key };
  }
  return best.key;
}

function compareArrays(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/** Durations between consecutive onsets, e.g. son → [3,3,4,2,4]. */
export function durations(onsets, n) {
  return onsets.map((v, i) => (i + 1 < onsets.length ? onsets[i + 1] : onsets[0] + n) - v);
}

/** Box notation, e.g. "x..x..x...x.x...". */
export function boxNotation(onsets, n) {
  const s = new Array(n).fill('.');
  for (const v of onsets) s[v] = 'x';
  return s.join('');
}

/** Bjorklund/Euclidean rhythm E(k, n), rotated to start at 0. */
export function euclidean(k, n) {
  const out = [];
  for (let i = 0; i < k; i++) out.push(Math.floor((i * n) / k));
  return out;
}
