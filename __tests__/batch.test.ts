import { chunkSamples, maxTimestamp } from '../src/sync/batch';
import type { Sample } from '../src/health/types';

function s(t: string, value = 70): Sample {
  return { t, kind: 'heart_rate', value, unit: 'bpm', source: 'apple_healthkit', confidence: null };
}

jest.mock('../src/config', () => ({
  config: { maxSamplesPerBatch: 3 },
  BACKGROUND_SYNC_TASK: 'sentinel.background-sync',
}));

describe('chunkSamples', () => {
  it('returns empty for empty input', () => {
    expect(chunkSamples([])).toEqual([]);
  });

  it('chunks at the configured cap', () => {
    const arr = [s('2026-04-18T00:00:00Z'), s('2026-04-18T00:01:00Z'), s('2026-04-18T00:02:00Z'), s('2026-04-18T00:03:00Z')];
    const out = chunkSamples(arr);
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(3);
    expect(out[1]).toHaveLength(1);
  });

  it('sorts ascending by timestamp before chunking', () => {
    const arr = [s('2026-04-18T00:02:00Z'), s('2026-04-18T00:00:00Z'), s('2026-04-18T00:01:00Z')];
    const [chunk] = chunkSamples(arr);
    expect(chunk.map((x) => x.t)).toEqual([
      '2026-04-18T00:00:00Z',
      '2026-04-18T00:01:00Z',
      '2026-04-18T00:02:00Z',
    ]);
  });
});

describe('maxTimestamp', () => {
  it('returns null on empty', () => {
    expect(maxTimestamp([])).toBeNull();
  });
  it('returns the max ISO string', () => {
    expect(
      maxTimestamp([s('2026-04-18T00:01:00Z'), s('2026-04-18T00:05:00Z'), s('2026-04-18T00:03:00Z')]),
    ).toBe('2026-04-18T00:05:00Z');
  });
});
