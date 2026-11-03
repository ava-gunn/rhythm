import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fourFourBars, defaultDrumPattern, drumPattern, sameDrumPattern, renderLoop, pulsesPerBeat } from '../js/audio.js';

test('4/4 means whole bars of 4 beats on the app’s beat grid', () => {
  const bars = Object.fromEntries([3, 4, 6, 7, 8, 9, 10, 12, 16, 20, 24, 28, 32].map((n) => [n, fourFourBars(n)]));
  assert.deepEqual(bars, { 3: 0, 4: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 12: 1, 16: 1, 20: 0, 24: 2, 28: 0, 32: 2 });
});

test('default pattern: kick on beats 1 and 3, snare on 2 and 4 (0-based pulses)', () => {
  assert.deepEqual(defaultDrumPattern(16), { kick: [0, 8], snare: [4, 12] });
  assert.deepEqual(defaultDrumPattern(12), { kick: [0, 6], snare: [3, 9] });
  assert.deepEqual(defaultDrumPattern(32), { kick: [0, 8, 16, 24], snare: [4, 12, 20, 28] });
  assert.deepEqual(defaultDrumPattern(24), { kick: [0, 6, 12, 18], snare: [3, 9, 15, 21] });
});

test('not 4/4: the default is a single kick on the first pulse', () => {
  for (const n of [7, 8, 9, 10, 20]) assert.deepEqual(defaultDrumPattern(n), { kick: [0], snare: [] });
});

test('a programmed pattern overrides the default for its pulse count only', () => {
  const settings = { drums: { 7: { kick: [0, 3], snare: [5] } } };
  assert.deepEqual(drumPattern(7, settings), { kick: [0, 3], snare: [5] });
  assert.deepEqual(drumPattern(16, settings), defaultDrumPattern(16));
  assert.ok(sameDrumPattern(drumPattern(16, {}), { kick: [0, 8], snare: [4, 12] }));
});

test('renderLoop plays the drums only when the backing is kick & snare', () => {
  const sampleRate = 8000;
  const ctx = {
    sampleRate,
    createBuffer: (channels, length) => {
      const data = new Float32Array(length);
      return { length, getChannelData: () => data };
    },
  };
  const n = 16;
  const g = pulsesPerBeat(n);
  const pulseDur = 0.15;
  const son = [0, 3, 6, 10, 12];
  const render = (backing) => renderLoop(ctx, son, n, pulseDur, g, { sound: 'clave', backing, drums: {} }).getChannelData(0);
  // Pulse 4 (beat 2) has no onset in the son clave, so apart from the faint
  // tail of the clave note on pulse 3, only the backing sounds there.
  const energyAt = (data, pulse) => {
    const from = Math.round(pulse * pulseDur * sampleRate);
    let e = 0;
    for (let i = from; i < from + 400; i++) e += data[i] * data[i];
    return e;
  };
  const off = energyAt(render('off'), 4);
  const metronome = energyAt(render('metronome'), 4);
  const drums = energyAt(render('drums'), 4);
  assert.ok(off < 0.01, `only a decaying tail without backing (${off})`);
  assert.ok(metronome > 10 * off, 'metronome tick on beat 2');
  assert.ok(drums > 10 * metronome, 'snare on beat 2, fuller than the tick');
});
