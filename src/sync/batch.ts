import type { Sample } from '../health/types';
import { config } from '../config';

/**
 * Split a flat sample array into batches of at most config.maxSamplesPerBatch,
 * preserving chronological order so the server-side cursor can advance safely
 * if a later chunk fails.
 */
export function chunkSamples(samples: Sample[]): Sample[][] {
  if (samples.length === 0) return [];
  const sorted = [...samples].sort((a, b) => a.t.localeCompare(b.t));
  const out: Sample[][] = [];
  for (let i = 0; i < sorted.length; i += config.maxSamplesPerBatch) {
    out.push(sorted.slice(i, i + config.maxSamplesPerBatch));
  }
  return out;
}

/** Latest sample timestamp in a batch, used to advance the sync cursor. */
export function maxTimestamp(samples: Sample[]): string | null {
  if (samples.length === 0) return null;
  let max = samples[0].t;
  for (const s of samples) if (s.t > max) max = s.t;
  return max;
}
