# SentinelMobile

Companion mobile app for the Sentinel post-op monitoring system. Reads vitals from Apple HealthKit (iOS) and Health Connect (Android), batches them every ~15 minutes, and posts to the Sentinel backend so the scoring engine can fuse them with the conversational call signal.

This repo is the **mobile companion only**. The main backend (FastAPI + Mongo + Gemini scoring + Twilio/ElevenLabs calling + Next.js dashboard) lives in a separate repo.

## Contract

The backend ↔ mobile API is locked in [`docs/backend-contract.md`](docs/backend-contract.md). Both repos mirror this file. Diff before any PR that touches it.

## Stack

- Expo SDK 52 + Expo Router (typed routes)
- `react-native-health` (HealthKit) / `react-native-health-connect`
- `expo-background-fetch` + `expo-task-manager` (15-min background sync)
- `expo-secure-store` for the device JWT
- Deep-link scheme `sentinel://pair/<6-digit-code>`

## Setup

```bash
cp .env.example .env
# edit .env: point EXPO_PUBLIC_API_URL at your backend
npm install
npx expo prebuild       # generates ios/ + android/ for the dev client
npm run ios             # or npm run android
```

HealthKit and Health Connect both require native modules, so Expo Go won't work — use a dev client (`npm run ios|android` or EAS Build).

## Pair flow

1. Clinician dashboard generates a code → `sentinel://pair/123456`.
2. Patient enters the code (or scans the QR — TODO) on the pairing screen.
3. App POSTs `/api/pair/exchange`, stores the returned JWT in SecureStore.
4. App requests Health permissions, registers the background sync task, runs an initial sync, lands on the status screen.

## Sync flow

Every ~15 minutes (foreground or background):

1. Read sync cursor from SecureStore (initialized to `pair_time` at pairing).
2. Query the platform health adapter for `[cursor, now)`.
3. Sort + chunk samples (max 1000 per batch).
4. POST each chunk with a fresh `batch_id` (mirrored in the `Idempotency-Key` header).
5. Advance the cursor to the latest timestamp of the most recent successfully-accepted chunk.
6. Write a `LastSyncStatus` record for the status screen.

Errors are mapped:

- `401 device_revoked` / other auth → wipe SecureStore + return to pairing.
- `429 rate_limited` → save partial progress, retry on next interval.
- `400 clock_in_future` → surface "device clock ahead" error.
- Network/server → `partial` status, cursor stays at last successful chunk.

## Tests

```bash
npm run typecheck
npm test
```

Unit tests cover pairing-input parsing and batch chunking. The platform health adapters are integration-only (real device required).

## Repo layout

```
app/                         expo-router screens
  (onboarding)/pair          enter/scan code
  (onboarding)/permissions   HK/HC consent
  (main)/status              last sync, manual sync
  (main)/settings            backend URL, unpair
src/
  config.ts                  env + constants
  auth/                      SecureStore + pairing exchange
  health/                    iOS + Android adapters → unified Sample[]
  sync/                      chunking, POST client, background task
docs/
  backend-contract.md        single source of truth — mirrors backend repo
__tests__/                   unit tests
```

## What this app does NOT do (by design)

- Pre-aggregate samples on-device — the backend windows them.
- Normalize platform-specific shapes into a single `kind` until POST. (HK SDNN and HC RMSSD stay as `hrv_sdnn` / `hrv_rmssd` — they are not interchangeable.)
- Push notifications — backend is read-only from mobile's perspective in v1.
- Real-time streaming — battery + iOS background limits make 15-min batches the right cadence.
- Backfill historical data on first pair — forward-only from `pair_time`. v2.
