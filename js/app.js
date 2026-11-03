import { Player, SOUNDS, BPM_MIN, BPM_MAX, HIGH_CUT_MAX, rhythmKey, pulsesPerBeat } from './audio.js';
import { Engine } from './engine.js';
import { NAMED, GROUPS, namedSpaces } from './named.js';
import { PROPERTIES, countRhythms, rotateToOnset, necklaceKey, durations, euclidean } from './rhythm.js';
import { MAX_N, MAX_RHYTHMS } from './space.js';
import {
  h,
  icon,
  polygon,
  boxes,
  rhythmCard,
  skeletonCards,
  propertyList,
  distributionChart,
  playButton,
  fmtScore,
  fmtInt,
  fmtSet,
  pulseLabel,
  rhythmHref,
  topPercent,
} from './ui.js';

const player = new Player();
const engine = new Engine();
const $ = (id) => document.getElementById(id);

const PAGE = 20;
const AUTO_RUN_LIMIT = 250_000;

// ---------------------------------------------------------------------------
// Named-rhythm lookups

const namedByKey = new Map(NAMED.map((r) => [rhythmKey(r), r]));
const namedByNecklace = new Map();
for (const r of NAMED) {
  const key = `${r.n}:${necklaceKey(r.onsets, r.n)}`;
  if (!namedByNecklace.has(key)) namedByNecklace.set(key, []);
  namedByNecklace.get(key).push(r);
}

function identify(onsets, n) {
  const exact = namedByKey.get(`${n}:${onsets.join('.')}`) || null;
  const neck = necklaceKey(onsets, n);
  const rotations = (namedByNecklace.get(`${n}:${neck}`) || []).filter((r) => r !== exact);
  const k = onsets.length;
  const isEuclidean = neck === necklaceKey(euclidean(k, n), n);
  return { exact, rotations, isEuclidean };
}

function badgesFor(onsets, n, { includeExact = false } = {}) {
  const { exact, rotations, isEuclidean } = identify(onsets, n);
  const out = [];
  if (includeExact && exact) out.push(exact.name);
  for (const r of rotations) out.push(`Rotation of ${r.name}`);
  if (isEuclidean) out.push('Euclidean');
  return out;
}

const titleFor = (onsets, n) => identify(onsets, n).exact?.name ?? fmtSet(onsets);

// ---------------------------------------------------------------------------
// Routing (hash based, so it works offline and from the home screen)

const state = {
  tab: 'library',
  tabHash: { library: '#/library', generate: '#/generate', about: '#/about' },
  lastRoute: null,
};

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/library';
  const [path, query = ''] = raw.split('?');
  return { path, params: new URLSearchParams(query) };
}

function navigate(hash, { replace = false } = {}) {
  const depth = history.state?.depth || 0;
  if (replace) history.replaceState({ depth }, '', hash);
  else history.pushState({ depth: depth + 1 }, '', hash);
  render();
}

function goBack() {
  if ((history.state?.depth || 0) > 0) history.back();
  else navigate(state.tabHash[state.tab], { replace: true });
}

function render() {
  const route = location.hash || '#/library';
  if (route === state.lastRoute) return;
  state.lastRoute = route;
  const { path, params } = parseHash();

  if (path === '/rhythm') {
    Detail.show(params);
    return;
  }
  Detail.hide();
  const tab = path === '/generate' ? 'generate' : path === '/about' ? 'about' : 'library';
  state.tab = tab;
  state.tabHash[tab] = route;
  showTab(tab);
  if (tab === 'library') Library.show();
  else if (tab === 'generate') Gen.show(params);
  else About.show();
}

const TAB_TITLES = { library: 'Good Rhythms', generate: 'Generate', about: 'About' };

function showTab(tab) {
  for (const t of ['library', 'generate', 'about']) $(`view-${t}`).hidden = t !== tab;
  document.querySelectorAll('.tab').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  setHeader(TAB_TITLES[tab], false);
}

function setHeader(title, back) {
  $('title').textContent = title;
  $('back-btn').hidden = !back;
  document.querySelector('.logo').style.display = back ? 'none' : '';
  document.title = back || title !== 'Good Rhythms' ? `${title} · Good Rhythms` : 'Good Rhythms';
}

// ---------------------------------------------------------------------------
// Library: the named rhythms

const Library = {
  state: 'idle',
  async show() {
    if (this.state !== 'idle') return;
    this.state = 'loading';
    const root = $('library');
    root.replaceChildren(
      h('p', {
        class: 'lede',
        text: 'The rhythms named in the paper. Tap ▶ to listen, or tap a card to see how the score breaks down. Each score (out of 12) compares a rhythm with every other rhythm that has the same number of onsets k and pulses n.',
      }),
      ...skeletonCards(4),
    );
    try {
      const spaces = namedSpaces();
      const results = await Promise.all(spaces.map((sp) => engine.space(sp.k, sp.n, { pin: true })));
      const byKey = new Map(results.map((r) => [`${r.k},${r.n}`, r]));
      const sections = GROUPS.map((g) => {
        const list = h('div', { class: 'card-list' });
        for (const r of NAMED.filter((x) => x.group === g.id)) {
          const res = byKey.get(`${r.onsets.length},${r.n}`);
          const ev = engine.evaluate(r.onsets, res);
          list.append(
            rhythmCard({
              ...r,
              title: r.name,
              subtitle: `${r.tagline} · k ${r.onsets.length} · n ${r.n}`,
              total: ev.total,
              scoreNote: `#${ev.rank} of ${fmtInt(res.count)}`,
            }),
          );
        }
        return h('section', {}, h('div', { class: 'section-head' }, h('h2', { text: g.title }), h('p', { text: g.blurb })), list);
      });
      root.replaceChildren(root.firstChild, ...sections);
      this.state = 'done';
      syncPlayButtons();
    } catch (err) {
      this.state = 'idle';
      root.replaceChildren(h('p', { class: 'gen-error', text: `Could not score the rhythms: ${err.message}` }));
    }
  },
};

// ---------------------------------------------------------------------------
// Generator

const PRESETS = [
  { k: 3, n: 8, label: 'Tresillo' },
  { k: 5, n: 12, label: 'Fume-fume' },
  { k: 5, n: 16, label: 'Son' },
  { k: 7, n: 12, label: 'Bembé' },
  { k: 7, n: 16, label: 'Samba' },
  { k: 8, n: 12, label: 'Reich' },
];

const Gen = {
  k: 5,
  n: 16,
  mode: 'best',
  distinct: false,
  shown: PAGE,
  built: false,
  runId: 0,
  timer: 0,
  current: null, // result being displayed

  build() {
    const root = $('generate');
    this.kStep = stepper('Onsets', 'k', (d) => this.set({ k: this.k + d }), (v) => this.set({ k: v }));
    this.nStep = stepper('Pulses', 'n', (d) => this.set({ n: this.n + d }), (v) => this.set({ n: v }));
    this.presets = h(
      'div',
      { class: 'presets', role: 'group', 'aria-label': 'Examples from the paper' },
      PRESETS.map((p) =>
        h('button', {
          type: 'button',
          class: 'chip',
          dataset: { k: p.k, n: p.n },
          text: `${p.label} · ${p.k}/${p.n}`,
          onclick: () => this.set({ k: p.k, n: p.n }),
        }),
      ),
    );
    this.status = h('div', { class: 'gen-status', role: 'status', 'aria-live': 'polite' });
    this.progress = h('div', { class: 'progress', hidden: true }, h('span'));
    this.results = h('div', { class: 'gen-results' });
    root.replaceChildren(
      h('p', {
        class: 'lede',
        text: 'Pick the number of onsets k and pulses n. Every rhythm that starts on pulse 1 is scored, and the best ones are listed.',
      }),
      h('div', { class: 'gen-controls' }, this.kStep.el, this.nStep.el),
      this.presets,
      this.status,
      this.progress,
      this.results,
    );
    this.built = true;
  },

  show(params) {
    if (!this.built) this.build();
    const num = (key, fallback) => {
      const v = parseInt(params.get(key), 10);
      return Number.isFinite(v) ? v : fallback;
    };
    const [k, n] = clampKN(num('k', this.k), num('n', this.n));
    const mode = params.get('mode') === 'worst' ? 'worst' : params.has('mode') ? 'best' : this.mode;
    const distinct = params.has('distinct') ? params.get('distinct') === '1' : this.distinct;
    if (k !== this.k || n !== this.n || mode !== this.mode || distinct !== this.distinct) this.shown = PAGE;
    Object.assign(this, { k, n, mode, distinct });
    this.update();
  },

  set(patch) {
    let { k = this.k, n = this.n, mode = this.mode, distinct = this.distinct } = patch;
    // Changing n keeps k valid.
    [k, n] = clampKN(k, n);
    const q = new URLSearchParams({ k, n });
    if (mode === 'worst') q.set('mode', 'worst');
    if (distinct) q.set('distinct', '1');
    const hash = `#/generate?${q}`;
    if (hash === location.hash) this.update(); // e.g. a clamped value: just refresh the controls
    else navigate(hash, { replace: true });
  },

  update() {
    const { k, n } = this;
    this.kStep.set(k, k > 2, k < n - 1);
    this.nStep.set(n, n > 3, n < MAX_N);
    this.presets.querySelectorAll('.chip').forEach((c) => {
      c.setAttribute('aria-pressed', String(+c.dataset.k === k && +c.dataset.n === n));
    });

    const count = countRhythms(k, n);
    const space = `${fmtInt(count)} rhythms with k = ${k} onsets over n = ${n} pulses`;
    clearTimeout(this.timer);

    if (count > MAX_RHYTHMS) {
      this.cancel();
      this.status.replaceChildren(h('strong', { text: space }));
      this.results.replaceChildren(
        h('p', {
          class: 'gen-error',
          text: `That is more than this app scores exhaustively (${fmtInt(MAX_RHYTHMS)}). Every k works for n ≤ 24. For larger n, try k nearer 2 or n − 1.`,
        }),
      );
      this.current = null;
      return;
    }

    const cached = engine.get(k, n);
    if (cached) {
      this.cancel();
      this.renderResults(cached);
      return;
    }

    if (this.current && (this.current.k !== k || this.current.n !== n)) {
      // Keep the previous render visible but dimmed while the new one loads.
      this.results.style.opacity = '0.45';
    }

    if (count > AUTO_RUN_LIMIT) {
      this.cancel();
      this.status.replaceChildren(h('strong', { text: space }));
      this.results.style.opacity = '';
      this.results.replaceChildren(
        h(
          'div',
          { class: 'gen-error' },
          h('p', { text: 'This is a big space. Scoring it can take several seconds on a phone.', style: { marginTop: 0 } }),
          h('button', { type: 'button', class: 'btn block', text: `Score ${fmtInt(count)} rhythms`, onclick: () => this.run() }),
        ),
      );
      this.current = null;
      return;
    }

    this.status.replaceChildren(h('strong', { text: space }));
    this.timer = setTimeout(() => this.run(), 140);
  },

  cancel() {
    this.runId++;
    engine.cancel('generate');
    this.progress.hidden = true;
  },

  run() {
    const { k, n } = this;
    this.cancel();
    const id = this.runId;
    const bar = this.progress.firstChild;
    bar.style.width = '0';
    const showTimer = setTimeout(() => {
      if (id === this.runId) this.progress.hidden = false;
    }, 200);
    this.status.replaceChildren(h('strong', { text: `Scoring ${fmtInt(countRhythms(k, n))} rhythms…` }));
    engine
      .space(k, n, {
        holder: 'generate',
        onProgress: (p) => {
          if (id === this.runId) bar.style.width = `${Math.round(p * 100)}%`;
        },
      })
      .then((res) => {
        if (id !== this.runId) return;
        clearTimeout(showTimer);
        this.progress.hidden = true;
        this.renderResults(res);
      })
      .catch((err) => {
        clearTimeout(showTimer);
        if (err.name === 'AbortError' || id !== this.runId) return;
        this.progress.hidden = true;
        this.results.style.opacity = '';
        this.results.replaceChildren(h('p', { class: 'gen-error', text: `Something went wrong: ${err.message}` }));
      });
  },

  renderResults(res) {
    this.current = res;
    this.results.style.opacity = '';
    const { k, n, count, stats } = res;
    this.status.replaceChildren(
      h('strong', { text: `${fmtInt(count)} rhythms` }),
      ` with k = ${k} onsets over n = ${n} pulses. Scores out of ${stats.maxScore}${stats.maxScore < 12 ? ' (some properties are undefined for this n)' : ''}.`,
    );

    let items = this.mode === 'best' ? res.best : res.worst;
    if (this.distinct) {
      const seen = new Set();
      items = items.filter((r) => {
        const key = necklaceKey(r.onsets, n);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    const visible = items.slice(0, this.shown);
    const extreme = this.mode === 'best' ? res.distribution.max : res.distribution.min;

    const seg = h(
      'div',
      { class: 'seg', role: 'radiogroup', 'aria-label': 'Order' },
      [
        ['best', 'Best first'],
        ['worst', 'Worst first'],
      ].map(([m, label]) =>
        h('button', {
          type: 'button',
          role: 'radio',
          'aria-checked': String(this.mode === m),
          text: label,
          onclick: () => this.set({ mode: m }),
        }),
      ),
    );
    const distinct = h('input', {
      type: 'checkbox',
      class: 'switch',
      id: 'distinct-toggle',
      onchange: (e) => this.set({ distinct: e.target.checked }),
    });
    distinct.checked = this.distinct;

    const list = h('div', { class: 'card-list' });
    for (const r of visible) {
      const { exact } = identify(r.onsets, n);
      list.append(
        rhythmCard({
          n,
          onsets: r.onsets,
          title: exact ? exact.name : fmtSet(r.onsets),
          subtitle: exact ? fmtSet(r.onsets) : `Durations ${durations(r.onsets, n).join('-')}`,
          badges: badgesFor(r.onsets, n),
          total: r.total,
          rankLabel: `#${r.rank}`,
          scoreNote: `of ${stats.maxScore}`,
        }),
      );
    }

    const more =
      visible.length < items.length
        ? h(
            'div',
            { class: 'more-row' },
            h('button', {
              type: 'button',
              class: 'btn secondary',
              text: `Show ${Math.min(PAGE, items.length - visible.length)} more`,
              onclick: () => {
                this.shown += PAGE;
                this.renderResults(res);
              },
            }),
          )
        : null;
    const capped = !res.complete && visible.length >= items.length;
    const note = capped
      ? h('p', {
          class: 'list-note',
          text: `Showing the ${this.mode === 'best' ? 'best' : 'worst'} ${fmtInt(items.length)}${this.distinct ? ' distinct necklaces among them' : ''} of ${fmtInt(count)}.`,
        })
      : null;

    this.results.replaceChildren(
      h(
        'div',
        { class: 'summary' },
        distributionChart(res.distribution, {
          highlight: extreme,
          label: 'Score distribution',
          count,
          markLabel: this.mode === 'best' ? 'top score' : 'lowest score',
        }),
      ),
      h(
        'div',
        { class: 'toolbar' },
        seg,
        h('label', { class: 'toggle-row', for: 'distinct-toggle' }, distinct, 'One per necklace'),
      ),
      visible.length ? list : h('p', { class: 'gen-error', text: 'No rhythms.' }),
      more,
      note,
    );
    syncPlayButtons();
  },
};

function clampKN(k, n) {
  n = Math.max(3, Math.min(MAX_N, Math.round(n)));
  k = Math.max(2, Math.min(n - 1, Math.round(k)));
  return [k, n];
}

/** A − value + stepper with press-and-hold repeat and direct entry. */
function stepper(label, symbol, onStep, onSet) {
  const input = h('input', {
    class: 'stepper-value',
    type: 'number',
    inputmode: 'numeric',
    'aria-label': `${label} (${symbol})`,
    onchange: () => {
      const v = parseInt(input.value, 10);
      if (Number.isFinite(v)) onSet(v);
    },
    onfocus: () => input.select(),
  });
  const holdable = (text, aria, delta) => {
    const btn = h('button', { type: 'button', class: 'round-btn', 'aria-label': aria, text });
    let delay = 0,
      repeat = 0;
    const stop = () => {
      clearTimeout(delay);
      clearInterval(repeat);
    };
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      stop();
      delay = setTimeout(() => {
        repeat = setInterval(() => (btn.disabled ? stop() : onStep(delta)), 110);
      }, 420);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stop));
    btn.addEventListener('click', () => onStep(delta));
    return btn;
  };
  const minus = holdable('−', `Fewer ${label.toLowerCase()}`, -1);
  const plus = holdable('+', `More ${label.toLowerCase()}`, 1);
  const el = h(
    'div',
    { class: 'stepper' },
    h('span', { class: 'stepper-label', text: `${label} · ${symbol}` }),
    h('div', { class: 'stepper-row' }, minus, input, plus),
  );
  return {
    el,
    set(v, canDown, canUp) {
      input.value = v;
      minus.disabled = !canDown;
      plus.disabled = !canUp;
    },
  };
}

// ---------------------------------------------------------------------------
// Detail view

const Detail = {
  open: false,
  token: 0,

  hide() {
    if (!this.open) return;
    this.open = false;
    engine.cancel('detail');
    $('view-detail').hidden = true;
  },

  show(params) {
    const token = ++this.token;
    const view = $('view-detail');
    const root = $('detail');
    const parsed = parseRhythm(params);
    const wasOpen = this.open;
    this.open = true;
    view.hidden = false;
    if (!wasOpen) {
      view.classList.remove('entering');
      void view.offsetWidth;
      view.classList.add('entering');
      view.scrollTop = 0;
    }

    if (parsed.error) {
      setHeader('Rhythm', true);
      root.replaceChildren(h('p', { class: 'gen-error', text: parsed.error }));
      return;
    }
    const { n, onsets } = parsed;
    const k = onsets.length;
    const { exact, rotations, isEuclidean } = identify(onsets, n);
    const title = exact ? exact.name : fmtSet(onsets);
    const r = { n, onsets, id: exact?.id };
    setHeader(exact ? exact.name : 'Rhythm', true);

    const index = h(
      'div',
      { class: 'boxes-index', style: { '--n': n }, 'aria-hidden': 'true' },
      Array.from({ length: n }, (_, i) => h('span', { text: n > 16 && i % 2 ? '' : pulseLabel(i) })),
    );
    const rotate = (d) => {
      const next = rotateToOnset(onsets, n, d);
      const nr = { n, onsets: next, title: titleFor(next, n) };
      if (player.isPlaying({ n, onsets })) player.play(nr);
      navigate(rhythmHref(nr), { replace: true });
    };

    const badges = [];
    if (exact) badges.push(h('span', { class: 'badge named', text: exact.tagline }));
    for (const rr of rotations) badges.push(h('a', { class: 'badge', href: rhythmHref(rr), text: `Rotation of ${rr.name}` }));
    if (isEuclidean) badges.push(h('span', { class: 'badge', text: 'Euclidean' }));

    this.scoreSlot = h('div', { class: 'score-card' }, h('div', { class: 'score-label', text: 'Score' }), h('div', { class: 'skeleton', style: { height: '120px', borderRadius: '12px' } }));
    this.propsSlot = h('div', {}, h('div', { class: 'card skeleton', style: { height: '320px' } }));

    root.replaceChildren(
      h(
        'div',
        { class: 'detail-hero' },
        polygon(r, { labels: true }),
        h('h2', { class: 'detail-name', tabindex: '-1', text: title }),
        h('p', { class: 'detail-tag' }, exact ? fmtSet(onsets) : `k = ${k} onsets · n = ${n} pulses`),
        badges.length ? h('div', { class: 'maxed' }, badges) : null,
      ),
      h('div', { class: 'detail-boxes' }, boxes(r, { className: 'lg' }), index),
      h(
        'div',
        { class: 'transport' },
        h('button', { type: 'button', class: 'round-btn', 'aria-label': 'Rotate: start on the previous onset', onclick: () => rotate(-1) }, icon('left')),
        playButton(r, title, { large: true }),
        h('button', { type: 'button', class: 'round-btn', 'aria-label': 'Rotate: start on the next onset', onclick: () => rotate(1) }, icon('right')),
      ),
      h('p', { class: 'transport-note', text: 'The arrows rotate the rhythm so it starts on another onset.' }),
      h('div', { class: 'transport-meta' }, h('button', { type: 'button', class: 'chip tempo-chip', text: tempoLabel(), onclick: openSettings, 'aria-haspopup': 'dialog' })),
      h(
        'dl',
        { class: 'facts' },
        fact('Onsets k', k),
        fact('Pulses n', n),
        fact('Onset set', fmtSet(onsets), true),
        fact('Durations', durations(onsets, n).join(' – '), true),
      ),
      this.scoreSlot,
      h('h3', { class: 'h-sub', text: 'Properties' }),
      this.propsSlot,
      notesFor(exact, rotations, n),
      h(
        'div',
        { class: 'actions' },
        h('a', { class: 'btn secondary block', href: `#/generate?k=${k}&n=${n}`, text: `All rhythms with k = ${k}, n = ${n}` }),
      ),
    );
    syncPlayButtons();
    if (!wasOpen) root.querySelector('.detail-name')?.focus({ preventScroll: true });

    let space;
    try {
      space = engine.space(k, n, {
        holder: 'detail',
        onProgress: (p) => {
          if (token !== this.token) return;
          const label = this.scoreSlot.querySelector('.score-label');
          if (label) label.textContent = `Scoring all ${fmtInt(countRhythms(k, n))} rhythms… ${Math.round(p * 100)}%`;
        },
      });
    } catch (err) {
      this.scoreSlot.replaceChildren(h('p', { class: 'muted', text: err.message }));
      this.propsSlot.replaceChildren();
      return;
    }
    space
      .then((res) => {
        if (token !== this.token) return;
        this.fill(res, onsets);
      })
      .catch((err) => {
        if (err.name === 'AbortError' || token !== this.token) return;
        this.scoreSlot.replaceChildren(h('p', { class: 'muted', text: `Could not score: ${err.message}` }));
      });
  },

  fill(res, onsets) {
    const ev = engine.evaluate(onsets, res);
    const { stats, count } = res;
    const maxed = PROPERTIES.filter((p) => ev.values[p.key] != null && ev.values[p.key] >= 0.9999);
    this.scoreSlot.replaceChildren(
      h(
        'div',
        { class: 'score-top' },
        h('div', {}, h('div', { class: 'score-label', text: 'Score' }), h('div', { class: 'hero-figure' }, fmtScore(ev.total), h('small', { text: `/ ${stats.maxScore}` }))),
        h(
          'div',
          { class: 'rank-block' },
          h('div', { class: 'rank-main', text: `Rank ${fmtInt(ev.rank)} of ${fmtInt(count)}` }),
          h('div', { class: 'rank-sub', text: topPercent(ev.rank, count) }),
        ),
      ),
      distributionChart(res.distribution, {
        highlight: ev.total,
        label: `All rhythms with k = ${res.k}, n = ${res.n}`,
        count,
      }),
    );
    this.propsSlot.replaceChildren(
      maxed.length
        ? h(
            'div',
            {},
            h('p', { class: 'muted small', style: { margin: '0 0 6px' }, text: 'Best possible value for this k and n:' }),
            h('div', { class: 'maxed' }, maxed.map((p) => h('span', { class: 'badge named', text: p.label }))),
          )
        : null,
      propertyList(PROPERTIES, ev.values, stats, ev.raw),
    );
  },
};

function fact(label, value, wide = false) {
  return h('div', { class: `fact${wide ? ' wide' : ''}` }, h('dt', { text: label }), h('dd', { text: value }));
}

function notesFor(exact, rotations, n) {
  const parts = [];
  if (exact) {
    parts.push(h('h3', { text: 'From the paper' }), ...exact.notes.map((t) => h('p', { text: t })));
    for (const rel of exact.related || []) {
      parts.push(
        h('p', {}, h('a', { href: rhythmHref({ n, onsets: rel.onsets }), text: `${rel.label}: ${fmtSet(rel.onsets)} →` })),
      );
    }
  }
  for (const r of rotations) {
    parts.push(
      h('h3', { text: `Related to ${r.name}` }),
      h('p', {}, 'This is a rotation of the ', h('a', { href: rhythmHref(r), text: r.name }), ' rhythm: the same pattern, started on a different onset.'),
    );
  }
  return parts.length ? h('div', { class: 'notes' }, parts) : null;
}

/** Read a rhythm from a link: `n` pulses and onsets `x` numbered 1…n, e.g. `n=16&x=1.4.7.11.13`. */
function parseRhythm(params) {
  const n = parseInt(params.get('n'), 10);
  const raw = (params.get('x') || '').split(/[.,\s]+/).filter(Boolean).map(Number);
  if (!Number.isInteger(n) || n < 3 || n > MAX_N) return { error: `Pulses n must be between 3 and ${MAX_N}.` };
  const pulses = raw.map((v) => v - 1); // to the internal 0…n−1
  if (pulses.some((v) => !Number.isInteger(v) || v < 0 || v >= n)) return { error: 'This link has an onset outside the cycle.' };
  const onsets = [...new Set(pulses)].sort((a, b) => a - b);
  if (onsets[0] !== 0) return { error: 'A rhythm must have an onset on its first pulse (the paper’s convention).' };
  if (onsets.length < 2 || onsets.length > n - 1) return { error: 'A rhythm needs between 2 and n − 1 onsets.' };
  return { n, onsets };
}

// ---------------------------------------------------------------------------
// About

const About = {
  built: false,
  show() {
    if (this.built) return;
    this.built = true;
    $('glossary').replaceChildren(
      ...PROPERTIES.flatMap((p) => [
        h('dt', { text: p.label + (p.normalized ? '' : ' (used as is)') }),
        h('dd', {}, p.detail, h('code', { text: p.formula })),
      ]),
    );
    updateInstallHint();
    updateOfflineStatus();
  },
};

// ---------------------------------------------------------------------------
// Player bar, play buttons and playhead animation

let pbKey = null;

function updatePlayerBar() {
  const cur = player.current;
  $('playerbar').hidden = !cur;
  if (!cur) return;
  if (pbKey !== player.key) {
    pbKey = player.key;
    $('pb-poly').replaceChildren(polygon(cur));
    $('pb-title').textContent = cur.title;
    $('pb-sub').textContent = `k ${cur.onsets.length} · n ${cur.n}`;
    $('pb-link').setAttribute('href', rhythmHref(cur));
    $('pb-play').replaceWith(Object.assign(playButton(cur, cur.title), { id: 'pb-play' }));
  }
  $('pb-tempo').textContent = `${player.settings.bpm} BPM`;
}

function syncPlayButtons() {
  const key = player.playing ? player.key : null;
  document.querySelectorAll('.play-btn').forEach((btn) => {
    const on = btn.dataset.rkey === key;
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', `${on ? 'Stop' : 'Play'} ${btn.dataset.title}`);
  });
}

let raf = 0;
let lastPulse = -2;
let lastKey = null;
let lit = [];
let hands = [];

function clearPlayhead() {
  lit.forEach((el) => el.classList.remove('now'));
  document.querySelectorAll('.poly.playing').forEach((el) => el.classList.remove('playing'));
  lit = [];
  hands = [];
  lastPulse = -2;
}

function frame() {
  raf = 0;
  const pos = player.position();
  if (!pos) {
    clearPlayhead();
    return;
  }
  const key = player.key;
  if (pos.pulse !== lastPulse || key !== lastKey) {
    clearPlayhead();
    lastPulse = pos.pulse;
    lastKey = key;
    for (const el of document.querySelectorAll('[data-rkey]')) {
      if (el.dataset.rkey !== key || el.classList.contains('play-btn')) continue;
      if (el.classList.contains('poly')) {
        el.classList.add('playing');
        hands.push(el.querySelector('.poly-hand'));
      }
      const cell = pos.pulse >= 0 ? el.querySelector(`[data-i="${pos.pulse}"]`) : null;
      if (cell) {
        cell.classList.add('now');
        lit.push(cell);
      }
    }
  }
  const deg = (pos.phase * 360).toFixed(2);
  for (const hand of hands) hand.setAttribute('transform', `rotate(${deg} 50 50)`);
  raf = requestAnimationFrame(frame);
}

player.addEventListener('change', () => {
  updatePlayerBar();
  syncPlayButtons();
  updateSettingsUI();
  if (player.playing && !raf) raf = requestAnimationFrame(frame);
  if (!player.playing) clearPlayhead();
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.play-btn');
  if (btn) {
    e.preventDefault();
    const [n, x] = btn.dataset.rkey.split(':');
    const onsets = x.split('.').map(Number);
    player.toggle({ n: +n, onsets, title: titleFor(onsets, +n) });
    return;
  }
  const tab = e.target.closest('.tab');
  if (tab) {
    e.preventDefault();
    const t = tab.dataset.tab;
    if (t === state.tab && !Detail.open) {
      $(`view-${t}`).scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    navigate(state.tabHash[t], { replace: Detail.open });
    return;
  }
  const a = e.target.closest('a[href^="#/"]');
  if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
    e.preventDefault();
    navigate(a.getAttribute('href'));
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== ' ' || e.target.closest('input, button, a, select, textarea, dialog')) return;
  e.preventDefault();
  const target = Detail.open ? $('detail').querySelector('.play-btn') : $('pb-play');
  target?.click?.();
});

// ---------------------------------------------------------------------------
// Settings sheet

const dialog = $('settings');

function openSettings() {
  updateSettingsUI();
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function updateSettingsUI() {
  const { bpm, sound, metronome, highCut } = player.settings;
  const range = $('bpm');
  if (document.activeElement !== range) range.value = bpm;
  if (document.activeElement !== $('highcut')) $('highcut').value = highCut;
  $('highcut-out').textContent = highCutLabel(highCut);
  $('bpm-out').textContent = `${bpm} BPM`;
  $('bpm-down').disabled = bpm <= BPM_MIN;
  $('bpm-up').disabled = bpm >= BPM_MAX;
  $('metronome').checked = metronome;
  $('sound-seg')
    .querySelectorAll('button')
    .forEach((b) => b.setAttribute('aria-checked', String(b.dataset.sound === sound)));
  if (player.current) $('pb-tempo').textContent = `${bpm} BPM`;
  document.querySelectorAll('.tempo-chip').forEach((b) => (b.textContent = tempoLabel()));
}

const highCutLabel = (db) => (db === 0 ? 'Off' : `−${db} dB`);

function tempoLabel() {
  const { bpm, sound, metronome } = player.settings;
  const name = SOUNDS.find((x) => x.id === sound)?.label ?? sound;
  return `${bpm} BPM · ${name}${metronome ? ' + metronome' : ''}`;
}

function initSettings() {
  $('settings-btn').append(icon('sliders'));
  $('settings-btn').addEventListener('click', openSettings);
  $('pb-tempo').addEventListener('click', openSettings);
  $('sound-seg').append(
    ...SOUNDS.map((s) =>
      h('button', {
        type: 'button',
        role: 'radio',
        dataset: { sound: s.id },
        text: s.label,
        onclick: () => player.update({ sound: s.id }),
      }),
    ),
  );
  let pending = 0;
  $('bpm').addEventListener('input', (e) => {
    $('bpm-out').textContent = `${e.target.value} BPM`;
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => player.update({ bpm: +e.target.value }));
  });
  $('bpm').min = BPM_MIN;
  $('bpm').max = BPM_MAX;
  $('bpm-down').addEventListener('click', () => player.update({ bpm: player.settings.bpm - 1 }));
  $('bpm-up').addEventListener('click', () => player.update({ bpm: player.settings.bpm + 1 }));
  $('metronome').addEventListener('change', (e) => player.update({ metronome: e.target.checked }));
  $('highcut').max = HIGH_CUT_MAX;
  $('highcut').addEventListener('input', (e) => {
    $('highcut-out').textContent = highCutLabel(+e.target.value);
    player.update({ highCut: +e.target.value });
  });
  // Tap outside the sheet to close.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  updateSettingsUI();
}

// ---------------------------------------------------------------------------
// Install & offline

let installPrompt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('install-btn').hidden = false;
  updateInstallHint();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  $('install-btn').hidden = true;
  toast('Installed. You can open Good Rhythms from your home screen.');
});

async function install() {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  $('install-btn').hidden = true;
}

function updateInstallHint() {
  const hint = $('install-hint');
  if (isStandalone()) {
    hint.hidden = true;
    return;
  }
  if (installPrompt) {
    hint.hidden = false;
    hint.replaceChildren(
      h('strong', { text: 'Install the app. ' }),
      'Add Good Rhythms to your home screen to use it offline, in its own window. ',
      h('p', { style: { margin: '10px 0 0' } }, h('button', { type: 'button', class: 'btn', text: 'Install', onclick: install })),
    );
  } else if (isIOS()) {
    hint.hidden = false;
    hint.replaceChildren(
      h('strong', { text: 'Install on iPhone or iPad. ' }),
      'In Safari, tap the Share button, then “Add to Home Screen”. The app then works offline.',
    );
  } else {
    hint.hidden = true;
  }
}

function updateOfflineStatus() {
  const el = $('offline-status');
  if (!el) return;
  el.textContent = navigator.serviceWorker?.controller ? 'Ready to work offline.' : '';
}

function toast(message, action) {
  const el = $('toast');
  el.replaceChildren(h('span', { text: message }), action ? h('button', { type: 'button', text: action.label, onclick: action.run }) : null);
  el.hidden = false;
  clearTimeout(toast.timer);
  if (!action) toast.timer = setTimeout(() => (el.hidden = true), 3500);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      const offer = (worker) =>
        toast('A new version is available.', {
          label: 'Reload',
          run: () => worker.postMessage({ type: 'SKIP_WAITING' }),
        });
      if (reg.waiting && hadController) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
          if (worker.state === 'activated') updateOfflineStatus();
        });
      });
    })
    .catch(() => {
      /* offline support unavailable */
    });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    updateOfflineStatus();
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
}

// ---------------------------------------------------------------------------
// Boot

function init() {
  document.querySelectorAll('[data-icon]').forEach((el) => el.replaceWith(icon(el.dataset.icon)));
  $('back-btn').append(icon('back'));
  $('back-btn').addEventListener('click', goBack);
  $('install-btn').addEventListener('click', install);
  initSettings();
  if (!history.state) history.replaceState({ depth: 0 }, '', location.hash || '#/library');
  window.addEventListener('popstate', render);
  window.addEventListener('hashchange', render);
  render();
  registerServiceWorker();
}

init();

// Exposed for debugging in the console.
window.goodRhythms = { player, engine, pulsesPerBeat };
