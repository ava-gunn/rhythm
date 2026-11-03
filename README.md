# Good Rhythms

An installable, offline-capable progressive web app for exploring “good” musical rhythms, based on
Paul Lascabettes & Isabelle Bloch, *What Are “Good” Rhythms? Generating Rhythms Based on the Properties Set
Out in The Geometry of Musical Rhythm* (MCM 2024, [hal-04579586](https://hal.science/hal-04579586)).

- **Library**: every rhythm named in the paper (Toussaint’s six 5/16 timelines, plus the tresillo, fume-fume, samba,
  Steve Reich’s signature rhythm and the bembé). Each one is scored and ranked within its (k, n).
- **Generate**: choose k onsets and n pulses. The app scores every rhythm that starts on pulse 1 (C(n−1, k−1) of them)
  and lists the best or worst. It can show one rotation per necklace, and it shows the score distribution.
- **Detail**: polygon and box notation, a live playhead, rotation, the score, rank and percentile, a breakdown of all
  12 properties (raw value, normalization range and formula), and notes from the paper.
- **Audio**: synthesized clave, woodblock, drum or beep, with an optional metronome. Tempo is in BPM.
- **Mobile**: thumb-reachable tab and player bars, safe-area insets, light and dark themes, works offline, and can be
  installed on Android (install prompt) and iOS (Share → Add to Home Screen).

There are no dependencies and no build step for the app itself: it is plain HTML, CSS and ES modules.

## Run locally

```sh
npm start          # http://localhost:8080 (PORT=3000 npm start to change)
npm test           # scoring engine vs. the paper, worker bundle, edge cases
```

Service workers (offline mode and install) only run over **https or localhost**. To try the app on a phone, deploy it
to any static https host, such as GitHub Pages, Netlify or Cloudflare Pages, by uploading the repository as is. All
paths are relative, so it also works from a sub-path. Opening it over `http://<LAN-IP>` works, but without offline mode
or install.

## How scoring works

`js/rhythm.js` implements the 12 properties: evenness, balance, area, oddity, closure, aperture, deepness, entropy of
the full interval histogram, entropy of durations, symmetry, shadow and fractal. Nine are min-max normalized over all
rhythms with the same (k, n). Symmetry, shadow and fractal are used as they are. The total lies between 0 and 12.

`js/space.js` enumerates a whole space in a Web Worker. Pass 1 stores raw values in compact typed arrays and tracks
min/max. Pass 2 normalizes, keeps the best and worst candidates in bounded heaps, and builds the distribution. Those
candidates are then re-scored exactly. The array of totals is transferred back, so any rhythm (including rotations in
the detail view) can be ranked instantly. Ties share a rank. The limit is 2,000,000 rhythms, which covers every k for
n ≤ 24. On a laptop, 1.35M rhythms take about 4 s.

**Pulse numbering.** The app numbers pulses 1…n, both on screen and in links (`#/rhythm?n=16&x=1.4.7.11.13`).
Internally, and in the tests and the paper, they are 0…n−1 (the paper’s convention, with the first onset at 0).
`pulseLabel()` in `js/ui.js` converts for display and links, and `parseRhythm()` in `js/app.js` converts back.
The sets below use the paper’s 0-based numbering.

### Agreement with the paper (checked in `tests/paper.test.mjs`)

| Result | Status |
|---|---|
| Table 1: all 72 property values and the six totals | ✅ exact (to 2 d.p.) |
| Figure 2: top 20 for k=5, n=16 (son first, rumba 11th, bossa-nova 20th) | ✅ same order |
| The three worst rhythms for k=5, n=16 | ✅ |
| Figure 3: top 3 for (3,8) tresillo, (5,12) fume-fume, (7,16) samba necklace | ✅ |
| Bembé (7,12) is not first; its rotation {0,1,3,5,6,8,10} is | ✅ |
| Figure 3(d): Steve Reich’s rhythm is best for (8,12) | ✅ first. The paper’s 2nd place {0,1,2,4,5,7,8,10} comes 6th here |

Interpretation notes:

- **Entropy rows.** In Table 1, “Entropy H” matches the entropy of *durations* and “Entropy D” the entropy of the
  *interval histogram*, so the labels are swapped relative to the definitions. Totals are unaffected. Durations use
  dⱼ/n as a distribution. After min-max normalization this is equivalent to the paper’s −Σ dⱼ log₂ dⱼ.
- **Fractal.** R/l is taken as the onsets x ≤ ⌊n/l⌋, and the dilation l·x must land inside the cycle (l·x = n does
  not wrap to pulse 0). With wrap-around, the (5,12) ranking in Figure 3(b) is not reproduced.
- **Deepness** compares the ascending-sorted interval histogram with the ramp max(0, j+1−p).
- **Undefined properties.** Oddity is skipped for odd n. Any normalized property that is constant over the space
  (closure and aperture for prime n) is skipped too, and the maximum score shown drops to match.
- I could not find the cause of the (8,12) 2nd/3rd place mismatch with the published formulas. The two rhythms in
  question tie on every property here.

## Project layout

```
index.html, css/app.css    app shell and styles
js/app.js                  routing, views, player bar, settings, install/offline
js/ui.js                   DOM helpers: polygon, box notation, cards, meters, distribution chart
js/audio.js                Web Audio playback (each cycle rendered to a looping buffer)
js/rhythm.js               the 12 properties and rhythm helpers (pure, tested in Node)
js/space.js                exhaustive scoring of a (k, n) space
js/worker.js               worker entry (source); bundled into js/worker.bundle.js
js/engine.js               worker client: cancellation, de-duplication, cache
js/named.js                the named rhythms and their notes
sw.js, manifest.webmanifest, icons/
scripts/serve.mjs          dev server · scripts/build-worker.mjs · scripts/make-icons.mjs
```

### Making changes

- After editing `js/rhythm.js`, `js/space.js` or `js/worker.js`, run `npm run build` to regenerate
  `js/worker.bundle.js`. `npm test` fails if the bundle is stale. The bundle exists because Safari does not serve a
  dedicated worker’s module imports from the service-worker cache, which would break off-main-thread scoring
  offline.
- **Before deploying any change, bump `VERSION` in `sw.js`.** The app is served cache-first, so installed copies
  only update when the service worker changes. Open tabs then show a “new version — Reload” prompt.
- `npm run icons` regenerates the icons (needs a local Chrome/Chromium).
