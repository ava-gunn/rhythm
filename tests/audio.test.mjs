import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fourFourBars, defaultDrumPattern, drumPattern, sameDrumPattern, renderLoop, pulsesPerBeat, Player } from '../js/audio.js';

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

function fakeContext(sampleRate = 8000) {
  const sources = [];
  return {
    sampleRate,
    currentTime: 1,
    sources,
    createBuffer: (channels, length) => {
      const data = new Float32Array(length);
      return { length, getChannelData: () => data };
    },
    createBufferSource: () => {
      const src = {
        connect(target) {
          this.target = target;
        },
        start(when, offset) {
          this.started = [when, offset];
        },
        stop() {},
        disconnect() {},
      };
      sources.push(src);
      return src;
    },
  };
}

test('renderLoop puts the rhythm in `tones` and the metronome or drums in `backing`', () => {
  const ctx = fakeContext();
  const n = 16;
  const pulseDur = 0.15;
  const son = [0, 3, 6, 10, 12];
  const render = (backing) => renderLoop(ctx, son, n, pulseDur, pulsesPerBeat(n), { sound: 'clave', backing, drums: {} });
  const energyAt = (buffer, pulse) => {
    const data = buffer.getChannelData(0);
    const from = Math.round(pulse * pulseDur * ctx.sampleRate);
    let e = 0;
    for (let i = from; i < from + 400; i++) e += data[i] * data[i];
    return e;
  };
  const drums = render('drums');
  const metronome = render('metronome');
  const off = render('off');
  assert.equal(off.backing, null, 'no backing loop when the backing is off');
  // Pulse 4 (beat 2) has a snare / metronome tick but no onset in the son clave.
  assert.ok(energyAt(drums.backing, 4) > 1, 'snare on beat 2 is in the backing');
  assert.ok(energyAt(metronome.backing, 4) > 0.01, 'metronome tick on beat 2 is in the backing');
  assert.ok(energyAt(drums.backing, 4) > 10 * energyAt(metronome.backing, 4), 'snare is fuller than the tick');
  // The tones are identical whatever the backing (only the clave's tail at pulse 4).
  assert.ok(energyAt(drums.tones, 4) < 0.01);
  assert.ok(energyAt(drums.tones, 0) > 1, 'clave onset on pulse 1 is in the tones');
  assert.ok(energyAt(drums.backing, 4) > 10 * energyAt(drums.backing, 3), 'a snare hit on beat 2, only the kick’s tail just before it');
});

test('only the rhythm tones go through the high shelf; the backing bypasses it', () => {
  const ctx = fakeContext();
  const player = new Player();
  Object.assign(player, { ctx, shelf: { name: 'shelf' }, master: { name: 'master' } });
  player.current = { n: 16, onsets: [0, 3, 6, 10, 12], title: 'Son clave' };
  for (const backing of ['drums', 'metronome']) {
    ctx.sources.length = 0;
    player.settings.backing = backing;
    player.restart('zero');
    const [tones, back] = player.sources;
    assert.equal(player.sources.length, 2, backing);
    assert.equal(tones.target.name, 'shelf', `${backing}: tones → shelf`);
    assert.equal(back.target.name, 'master', `${backing}: backing → master, unfiltered`);
    assert.deepEqual(tones.started, back.started, `${backing}: both loops start together`);
    assert.ok(tones.loop && back.loop);
    assert.equal(tones.buffer.length, back.buffer.length, 'loops have the same length');
  }
  player.settings.backing = 'off';
  player.restart('zero');
  assert.equal(player.sources.length, 1);
  assert.equal(player.sources[0].target.name, 'shelf');
});
