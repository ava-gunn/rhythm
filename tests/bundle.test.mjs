import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildWorkerBundle, BUNDLE_PATH } from '../scripts/build-worker.mjs';

test('js/worker.bundle.js is up to date (run `npm run build`)', async () => {
  const committed = await readFile(BUNDLE_PATH, 'utf8');
  assert.equal(committed, await buildWorkerBundle());
});

test('the bundled worker scores a space and replies with the result', async () => {
  const code = await readFile(BUNDLE_PATH, 'utf8');
  const messages = [];
  const self = { postMessage: (m) => messages.push(m) };
  vm.runInNewContext(code, { self, Math, Float64Array, Float32Array, Int32Array, Int8Array, Uint8Array, Uint16Array, Uint32Array, Set, Map, Error, Number, Object, Array, String, Infinity, NaN });
  self.onmessage({ data: { id: 7, k: 5, n: 16, limit: 5, worstLimit: 3, queries: [[0, 3, 6, 10, 13]] } });
  const done = messages.find((m) => m.type === 'done');
  assert.ok(done, 'worker posted a result');
  assert.equal(done.id, 7);
  assert.deepEqual([...done.result.best[0].onsets], [0, 3, 6, 10, 12]); // copy: arrays from the vm realm
  assert.equal(Math.round(done.result.best[0].total * 100) / 100, 10.29);
  assert.equal(done.result.count, 1365);
  assert.equal(done.result.queries[0].rank, 19);
});
