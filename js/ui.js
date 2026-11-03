// DOM building blocks. Text is always set via textContent (never innerHTML).

import { rhythmKey, pulsesPerBeat } from './audio.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

function s(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  return el;
}

function applyProps(el, props) {
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') {
      for (const [prop, val] of Object.entries(v)) {
        // Custom properties are ignored by plain assignment.
        if (prop.startsWith('--')) el.style.setProperty(prop, String(val));
        else el.style[prop] = val;
      }
    }
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const fmtScore = (v) => (v == null ? '—' : v.toFixed(2));
export const fmtInt = (v) => v.toLocaleString('en-US');
/** Pulses are stored 0…n−1 (the paper's convention) but shown to people as 1…n. */
export const pulseLabel = (i) => i + 1;
export const fmtSet = (onsets) => `{${onsets.map(pulseLabel).join(', ')}}`;

export function rhythmHref(r) {
  // Links use the same 1…n pulse numbers as the UI.
  const q = new URLSearchParams({ n: r.n, x: r.onsets.map(pulseLabel).join('.') });
  if (r.id) q.set('id', r.id);
  return `#/rhythm?${q}`;
}

/** Percent of rhythms that score at least as well, phrased for display. */
export function topPercent(rank, count) {
  const p = (rank / count) * 100;
  if (rank === 1) return 'Highest score';
  if (p < 0.01) return 'Top 0.01%';
  if (p < 0.1) return 'Top 0.1%';
  if (p < 1) return `Top ${p.toFixed(1)}%`;
  if (p <= 50) return `Top ${Math.ceil(p)}%`;
  const bottom = ((count - rank + 1) / count) * 100;
  return `Bottom ${bottom < 1 ? bottom.toFixed(1) : Math.ceil(bottom)}%`;
}

// ---------------------------------------------------------------------------
// Polygon notation

export function polygon(r, { labels = false, className = '' } = {}) {
  const { n, onsets } = r;
  const R = labels ? 40 : 42;
  const pad = labels ? 10 : 4;
  const onSet = new Set(onsets);
  const pt = (i, rad = R) => {
    const a = (2 * Math.PI * i) / n;
    return [50 + rad * Math.sin(a), 50 - rad * Math.cos(a)];
  };
  const svg = s('svg', {
    viewBox: `${-pad} ${-pad} ${100 + 2 * pad} ${100 + 2 * pad}`,
    class: `poly ${className}`.trim(),
    role: 'img',
    'aria-label': `Polygon notation: onsets ${onsets.map(pulseLabel).join(', ')} of ${n} pulses`,
  });
  svg.dataset.rkey = rhythmKey(r);
  svg.append(s('circle', { class: 'poly-track', cx: 50, cy: 50, r: R }));
  const pts = onsets.map((i) => pt(i).map((v) => v.toFixed(2)).join(',')).join(' ');
  svg.append(s(onsets.length > 2 ? 'polygon' : 'polyline', { class: 'poly-shape', points: pts }));
  const hand = s('line', { class: 'poly-hand', x1: 50, y1: 50, x2: 50, y2: 50 - R });
  svg.append(hand);
  const g = s('g', { class: 'poly-pulses' });
  const beat = pulsesPerBeat(n);
  for (let i = 0; i < n; i++) {
    const [cx, cy] = pt(i);
    const on = onSet.has(i);
    g.append(
      s('circle', {
        class: `p${on ? ' on' : ''}${i % beat === 0 ? ' beat' : ''}`,
        cx: cx.toFixed(2),
        cy: cy.toFixed(2),
        r: on ? (labels ? 3.6 : 4.4) : labels ? 1.4 : 1.8,
        'data-i': i,
      }),
    );
  }
  svg.append(g);
  if (labels) {
    const lg = s('g', { class: 'poly-labels', 'aria-hidden': 'true' });
    for (let i = 0; i < n; i++) {
      const [x, y] = pt(i, R + 7.5);
      const t = s('text', { x: x.toFixed(2), y: y.toFixed(2), class: onSet.has(i) ? 'on' : null });
      t.textContent = pulseLabel(i);
      lg.append(t);
    }
    svg.append(lg);
  }
  return svg;
}

// ---------------------------------------------------------------------------
// Box notation (one cell per pulse)

export function boxes(r, { className = '' } = {}) {
  const { n, onsets } = r;
  const onSet = new Set(onsets);
  const beat = pulsesPerBeat(n);
  const el = h('div', {
    class: `boxes ${className}`.trim(),
    role: 'img',
    'aria-label': `Box notation: ${Array.from({ length: n }, (_, i) => (onSet.has(i) ? 'x' : '.')).join('')}`,
    style: { '--n': n },
    dataset: { rkey: rhythmKey(r) },
  });
  for (let i = 0; i < n; i++) {
    el.append(h('span', { class: `b${onSet.has(i) ? ' on' : ''}${i % beat === 0 ? ' beat' : ''}`, 'data-i': i }));
  }
  return el;
}

// ---------------------------------------------------------------------------
// Icons

const ICONS = {
  play: 'M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z',
  stop: 'M7 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z',
  back: 'M15.5 4.5 8 12l7.5 7.5',
  left: 'M14.5 6 8.5 12l6 6',
  right: 'M9.5 6l6 6-6 6',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 4.5v5M10 14.5v5',
  library: 'M5 4h3v16H5zM10.5 4h3v16h-3zM16 5.2l2.9-.8 3.6 15.4-2.9.8z',
  generate: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z',
  about: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7.5v.5',
  install: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14',
  chevron: 'M6 9l6 6 6-6',
};
const STROKED = new Set(['back', 'left', 'right', 'sliders', 'about', 'install', 'chevron']);

export function icon(name, { size = 24, className = '' } = {}) {
  const svg = s('svg', { viewBox: '0 0 24 24', width: size, height: size, class: `icon ${className}`.trim(), 'aria-hidden': 'true' });
  const path = s('path', { d: ICONS[name] });
  if (STROKED.has(name)) {
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
  } else {
    path.setAttribute('fill', 'currentColor');
  }
  svg.append(path);
  return svg;
}

export function playButton(r, title, { large = false } = {}) {
  const btn = h('button', {
    type: 'button',
    class: `play-btn${large ? ' large' : ''}`,
    'aria-label': `Play ${title}`,
    'aria-pressed': 'false',
    dataset: { rkey: rhythmKey(r), title },
  });
  btn.append(icon('play', { className: 'i-play' }), icon('stop', { className: 'i-stop' }));
  return btn;
}

// ---------------------------------------------------------------------------
// Rhythm card (used in the library and generator lists)

/**
 * @param {object} item { n, onsets, id?, title, subtitle?, badges?, total?, rank?, count?, maxScore?, rankLabel? }
 */
export function rhythmCard(item) {
  const r = { n: item.n, onsets: item.onsets, id: item.id };
  const card = h('article', { class: 'card rhythm-card' });
  const link = h(
    'a',
    { class: 'card-link', href: rhythmHref(r), 'aria-label': `${item.title}, details` },
    h('div', { class: 'card-poly' }, polygon(r)),
    h(
      'div',
      { class: 'card-body' },
      h(
        'div',
        { class: 'card-title' },
        item.rankLabel ? h('span', { class: 'card-rank', text: item.rankLabel }) : null,
        h('span', { class: 'card-name', text: item.title }),
      ),
      item.subtitle ? h('div', { class: 'card-sub', text: item.subtitle }) : null,
      item.badges?.length ? h('div', { class: 'card-badges' }, item.badges.map((b) => h('span', { class: 'badge', text: b }))) : null,
    ),
    h(
      'div',
      { class: 'card-score' },
      h('span', { class: 'score-num', text: fmtScore(item.total) }),
      h('span', { class: 'score-of', text: item.scoreNote ?? '' }),
    ),
  );
  card.append(link, playButton(r, item.title), h('div', { class: 'card-boxes' }, boxes(r)));
  return card;
}

export function skeletonCards(count = 3) {
  return Array.from({ length: count }, () => h('div', { class: 'card skeleton', 'aria-hidden': 'true' }));
}

// ---------------------------------------------------------------------------
// Property meters

export function propertyList(properties, values, stats, raw) {
  const list = h('ul', { class: 'props' });
  for (const p of properties) {
    const v = values[p.key];
    const active = v != null;
    const id = `prop-${p.key}`;
    const more = h(
      'div',
      { class: 'prop-more', id, hidden: true },
      h('p', { text: p.detail }),
      h('p', { class: 'formula' }, h('span', { class: 'formula-label', text: 'Formula ' }), h('code', { text: p.formula })),
      active && raw
        ? h(
            'p',
            { class: 'prop-raw' },
            p.normalized
              ? `Raw value ${fmtRaw(raw[p.key])}, normalized over the range ${fmtRaw(stats.min[p.key])} – ${fmtRaw(stats.max[p.key])} for k = ${stats.k}, n = ${stats.n}.`
              : `Used as is (not min-max normalized), as in the paper.`,
          )
        : null,
      !active ? h('p', { class: 'prop-raw', text: inactiveReason(p, stats) }) : null,
    );
    const head = h(
      'button',
      {
        type: 'button',
        class: 'prop-head',
        'aria-expanded': 'false',
        'aria-controls': id,
        onclick: () => {
          const open = head.getAttribute('aria-expanded') === 'true';
          head.setAttribute('aria-expanded', String(!open));
          more.hidden = open;
        },
      },
      h('span', { class: 'prop-name' }, p.label, h('span', { class: 'prop-short', text: p.short })),
      h('span', { class: 'prop-val', text: active ? v.toFixed(2) : 'n/a' }),
      h(
        'span',
        { class: `meter${active ? '' : ' off'}`, role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 1, 'aria-valuenow': active ? v.toFixed(2) : 0, 'aria-label': p.label },
        h('span', { class: 'meter-fill', style: { width: `${active ? Math.max(0, Math.min(1, v)) * 100 : 0}%` } }),
      ),
      icon('chevron', { size: 18, className: 'prop-chev' }),
    );
    list.append(h('li', { class: `prop${active ? '' : ' inactive'}` }, head, more));
  }
  return list;
}

function fmtRaw(v) {
  if (!Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(3);
}

export function inactiveReason(p, stats) {
  if (p.evenOnly && stats.n % 2) return 'Not defined when n is odd, so it is left out of the score.';
  return `Takes the same value for every rhythm with n = ${stats.n} (e.g. n is prime), so it is left out of the score.`;
}

// ---------------------------------------------------------------------------
// Score distribution: one column per score bin; the highlighted bin is the
// accent (emphasis form), the rest de-emphasis gray.

export function distributionChart(dist, { highlight = null, label = 'Score distribution', count, markLabel = 'this rhythm' } = {}) {
  const { bins, min, max } = dist;
  const span = max - min || 1;
  const peak = Math.max(...bins);
  const hiBin = highlight == null ? -1 : Math.min(bins.length - 1, Math.floor(((highlight - min) / span) * bins.length));
  const binRange = (b) => [min + (b / bins.length) * span, min + ((b + 1) / bins.length) * span];

  const tooltip = h('div', { class: 'chart-tip', role: 'status', 'aria-live': 'polite', hidden: true });
  const plot = h('div', { class: 'chart-plot' });
  bins.forEach((c, b) => {
    const [lo, hi] = binRange(b);
    const col = h(
      'div',
      { class: `chart-col${b === hiBin ? ' hi' : ''}`, dataset: { b } },
      h('span', { class: 'chart-bar', style: { height: c ? `${Math.max(3, (c / peak) * 100)}%` : '0' } }),
    );
    const show = () => {
      tooltip.hidden = false;
      tooltip.replaceChildren(
        h('strong', { text: `${fmtInt(c)} ${c === 1 ? 'rhythm' : 'rhythms'}` }),
        h('span', { text: `score ${lo.toFixed(2)}–${hi.toFixed(2)}` }),
      );
      const x = ((b + 0.5) / bins.length) * 100;
      tooltip.style.left = `${Math.min(80, Math.max(20, x))}%`;
      plot.querySelectorAll('.chart-col.hover').forEach((e) => e.classList.remove('hover'));
      col.classList.add('hover');
    };
    col.addEventListener('pointerenter', show);
    col.addEventListener('pointerdown', show);
    plot.append(col);
  });
  plot.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') {
      tooltip.hidden = true;
      plot.querySelectorAll('.chart-col.hover').forEach((el) => el.classList.remove('hover'));
    }
  });

  const axis = h('div', { class: 'chart-axis' }, h('span', { text: min.toFixed(2) }), h('span', { text: max.toFixed(2) }));

  // Label for the highlighted column, kept inside the frame near the edges.
  let mark = null;
  if (highlight != null) {
    const x = ((hiBin + 0.5) / bins.length) * 100;
    const side = x > 70 ? 'right' : x < 30 ? 'left' : 'mid';
    mark = h(
      'div',
      { class: 'chart-mark-row' },
      h(
        'span',
        { class: `chart-mark ${side}`, style: { left: `${x}%` } },
        h('span', { class: 'chart-mark-dot' }),
        `${markLabel} · ${highlight.toFixed(2)}`,
      ),
    );
  }

  // Table view for assistive tech.
  const table = h(
    'table',
    { class: 'sr-only' },
    h('caption', { text: label }),
    h('thead', {}, h('tr', {}, h('th', { text: 'Score range' }), h('th', { text: 'Rhythms' }))),
    h(
      'tbody',
      {},
      bins.map((c, b) => {
        const [lo, hi] = binRange(b);
        return h('tr', {}, h('td', { text: `${lo.toFixed(2)}–${hi.toFixed(2)}` }), h('td', { text: c }));
      }),
    ),
  );

  return h(
    'figure',
    { class: 'chart' },
    h('figcaption', { class: 'chart-cap' }, h('span', { text: label }), count ? h('span', { class: 'muted', text: `${fmtInt(count)} rhythms` }) : null),
    h('div', { class: 'chart-frame', 'aria-hidden': 'true' }, mark, tooltip, plot, axis),
    table,
  );
}
