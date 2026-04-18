// Mirrors the kind enum in docs/backend-contract.md.
export type SampleKind =
  | 'heart_rate'
  | 'spo2'
  | 'resp_rate'
  | 'temp'
  | 'steps'
  | 'sleep_stage'
  | 'hrv_sdnn'
  | 'hrv_rmssd';

export type SampleUnit = 'bpm' | 'pct' | 'cpm' | 'c' | 'count' | 'enum' | 'ms';

export type Source = 'apple_healthkit' | 'health_connect' | 'manual';

export type SleepStage = 'awake' | 'light' | 'deep' | 'rem' | 'in_bed';

export type Sample = {
  t: string; // ISO8601 UTC
  kind: SampleKind;
  value: number | SleepStage;
  unit: SampleUnit;
  source: Source;
  confidence: number | null;
};

/** Per-platform query window. End is exclusive. */
export type Window = { startIso: string; endIso: string };

export interface HealthAdapter {
  /** Request all read permissions we need. Returns true if all granted. */
  requestPermissions(): Promise<boolean>;
  /** Whether we currently hold all required permissions. */
  hasPermissions(): Promise<boolean>;
  /** Pull every sample of every kind in [start, end). May return [] if device unworn. */
  query(window: Window): Promise<Sample[]>;
}
