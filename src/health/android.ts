import {
  initialize,
  requestPermission,
  getGrantedPermissions,
  readRecords,
} from 'react-native-health-connect';
import type { HealthAdapter, Sample, SleepStage, Window } from './types';

const SCOPES = [
  { accessType: 'read' as const, recordType: 'HeartRate' as const },
  { accessType: 'read' as const, recordType: 'HeartRateVariabilityRmssd' as const },
  { accessType: 'read' as const, recordType: 'OxygenSaturation' as const },
  { accessType: 'read' as const, recordType: 'RespiratoryRate' as const },
  { accessType: 'read' as const, recordType: 'BodyTemperature' as const },
  { accessType: 'read' as const, recordType: 'Steps' as const },
  { accessType: 'read' as const, recordType: 'SleepSession' as const },
];

async function ensureInit(): Promise<boolean> {
  try {
    return await initialize();
  } catch {
    return false;
  }
}

async function readType<T>(
  recordType: Parameters<typeof readRecords>[0],
  startIso: string,
  endIso: string,
): Promise<T[]> {
  try {
    const result = await readRecords(recordType, {
      timeRangeFilter: { operator: 'between', startTime: startIso, endTime: endIso },
    });
    // SDK shape varies between versions; both `records` and bare arrays appear.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const records = (result as any)?.records ?? (result as unknown as T[]);
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

export const androidAdapter: HealthAdapter = {
  async requestPermissions() {
    const ok = await ensureInit();
    if (!ok) return false;
    try {
      const granted = await requestPermission(SCOPES);
      return granted.length === SCOPES.length;
    } catch {
      return false;
    }
  },

  async hasPermissions() {
    const ok = await ensureInit();
    if (!ok) return false;
    try {
      const granted = await getGrantedPermissions();
      return SCOPES.every((s) =>
        granted.some(
          (g) => g.recordType === s.recordType && g.accessType === s.accessType,
        ),
      );
    } catch {
      return false;
    }
  },

  async query({ startIso, endIso }: Window): Promise<Sample[]> {
    if (!(await ensureInit())) return [];
    const out: Sample[] = [];

    type HrRec = { samples: { time: string; beatsPerMinute: number }[] };
    const hr = await readType<HrRec>('HeartRate', startIso, endIso);
    for (const rec of hr) {
      for (const s of rec.samples ?? []) {
        out.push({
          t: s.time,
          kind: 'heart_rate',
          value: s.beatsPerMinute,
          unit: 'bpm',
          source: 'health_connect',
          confidence: null,
        });
      }
    }

    type HrvRec = { time: string; heartRateVariabilityMillis: number };
    const hrv = await readType<HrvRec>('HeartRateVariabilityRmssd', startIso, endIso);
    for (const r of hrv) {
      out.push({
        t: r.time,
        kind: 'hrv_rmssd',
        value: r.heartRateVariabilityMillis,
        unit: 'ms',
        source: 'health_connect',
        confidence: null,
      });
    }

    type SpO2Rec = { time: string; percentage: number };
    const spo2 = await readType<SpO2Rec>('OxygenSaturation', startIso, endIso);
    for (const r of spo2) {
      out.push({
        t: r.time,
        kind: 'spo2',
        value: r.percentage,
        unit: 'pct',
        source: 'health_connect',
        confidence: null,
      });
    }

    type RrRec = { time: string; rate: number };
    const rr = await readType<RrRec>('RespiratoryRate', startIso, endIso);
    for (const r of rr) {
      out.push({
        t: r.time,
        kind: 'resp_rate',
        value: r.rate,
        unit: 'cpm',
        source: 'health_connect',
        confidence: null,
      });
    }

    type TempRec = { time: string; temperature: { inCelsius: number } };
    const temp = await readType<TempRec>('BodyTemperature', startIso, endIso);
    for (const r of temp) {
      out.push({
        t: r.time,
        kind: 'temp',
        value: r.temperature?.inCelsius,
        unit: 'c',
        source: 'health_connect',
        confidence: null,
      });
    }

    type StepsRec = { startTime: string; count: number };
    const steps = await readType<StepsRec>('Steps', startIso, endIso);
    for (const r of steps) {
      out.push({
        t: r.startTime,
        kind: 'steps',
        value: r.count,
        unit: 'count',
        source: 'health_connect',
        confidence: null,
      });
    }

    type SleepRec = {
      stages?: { startTime: string; stage: number }[];
    };
    const sleep = await readType<SleepRec>('SleepSession', startIso, endIso);
    for (const sess of sleep) {
      for (const stage of sess.stages ?? []) {
        const mapped = mapHcSleepStage(stage.stage);
        if (!mapped) continue;
        out.push({
          t: stage.startTime,
          kind: 'sleep_stage',
          value: mapped,
          unit: 'enum',
          source: 'health_connect',
          confidence: null,
        });
      }
    }

    return out;
  },
};

function mapHcSleepStage(stage: number): SleepStage | null {
  // Health Connect SleepStageType constants.
  switch (stage) {
    case 1:
      return 'awake'; // STAGE_TYPE_AWAKE
    case 2:
      return 'light'; // STAGE_TYPE_SLEEPING (generic)
    case 3:
      return 'awake'; // STAGE_TYPE_OUT_OF_BED — closest mapping
    case 4:
      return 'light'; // STAGE_TYPE_LIGHT
    case 5:
      return 'deep'; // STAGE_TYPE_DEEP
    case 6:
      return 'rem'; // STAGE_TYPE_REM
    case 7:
      return 'awake'; // STAGE_TYPE_AWAKE_IN_BED
    default:
      return null;
  }
}
