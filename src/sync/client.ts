import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import type { Credentials } from '../auth/storage';
import type { Sample } from '../health/types';

export type PostBatchOk = {
  ok: true;
  status: 200 | 202;
  accepted: number;
  flaggedClockSkew: number;
  idempotentReplay: boolean;
};

export type PostBatchErr =
  | { ok: false; kind: 'auth'; code: 'device_revoked' | 'invalid_token' | 'malformed_token' }
  | { ok: false; kind: 'rate_limited'; retryAfterSeconds: number }
  | { ok: false; kind: 'too_large' }
  | { ok: false; kind: 'clock_in_future' }
  | { ok: false; kind: 'mismatched_batch_id' }
  | { ok: false; kind: 'schema_invalid' }
  | { ok: false; kind: 'network'; message: string }
  | { ok: false; kind: 'server'; status: number; message: string };

export type PostBatchResult = PostBatchOk | PostBatchErr;

type AuthErrorCode = 'device_revoked' | 'invalid_token' | 'malformed_token';

export async function postVitalsBatch(
  creds: Credentials,
  samples: Sample[],
): Promise<PostBatchResult> {
  if (samples.length === 0) {
    return { ok: true, status: 202, accepted: 0, flaggedClockSkew: 0, idempotentReplay: false };
  }

  const batchId = uuidv4();
  const body = JSON.stringify({
    patient_id: creds.patientId,
    device_id: creds.deviceId,
    batch_id: batchId,
    samples,
  });

  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}/api/vitals/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creds.deviceToken}`,
        'Idempotency-Key': batchId,
      },
      body,
    });
  } catch (e) {
    return {
      ok: false,
      kind: 'network',
      message: e instanceof Error ? e.message : String(e),
    };
  }

  if (res.status === 200 || res.status === 202) {
    const json = (await res.json()) as {
      accepted: number;
      flagged_clock_skew?: number;
      idempotent_replay?: boolean;
    };
    return {
      ok: true,
      status: res.status as 200 | 202,
      accepted: json.accepted,
      flaggedClockSkew: json.flagged_clock_skew ?? 0,
      idempotentReplay: !!json.idempotent_replay,
    };
  }

  if (res.status === 401) {
    const error = await readErrorCode(res);
    const code: AuthErrorCode =
      error === 'device_revoked' || error === 'malformed_token'
        ? error
        : 'invalid_token';
    return { ok: false, kind: 'auth', code };
  }

  if (res.status === 429) {
    const retryAfterHeader = res.headers.get('Retry-After');
    const json = (await res.json().catch(() => ({}))) as {
      retry_after_s?: number;
      detail?: { retry_after_s?: number };
    };
    const retryAfterSeconds =
      json.detail?.retry_after_s ??
      json.retry_after_s ??
      (retryAfterHeader ? parseInt(retryAfterHeader, 10) : 60);
    return { ok: false, kind: 'rate_limited', retryAfterSeconds };
  }

  if (res.status === 413) return { ok: false, kind: 'too_large' };

  if (res.status === 400) {
    const error = await readErrorCode(res);
    if (error === 'clock_in_future') return { ok: false, kind: 'clock_in_future' };
    if (error === 'mismatched_batch_id') return { ok: false, kind: 'mismatched_batch_id' };
    return { ok: false, kind: 'schema_invalid' };
  }

  const text = await res.text().catch(() => '');
  return { ok: false, kind: 'server', status: res.status, message: text };
}

// Backend wraps errors via FastAPI HTTPException as { detail: { error: "..." } }.
// Older/local responses may return a flat { error: "..." }, so accept either.
async function readErrorCode(res: Response): Promise<string | undefined> {
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    detail?: string | { error?: string };
  };
  if (typeof json.detail === 'object' && json.detail?.error) return json.detail.error;
  if (typeof json.detail === 'string') return json.detail;
  return json.error;
}
