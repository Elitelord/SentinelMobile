# Sentinel — Mobile ↔ Backend Contract

**Status:** Locked v1 (2026-04-18)
**Owners:** Backend repo + SentinelMobile repo. Both repos mirror this file. Diff before each PR.

---

## 1. Auth model

- One device → one patient. Device pairs once via 6-digit code, then holds a long-lived JWT.
- Token: HS256 JWT, no `exp`. Revocation enforced server-side via `devices.revoked_at` lookup on every request.
- Signing secret: `DEVICE_TOKEN_SECRET` (backend-only env).

JWT payload:
```json
{ "sub": "<device_id>", "pid": "<patient_id>", "iat": 1713456789, "typ": "device" }
```

All authed endpoints respond on auth failure with:
```json
401 { "error": "device_revoked" | "invalid_token" | "malformed_token", "message": "..." }
```

Mobile mapping:
- `device_revoked` → clear SecureStore, return to pairing screen, show "This device was unpaired by your care team."
- `invalid_token` / `malformed_token` → clear SecureStore, return to pairing, show "Please re-pair."

---

## 2. Pairing

### `POST /api/patients/{pid}/pair`
Clinician-initiated. (Hackathon: open endpoint. Real auth added later.)

**Response 201:**
```json
{
  "pairing_code": "123456",
  "qr_url": "sentinel://pair/123456",
  "expires_at": "2026-04-18T14:42:11Z"
}
```
- 6-digit numeric, zero-padded.
- 10-min TTL, single-use.

### `POST /api/pair/exchange`
**Body:**
```json
{
  "code": "123456",
  "device_info": { "model": "iPhone 15", "os": "iOS 18.2", "app_version": "0.1.0" }
}
```

**Response 200:**
```json
{
  "device_token": "<jwt>",
  "patient_id": "uuid",
  "device_id": "uuid",
  "pair_time": "2026-04-18T14:33:11Z"
}
```
Mobile uses `pair_time` as the initial sync cursor (forward-only — no backfill in v1).

**Errors:**
- `404 { "error": "code_invalid_or_expired" }`
- `409 { "error": "code_already_consumed" }`

### `POST /api/devices/{device_id}/revoke`
Clinician auth. Returns `204`.

---

## 3. Vitals ingestion

### `POST /api/vitals/batch`

**Headers:**
```
Authorization: Bearer <device_token>
Idempotency-Key: <uuid-v4>
Content-Type: application/json
```

**Body:**
```json
{
  "patient_id": "uuid",
  "device_id": "uuid",
  "batch_id": "<same uuid as Idempotency-Key>",
  "samples": [
    {
      "t": "2026-04-18T14:32:11Z",
      "kind": "heart_rate",
      "value": 78,
      "unit": "bpm",
      "source": "apple_healthkit",
      "confidence": null
    }
  ]
}
```

**`kind` enum (final):**
| kind | unit | value type | notes |
|---|---|---|---|
| `heart_rate` | `bpm` | number | |
| `spo2` | `pct` | number | 0–100 |
| `resp_rate` | `cpm` | number | breaths/min |
| `temp` | `c` | number | wrist (HK) or body (HC) |
| `steps` | `count` | number | per sample interval |
| `sleep_stage` | `enum` | string | `awake \| light \| deep \| rem \| in_bed` |
| `hrv_sdnn` | `ms` | number | iOS only — not interchangeable with rmssd |
| `hrv_rmssd` | `ms` | number | Android only |

`source`: `apple_healthkit | health_connect | manual`
`confidence`: `0.0–1.0` if known, else `null`.

**Responses:**
- `202 { "accepted": N, "flagged_clock_skew": M }` — fresh batch processed.
- `200 { "accepted": N, "flagged_clock_skew": M, "idempotent_replay": true }` — replay of prior `batch_id`.
- `400 { "error": "mismatched_batch_id" | "clock_in_future" | "schema_invalid" }`
- `401` — see auth section.
- `413 { "error": "payload_too_large", "max_samples": 1000 }`
- `429 { "error": "rate_limited", "retry_after_s": N }`

**Limits:**
- Max 1000 samples per batch. Mobile chunks above.
- Rate: 10 batches/min/device, 500 batches/day/device. Burst to 60/min tolerated, then 429.

**Idempotency:**
- `Idempotency-Key` header MUST equal body `batch_id`. Mismatch → 400.
- Backend stores `processed_batches` with TTL 7 days; replays return 200 with original `accepted` count.

**Clock skew:**
- Accept samples where `now - 24h <= t <= now + 1h`.
- Samples with `t < now - 24h` are accepted but flagged.
- Any sample with `t > now + 1h` → entire batch rejected (`400 clock_in_future`).
- Mobile should sanity-check device clock before sending; surface a warning if `Date.now()` deviates from server `Date` header.

---

## 4. Cadence

- Background sync: every ~15 min via `expo-background-fetch` (iOS minimum). Android similar.
- Foreground: sync on app open + manual "Sync now" button.
- Forward-only from `pair_time`. Backfill is v2.

---

## 5. URL scheme & deep link

- Scheme: `sentinel://`
- Pair link: `sentinel://pair/<6-digit-code>`
- Registered in `app.json` → `"scheme": "sentinel"`.

---

## 6. v2 / out of scope (documented for later)

- Backfill on first pair (last N hours of HK/HC history).
- Push token registration (`POST /api/devices/{id}/push_token`) — backend-triggered nudges.
- Backend-pushed config (sync interval, kind allowlist).
- Per-patient OAuth instead of device JWT.
- Blood pressure, ECG, VO2max sample kinds.
