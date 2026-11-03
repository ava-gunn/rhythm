// Web Worker: scores a whole (k, n) rhythm space off the main thread.
import { scoreSpace } from './space.js';

self.onmessage = (event) => {
  const { id, k, n, limit, worstLimit, queries } = event.data;
  try {
    let last = 0;
    const result = scoreSpace(k, n, {
      limit,
      worstLimit,
      queries,
      onProgress(p) {
        // Throttle to whole percent steps.
        if (p - last >= 0.01) {
          last = p;
          self.postMessage({ id, type: 'progress', progress: p });
        }
      },
    });
    self.postMessage({ id, type: 'done', result }, [result.totals.buffer]);
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err?.message ?? String(err) });
  }
};
