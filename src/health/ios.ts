import AppleHealthKit, {
  HealthInputOptions,
  HealthKitPermissions,
  HealthValue,
} from 'react-native-health';
import type { HealthAdapter, Sample, SleepStage, Window } from './types';

const PERMS: HealthKitPermissions = {
  permissions: {
    read: [
      AppleHealthKit.Constants.Permissions.HeartRate,
      AppleHealthKit.Constants.Permissions.HeartRateVariability,
      AppleHealthKit.Constants.Permissions.OxygenSaturation,
      AppleHealthKit.Constants.Permissions.RespiratoryRate,
      AppleHealthKit.Constants.Permissions.BodyTemperature,
      AppleHealthKit.Constants.Permissions.StepCount,
      AppleHealthKit.Constants.Permissions.SleepAnalysis,
    ],
    write: [],
  },
};

function init(): Promise<void> {
  return new Promise((resolve, reject) => {
    AppleHealthKit.initHealthKit(PERMS, (err) => (err ? reject(new Error(err)) : resolve()));
  });
}

function authStatus(): Promise<boolean> {
  return new Promise((resolve) => {
    AppleHealthKit.getAuthStatus(PERMS, (err, results) => {
      if (err || !results) return resolve(false);
      // 2 = SharingAuthorized in HKAuthorizationStatus
      const allGranted = Object.values(results.permissions.read).every((v) => v === 2);
      resolve(allGranted);
    });
  });
}

function querySamples<T extends HealthValue & { startDate: string; endDate?: string }>(
  fn: (
    opts: HealthInputOptions,
    cb: (err: string | null, results: T[]) => void,
  ) => void,
  opts: HealthInputOptions,
): Promise<T[]> {
  return new Promise((resolve) => {
    fn(opts, (err, results) => resolve(err ? [] : (results ?? [])));
  });
}

function toIso(d: string): string {
  return new Date(d).toISOString();
}

export const iosAdapter: HealthAdapter = {
  async requestPermissions() {
    try {
      await init();
      return await authStatus();
    } catch {
      return false;
    }
  },

  async hasPermissions() {
    return authStatus();
  },

  async query({ startIso, endIso }: Window): Promise<Sample[]> {
    const opts: HealthInputOptions = {
      startDate: startIso,
      endDate: endIso,
      ascending: true,
      limit: 5000,
    };

    const out: Sample[] = [];

    const hr = await querySamples<HealthValue & { startDate: string }>(
      AppleHealthKit.getHeartRateSamples.bind(AppleHealthKit),
      opts,
    );
    for (const s of hr) {
      out.push({
        t: toIso(s.startDate),
        kind: 'heart_rate',
        value: s.value,
        unit: 'bpm',
        source: 'apple_healthkit',
        confidence: null,
      });
    }

    const hrv = await querySamples<HealthValue & { startDate: string }>(
      AppleHealthKit.getHeartRateVariabilitySamples.bind(AppleHealthKit),
      opts,
    );
    for (const s of hrv) {
      // HK reports SDNN in seconds; backend wants ms.
      out.push({
        t: toIso(s.startDate),
        kind: 'hrv_sdnn',
        value: s.value * 1000,
        unit: 'ms',
        source: 'apple_healthkit',
        confidence: null,
      });
    }

    const spo2 = await querySamples<HealthValue & { startDate: string }>(
      AppleHealthKit.getOxygenSaturationSamples.bind(AppleHealthKit),
      opts,
    );
    for (const s of spo2) {
      // HK returns 0..1; convert to percent.
      out.push({
        t: toIso(s.startDate),
        kind: 'spo2',
        value: s.value * 100,
        unit: 'pct',
        source: 'apple_healthkit',
        confidence: null,
      });
    }

    const rr = await querySamples<HealthValue & { startDate: string }>(
      AppleHealthKit.getRespiratoryRateSamples.bind(AppleHealthKit),
      opts,
    );
    for (const s of rr) {
      out.push({
        t: toIso(s.startDate),
        kind: 'resp_rate',
        value: s.value,
        unit: 'cpm',
        source: 'apple_healthkit',
        confidence: null,
      });
    }

    const temp = await querySamples<HealthValue & { startDate: string }>(
      AppleHealthKit.getBodyTemperatureSamples.bind(AppleHealthKit),
      opts,
    );
    for (const s of temp) {
      out.push({
        t: toIso(s.startDate),
        kind: 'temp',
        value: s.value,
        unit: 'c',
        source: 'apple_healthkit',
        confidence: null,
      });
    }

    const steps = await querySamples<HealthValue & { startDate: string }>(
      AppleHealthKit.getDailyStepCountSamples.bind(AppleHealthKit),
      opts,
    );
    for (const s of steps) {
      out.push({
        t: toIso(s.startDate),
        kind: 'steps',
        value: s.value,
        unit: 'count',
        source: 'apple_healthkit',
        confidence: null,
      });
    }

    type SleepSample = { startDate: string; value: string };
    const sleep = await new Promise<SleepSample[]>((resolve) => {
      AppleHealthKit.getSleepSamples(opts, (err, results) => {
        resolve(err ? [] : ((results ?? []) as unknown as SleepSample[]));
      });
    });
    for (const s of sleep) {
      const stage = mapSleepStage(s.value);
      if (!stage) continue;
      out.push({
        t: toIso(s.startDate),
        kind: 'sleep_stage',
        value: stage,
        unit: 'enum',
        source: 'apple_healthkit',
        confidence: null,
      });
    }

    return out;
  },
};

function mapSleepStage(hkValue: string): SleepStage | null {
  // HKCategoryValueSleepAnalysis raw strings vary by lib version; cover both.
  switch (hkValue) {
    case 'AWAKE':
    case 'AWAKE_IN_BED':
      return 'awake';
    case 'INBED':
    case 'IN_BED':
      return 'in_bed';
    case 'CORE':
    case 'ASLEEP_CORE':
    case 'ASLEEP':
      return 'light';
    case 'DEEP':
    case 'ASLEEP_DEEP':
      return 'deep';
    case 'REM':
    case 'ASLEEP_REM':
      return 'rem';
    default:
      return null;
  }
}
