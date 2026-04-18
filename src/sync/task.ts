import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BACKGROUND_SYNC_TASK,
  config,
} from '../config';
import {
  clearCredentials,
  getSyncCursor,
  loadCredentials,
  setSyncCursor,
} from '../auth/storage';
import { getHealthAdapter } from '../health';
import { chunkSamples, maxTimestamp } from './batch';
import { postVitalsBatch } from './client';

const STATUS_KEY = 'sentinel.last_sync_status';

export type LastSyncStatus = {
  at: string; // ISO8601
  result: 'ok' | 'no_creds' | 'no_perms' | 'partial' | 'error' | 'rate_limited' | 'revoked';
  acceptedTotal?: number;
  flaggedClockSkewTotal?: number;
  message?: string;
};

export async function readLastSyncStatus(): Promise<LastSyncStatus | null> {
  const raw = await AsyncStorage.getItem(STATUS_KEY);
  return raw ? (JSON.parse(raw) as LastSyncStatus) : null;
}

async function writeStatus(s: LastSyncStatus): Promise<void> {
  await AsyncStorage.setItem(STATUS_KEY, JSON.stringify(s));
}

/**
 * Runs one sync pass. Returns BackgroundFetchResult so the OS can decide
 * future scheduling cadence. Idempotent — safe to call from foreground or
 * background.
 */
export async function runSyncOnce(): Promise<BackgroundFetch.BackgroundFetchResult> {
  const now = new Date();

  const creds = await loadCredentials();
  if (!creds) {
    await writeStatus({ at: now.toISOString(), result: 'no_creds' });
    return BackgroundFetch.BackgroundFetchResult.NoData;
  }

  const adapter = getHealthAdapter();
  if (!(await adapter.hasPermissions())) {
    await writeStatus({ at: now.toISOString(), result: 'no_perms' });
    return BackgroundFetch.BackgroundFetchResult.NoData;
  }

  const cursorIso =
    (await getSyncCursor()) ??
    new Date(now.getTime() - config.initialLookbackMinutes * 60_000).toISOString();

  let samples: Awaited<ReturnType<typeof adapter.query>>;
  try {
    samples = await adapter.query({ startIso: cursorIso, endIso: now.toISOString() });
  } catch (e) {
    await writeStatus({
      at: now.toISOString(),
      result: 'error',
      message: e instanceof Error ? e.message : String(e),
    });
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }

  if (samples.length === 0) {
    await setSyncCursor(now.toISOString());
    await writeStatus({ at: now.toISOString(), result: 'ok', acceptedTotal: 0, flaggedClockSkewTotal: 0 });
    return BackgroundFetch.BackgroundFetchResult.NoData;
  }

  const chunks = chunkSamples(samples);
  let acceptedTotal = 0;
  let flaggedTotal = 0;
  let advancedCursorTo = cursorIso;

  for (const chunk of chunks) {
    const r = await postVitalsBatch(creds, chunk);

    if (r.ok) {
      acceptedTotal += r.accepted;
      flaggedTotal += r.flaggedClockSkew;
      const top = maxTimestamp(chunk);
      if (top && top > advancedCursorTo) advancedCursorTo = top;
      continue;
    }

    if (r.kind === 'auth' && r.code === 'device_revoked') {
      await clearCredentials();
      await writeStatus({ at: now.toISOString(), result: 'revoked' });
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }

    if (r.kind === 'auth') {
      // Stale or malformed token — wipe so user re-pairs.
      await clearCredentials();
      await writeStatus({ at: now.toISOString(), result: 'revoked', message: r.code });
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }

    if (r.kind === 'rate_limited') {
      // Save what we have; OS will retry on next interval.
      await setSyncCursor(advancedCursorTo);
      await writeStatus({
        at: now.toISOString(),
        result: 'rate_limited',
        acceptedTotal,
        flaggedClockSkewTotal: flaggedTotal,
        message: `retry after ${r.retryAfterSeconds}s`,
      });
      return BackgroundFetch.BackgroundFetchResult.NewData;
    }

    if (r.kind === 'clock_in_future') {
      await writeStatus({
        at: now.toISOString(),
        result: 'error',
        message: 'Device clock is ahead of server. Check date/time settings.',
      });
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }

    // Other failures (network/server/schema/too_large) — keep cursor where successful chunks ended.
    await setSyncCursor(advancedCursorTo);
    await writeStatus({
      at: now.toISOString(),
      result: 'partial',
      acceptedTotal,
      flaggedClockSkewTotal: flaggedTotal,
      message: r.kind,
    });
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }

  await setSyncCursor(advancedCursorTo);
  await writeStatus({
    at: now.toISOString(),
    result: 'ok',
    acceptedTotal,
    flaggedClockSkewTotal: flaggedTotal,
  });
  return BackgroundFetch.BackgroundFetchResult.NewData;
}

// Define the background task at module load so TaskManager finds it on cold start.
if (!TaskManager.isTaskDefined(BACKGROUND_SYNC_TASK)) {
  TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
    try {
      return await runSyncOnce();
    } catch {
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
}

export async function registerBackgroundSync(): Promise<void> {
  const status = await BackgroundFetch.getStatusAsync();
  if (
    status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
    status === BackgroundFetch.BackgroundFetchStatus.Denied
  ) {
    return;
  }
  await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
    minimumInterval: config.syncIntervalMinutes * 60,
    stopOnTerminate: false,
    startOnBoot: true,
  });
}

export async function unregisterBackgroundSync(): Promise<void> {
  if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK)) {
    await BackgroundFetch.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
  }
}
