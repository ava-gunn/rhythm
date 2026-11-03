// Main-thread client for the scoring worker: one worker per job (so jobs can
// be cancelled by terminating them), de-duplicated in-flight requests and a
// small cache of finished (k, n) spaces.

import { scoreExact, validate } from './space.js';

const MAX_CACHE_BYTES = 48 * 1024 * 1024;

export class Engine {
  constructor() {
    this.cache = new Map(); // "k,n" → result
    this.jobs = new Map(); // "k,n" → { promise, worker, holders, listeners }
    this.pinned = new Set();
    this.workers = true;
  }

  key(k, n) {
    return `${k},${n}`;
  }

  get(k, n) {
    const key = this.key(k, n);
    const hit = this.cache.get(key);
    if (hit) {
      // Refresh LRU order.
      this.cache.delete(key);
      this.cache.set(key, hit);
    }
    return hit;
  }

  /**
   * Score the (k, n) space. `holder` names who is waiting; `cancel(holder)`
   * withdraws that interest and stops the worker when nobody is left.
   */
  space(k, n, { holder = Symbol('anon'), onProgress, pin = false } = {}) {
    validate(k, n);
    const key = this.key(k, n);
    if (pin) this.pinned.add(key);
    const hit = this.get(k, n);
    if (hit) return Promise.resolve(hit);

    let job = this.jobs.get(key);
    if (!job) {
      job = this.start(k, n);
      this.jobs.set(key, job);
    }
    job.holders.add(holder);
    if (onProgress) job.listeners.add(onProgress);
    return job.promise;
  }

  cancel(holder) {
    for (const [key, job] of this.jobs) {
      if (!job.holders.delete(holder)) continue;
      if (job.holders.size === 0) {
        job.abort();
        this.jobs.delete(key);
      }
    }
  }

  start(k, n) {
    const key = this.key(k, n);
    const job = { holders: new Set(), listeners: new Set() };
    job.promise = new Promise((resolve, reject) => {
      const finish = (result) => {
        this.jobs.delete(key);
        this.store(key, result);
        resolve(result);
      };
      const fail = (err) => {
        this.jobs.delete(key);
        reject(err);
      };
      const runInline = async () => {
        // Fallback when workers are unavailable: blocks the UI while scoring.
        const { scoreSpace } = await import('./space.js');
        await new Promise((r) => setTimeout(r, 30)); // let the UI paint first
        finish(scoreSpace(k, n));
      };

      if (!this.workers || typeof Worker === 'undefined') {
        job.abort = () => fail(abortError());
        runInline().catch(fail);
        return;
      }

      let worker;
      try {
        // A classic, self-contained bundle (see scripts/build-worker.mjs).
        worker = new Worker(new URL('./worker.bundle.js', import.meta.url));
      } catch {
        this.workers = false;
        job.abort = () => fail(abortError());
        runInline().catch(fail);
        return;
      }
      let settled = false;
      job.abort = () => {
        if (settled) return;
        settled = true;
        worker.terminate();
        reject(abortError());
      };
      worker.onmessage = ({ data }) => {
        if (data.type === 'progress') {
          for (const fn of job.listeners) fn(data.progress);
        } else if (data.type === 'done') {
          settled = true;
          worker.terminate();
          finish(data.result);
        } else if (data.type === 'error') {
          settled = true;
          worker.terminate();
          fail(new Error(data.message));
        }
      };
      worker.onerror = (event) => {
        // The worker failed to load or crashed: score on the main thread instead.
        event.preventDefault();
        if (settled) return;
        settled = true;
        worker.terminate();
        this.workers = false;
        job.abort = () => fail(abortError());
        runInline().catch(fail);
      };
      worker.postMessage({ id: 1, k, n, limit: 1000, worstLimit: 200 });
    });
    return job;
  }

  store(key, result) {
    this.cache.set(key, result);
    let bytes = 0;
    for (const r of this.cache.values()) bytes += r.totals.byteLength;
    for (const [k, r] of this.cache) {
      if (bytes <= MAX_CACHE_BYTES) break;
      if (k === key || this.pinned.has(k)) continue;
      bytes -= r.totals.byteLength;
      this.cache.delete(k);
    }
  }

  /** Exact score of any rhythm within a scored space, with its rank. */
  evaluate(onsets, result) {
    const s = scoreExact(onsets, result.n, result.stats);
    const threshold = s.total + result.epsilon;
    const totals = result.totals;
    let greater = 0;
    for (let i = 0; i < totals.length; i++) if (totals[i] > threshold) greater++;
    return { ...s, rank: greater + 1 };
  }
}

function abortError() {
  const err = new Error('Cancelled');
  err.name = 'AbortError';
  return err;
}
