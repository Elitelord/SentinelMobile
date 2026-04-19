# Sentinel Mobile → Monorepo Integration Handoff

**Date:** 2026-04-18
**Audience:** The next agent working on the merged Sentinel codebase that contains both the existing backend / clinician dashboard and this mobile app.
**Goal:** Move `SentinelMobile` into the main repo, then build out the patient-side experience (status + receiving calls) inside the mobile app, replacing what currently lives only on the dashboard.

This doc has two halves:

- **Part 1 — Architectural plan + acceptance criteria.** What to build and why.
- **Part 2 — Concrete next-action steps.** What to do first, in order.

---

## Part 1 — Architecture

### 1.1 Repo shape: pnpm workspaces monorepo

The right shape for this project is a **pnpm workspaces monorepo** with three packages:

```
sentinel/
├── package.json                  # root, workspace declarations only
├── pnpm-workspace.yaml
├── tsconfig.base.json            # shared TS config
├── packages/
│   ├── contract/                 # shared types + the Mobile↔Backend contract doc
│   │   ├── package.json          # name: "@sentinel/contract"
│   │   ├── src/
│   │   │   ├── vitals.ts         # Sample, kind enum, units (single source of truth)
│   │   │   ├── pairing.ts        # PairingResponse, ExchangeRequest, etc.
│   │   │   ├── calls.ts          # Call event payloads (NEW — see §1.4)
│   │   │   └── index.ts
│   │   └── docs/backend-contract.md   # MOVED from SentinelMobile/docs/
│   ├── backend/                  # existing FastAPI backend
│   │   └── ...
│   └── dashboard/                # existing clinician web dashboard
│       └── ...
└── apps/
    └── mobile/                   # this repo, moved as-is
        ├── app/                  # Expo Router screens
        ├── src/
        ├── plugins/
        ├── android/              # generated, gitignored or kept (see §2.4)
        └── package.json          # name: "@sentinel/mobile"
```

**Why this shape (vs. just dropping it as a subfolder):**

- The contract drift bug we fixed today (backend wraps errors as `{detail: {error: ...}}`, mobile parsed `json.error`) is exactly what a shared contract package prevents. After this migration, both backend and mobile import the same `Sample` and `ExchangeResponse` types.
- The `docs/backend-contract.md` is currently mirrored by hand between repos. Moving it into `@sentinel/contract` makes it a single file, and contract changes become PR-reviewable diffs that fail to merge if either side breaks.
- pnpm workspaces is the lightest tooling that supports this — no Nx/Turbo boilerplate. If the team is already on yarn or npm workspaces, those work too with trivial syntax differences.

**If you want minimum disruption instead:** drop SentinelMobile as `apps/mobile/` and skip the `packages/contract` extraction for now. Acceptable as a v1; you'll regret it the first time the backend changes a JSON shape.

### 1.2 What's already working in the mobile app (do not rebuild)

Before adding anything, the next agent should know what's already shipped and tested:

| Feature | File(s) | Status |
|---|---|---|
| Pairing (6-digit code → JWT exchange) | `src/auth/pairing.ts`, `app/(onboarding)/pair.tsx` | ✅ Working on Android |
| Credential storage (encrypted) | `src/auth/storage.ts` | ✅ |
| Health Connect adapter (Android) | `src/health/android.ts` | ✅ Reads HR, HRV, SpO2, RR, temp, steps, sleep |
| HealthKit adapter (iOS) | `src/health/ios.ts` | ⚠️ Untested — teammate to verify |
| Vitals batching & idempotent POST | `src/sync/{client,batch,task}.ts` | ✅ |
| Background sync registration | `src/sync/task.ts` (`registerBackgroundSync`) | ✅ Android, untested iOS |
| Status screen (last sync, manual sync) | `app/(main)/status.tsx` | ✅ Basic — needs vitals visualization, see §1.3 |
| Settings (unpair) | `app/(main)/settings.tsx` | ✅ |
| Auth guard / routing | `app/_layout.tsx` | ✅ Recently fixed (was caching stale `paired` state) |
| Health Connect deep-link redirect catch | `app/index.tsx` | ✅ |
| **Custom Expo config plugin for Health Connect** | `plugins/with-health-connect-delegate.js` | ✅ **CRITICAL — read its docstring before touching native Android. It fixes 3 separate native bugs that block Health Connect entirely.** |

### 1.3 Patient-side dashboard view (port from web → mobile)

The user wants "calls + a richer status/dashboard view (richer than the current placeholder Status screen)" in the mobile app. The existing `app/(main)/status.tsx` only shows pairing info + last sync result. It needs to become a **patient dashboard**.

**Audit step (FIRST):** before designing screens, the agent must read the dashboard codebase to see what's currently shown to *patients* (vs. what's shown only to clinicians). Patient-facing concerns are typically a subset:

- Their own recent vitals (HR trend, last reading, etc.)
- Upcoming / past check-in calls
- Alerts triggered for them ("Your HR has been elevated for 30 min — your nurse will call you")
- Surgery info / care plan (read-only)
- Status of the connection (when did data last sync, is the watch worn)

Things that should **NOT** move to mobile (clinician-only):
- Patient list / search
- Editing thresholds
- Clinician-side call queue
- Alert acknowledgment workflow

**Design principle:** patient-side mobile is a *consumer* of backend data, not a duplicator of dashboard logic. If the dashboard has a `<PatientDetail patientId={...}/>` component making backend calls, the mobile screens should hit the **same backend endpoints** with the device's JWT instead of re-implementing calculations client-side.

**Proposed mobile screens (new):**

```
app/(main)/
├── status.tsx          # KEEP, but rewrite as the home dashboard (see below)
├── vitals/[kind].tsx   # NEW — drill-in chart for one vital (HR, SpO2, etc.)
├── alerts.tsx          # NEW — list of alerts triggered for this patient
├── call.tsx            # NEW — active-call screen (see §1.4)
└── settings.tsx        # KEEP
```

**Status as patient home dashboard** should show, top-to-bottom:

1. Greeting + name (`GET /api/patients/{pid}` to fetch the patient's name).
2. **Connection card** — green/yellow/red dot + "Synced 2 min ago" + "Sync now" button (replaces today's bare last-sync card).
3. **Vitals strip** — 4 mini-cards (HR, SpO2, RR, Steps today), each tappable → `/vitals/[kind]`.
4. **Alerts banner** (only if active) — red card, "Your nurse may call you soon."
5. **Next call card** — "Next check-in: today 4:00 PM" or "An RN will call you shortly."
6. Footer link to Settings.

### 1.4 Receiving calls in the mobile app

The user doesn't know what calling tech the dashboard uses. The agent must figure this out, *then* pick the mobile integration. Step-by-step:

**Step A — Audit existing call infrastructure.** Search the dashboard / backend for: `twilio`, `agora`, `daily`, `livekit`, `webrtc`, `RTCPeerConnection`, `socket.io`, `sip`. The grep results determine which path below applies.

**Step B — Pick the path based on the audit.**

- **Twilio Voice → Use `@twilio/voice-react-native-sdk`.** Maps cleanly: backend mints an Access Token via the existing Twilio account/API key, mobile app fetches it on pair (or lazily on call ring), passes it to the SDK. Push: Twilio + FCM/APNs handles ringing-while-app-killed for free. Most production-friendly path.
- **WebRTC peer-to-peer (browser only) → Add `react-native-webrtc` + a signaling layer.** More work — mobile needs to receive the `offer` SDP via WebSocket or push, send back `answer`, then negotiate ICE. Reuses existing dashboard signaling server. No call-while-killed support without push.
- **Agora / Daily / LiveKit → Use their official RN SDK.** Pattern is the same as Twilio: backend mints a join token, mobile joins the room via SDK. All three publish RN SDKs.
- **Custom WebSocket audio → Re-implement with WebRTC.** Custom audio over WebSocket usually doesn't survive the trip to mobile (no native browser audio APIs). Recommend migrating both sides to WebRTC.
- **Calls not built yet → Recommend Twilio Voice or LiveKit.** Both have hosted infra, RN SDKs, and HIPAA BAAs. Twilio is easier to wire; LiveKit is cheaper at scale and self-hostable.

**Step C — Wake-from-killed UX.** Regardless of the SDK, the patient must hear the phone ring even when the app is closed. That requires:

- **iOS:** PushKit + CallKit. The app receives a VoIP push, then must report an incoming call to CallKit within a few seconds or iOS kills the process. Use `react-native-callkeep` for the CallKit bridge.
- **Android:** FCM data message + a foreground service that displays a full-screen incoming-call notification (also `react-native-callkeep` handles this).

This is non-trivial — budget 2–3 days for a competent agent including provisioning push certs, BAAs, and testing the kill-then-ring flow.

**Step D — Backend coordination.** Whatever signaling the dashboard uses, the backend will need a new endpoint:

```
POST /api/patients/{pid}/call/initiate
  → mints a token / room / call SID
  → sends VoIP push to the patient's device
  → returns the same token to the clinician dashboard
```

And the device-side push token registration we already deferred to v2 in `docs/backend-contract.md` becomes mandatory now:

```
POST /api/devices/{device_id}/push_token
  Body: { provider: "fcm" | "apns" | "twilio", token: "...", voip: bool }
```

The mobile app should call this on pair and on every cold start (tokens rotate).

### 1.5 Acceptance criteria

The integration is "done" when:

1. ✅ Single repo, single PR-able codebase, single CI matrix that runs backend tests + mobile typecheck + dashboard build.
2. ✅ `Sample`, pairing types, and call event types are defined exactly **once** in `@sentinel/contract`. Both `apps/mobile` and `packages/backend` import from there. The `json.error` vs `json.detail.error` class of bug becomes impossible.
3. ✅ Patient on the mobile app can see, on the home/Status screen: their recent HR / SpO2 / steps, sync status, active alerts, and next scheduled call — pulled from the **same backend endpoints** the dashboard uses (no parallel calculation).
4. ✅ Clinician on the dashboard can press "Call patient" and the patient's phone rings within ~5 seconds, even if the app is killed.
5. ✅ Patient can answer, hold, and hang up the call from a CallKit-style native UI.
6. ✅ Call audio works on Android (test) and iOS (teammate's Mac).
7. ✅ All existing mobile features (pairing, Health Connect grant, vitals sync) still work end-to-end after the move.
8. ✅ The Health Connect Expo plugin (`plugins/with-health-connect-delegate.js`) and its docstring move with the mobile app intact. Future Android prebuilds re-apply the 3 native fixes it injects.

---

## Part 2 — Concrete next-action steps

Do these in order. Each block is small enough to verify before moving on.

### 2.1 Pre-move: commit and push the mobile repo as-is

The mobile repo currently has uncommitted changes that fix 4 Android bugs (Health Connect lateinit, missing `<queries>`, missing Android 14 rationale intent filter, stale auth-guard state). **Commit and push these first** so the merge brings a known-good baseline.

```bash
cd SentinelMobile
git status                # should show changes to app/, src/, plugins/, app.json
git add -A
git commit -m "fix(android): wire Health Connect permissions delegate + queries + Android 14 rationale filter; refresh auth guard on navigation"
git push origin main
```

**Important files in this commit (do not lose during the move):**

- `plugins/with-health-connect-delegate.js` — the custom Expo plugin. Read its docstring; it fixes 3 separate native bugs that took hours to diagnose.
- `app.json` — references the plugin via `"./plugins/with-health-connect-delegate.js"`.
- `app/_layout.tsx` — auth guard with the navigation-aware re-read fix.
- `app/index.tsx` — catches the `sentinel://` redirect-back from Health Connect.
- `src/health/android.ts` — relaxed `hasPermissions()` to mirror partial-grant policy.
- `src/sync/client.ts` — `readErrorCode()` helper that handles both `{error}` and `{detail: {error}}` shapes.
- `app/(onboarding)/permissions.tsx` — bottom-sheet handoff UI with AppState auto-resume.

### 2.2 Set up the monorepo skeleton in the main repo

```bash
cd <main-sentinel-repo>
git checkout -b chore/monorepo-shape

# Create the skeleton
mkdir -p apps packages/contract/src
echo 'packages:\n  - "apps/*"\n  - "packages/*"' > pnpm-workspace.yaml
```

Root `package.json`:

```json
{
  "name": "sentinel",
  "private": true,
  "scripts": {
    "mobile": "pnpm -F @sentinel/mobile",
    "backend": "pnpm -F @sentinel/backend",
    "dashboard": "pnpm -F @sentinel/dashboard",
    "typecheck": "pnpm -r typecheck"
  },
  "devDependencies": {
    "typescript": "~5.3.3"
  }
}
```

Root `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true
  }
}
```

### 2.3 Move the existing repos in

```bash
# Move dashboard + backend into their workspace slots first (preserve git history with subtree merge if you care).
git mv <existing-backend-folder> packages/backend
git mv <existing-dashboard-folder> packages/dashboard

# Pull mobile in as an apps/mobile subtree so its history survives.
git remote add mobile-origin https://github.com/Elitelord/SentinelMobile.git
git fetch mobile-origin
git subtree add --prefix=apps/mobile mobile-origin main --squash
```

Then update each child `package.json`:

- `packages/backend/package.json` → `"name": "@sentinel/backend"`
- `packages/dashboard/package.json` → `"name": "@sentinel/dashboard"`
- `apps/mobile/package.json` → `"name": "@sentinel/mobile"` (currently `"sentinel-mobile"`)

Run `pnpm install` from root. Verify:
- `pnpm -F @sentinel/mobile typecheck` passes.
- `pnpm -F @sentinel/backend test` passes (8 smoke tests).
- `pnpm -F @sentinel/dashboard build` passes.

### 2.4 Decide: commit `apps/mobile/android/` or not?

Two options:

- **Don't commit `android/` and `ios/`**, regenerate via `npx expo prebuild` per-build. Cleaner repo, but the Expo config plugin must be re-applied every prebuild (it is, automatically — that's what plugins are for).
- **Commit `android/`** so the next dev can build without running prebuild. Bigger repo, but the Health Connect fix is visible in MainActivity.kt without indirection.

**Recommendation:** don't commit. The plugin (`plugins/with-health-connect-delegate.js`) is the source of truth and re-runs deterministically. Add to `apps/mobile/.gitignore`:

```
android/
ios/
```

(They might already be gitignored — check `apps/mobile/.gitignore` after the move.)

### 2.5 Extract the contract package

```bash
mkdir -p packages/contract/src packages/contract/docs
git mv apps/mobile/docs/backend-contract.md packages/contract/docs/backend-contract.md
```

`packages/contract/package.json`:

```json
{
  "name": "@sentinel/contract",
  "version": "0.1.0",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit" },
  "devDependencies": { "typescript": "~5.3.3" }
}
```

Move shared type definitions:

- Cut `apps/mobile/src/health/types.ts` → `packages/contract/src/vitals.ts` (the `Sample`, `Kind`, `Unit`, `SleepStage` types).
- Cut the request/response types from `apps/mobile/src/auth/pairing.ts` and `src/sync/client.ts` → `packages/contract/src/{pairing,vitals}.ts`.

Add to `apps/mobile/package.json` dependencies:

```json
"@sentinel/contract": "workspace:*"
```

Update mobile imports:

```ts
// before
import type { Sample } from '../health/types';
// after
import type { Sample } from '@sentinel/contract';
```

Backend (Python) doesn't import TypeScript directly, but the agent should generate Python equivalents from the same source — either with a small codegen script or by mirroring by hand and adding a CI check that diffs the JSON-schema'd shapes.

### 2.6 Audit the dashboard's patient-facing code

```bash
# Find every patient-facing component and endpoint.
rg -l "patient" packages/dashboard/src
rg "GET .*patients" packages/backend
```

Output: a list of every screen / API route that displays patient-only data. The agent should produce a table:

| Dashboard component | Backend endpoint | Move to mobile? |
|---|---|---|
| `<PatientStatusCard/>` | `GET /api/patients/{pid}` | Yes — Status home |
| `<VitalsChart kind="hr"/>` | `GET /api/patients/{pid}/vitals?kind=hr` | Yes — `vitals/[kind].tsx` |
| `<AlertsList patientId/>` | `GET /api/patients/{pid}/alerts` | Yes — `alerts.tsx` |
| `<CallScheduler/>` | `POST /api/patients/{pid}/call/schedule` | Read-only mobile view |
| ... | ... | ... |

Hand this table to the user before writing any mobile screens. Don't guess.

### 2.7 Build the mobile patient dashboard

For each row in the table above marked "Yes":

1. Identify the backend endpoint (most should already exist for the dashboard).
2. Add an authenticated fetch helper in `apps/mobile/src/api/`:

   ```ts
   import { config } from '../config';
   import { loadCredentials } from '../auth/storage';
   export async function authedFetch(path: string, init: RequestInit = {}) {
     const creds = await loadCredentials();
     if (!creds) throw new Error('not_paired');
     return fetch(`${config.apiUrl}${path}`, {
       ...init,
       headers: {
         ...init.headers,
         Authorization: `Bearer ${creds.deviceToken}`,
         'Content-Type': 'application/json',
       },
     });
   }
   ```

3. Build the screen with React Query (`@tanstack/react-query` — add to deps) for caching / refetch / loading state. Don't roll your own state for server data.
4. Use the shared types from `@sentinel/contract` for response shapes.

### 2.8 Audit & implement calling

In this order:

1. **Audit** — see §1.4 step A. Produce a one-paragraph "calls today" doc.
2. **Pick the SDK** — see §1.4 step B.
3. **Add device push token registration to the mobile app:**
   - On pair success, request push permissions, get FCM/APNs token, POST to `/api/devices/{device_id}/push_token`.
   - On every cold start, refresh.
4. **Backend changes:**
   - Add the push_token endpoint.
   - Add `POST /api/patients/{pid}/call/initiate` (or whatever the existing dashboard call flow needs).
   - On call initiate, send a VoIP push to the registered token.
5. **Mobile call handling:**
   - Install `react-native-callkeep` + the chosen voice SDK.
   - Wire `react-native-callkeep` to display the incoming call UI.
   - Build `app/(main)/call.tsx` for the in-call screen (mute, speaker, hangup).
6. **Test the kill-then-ring path on a real device.** Emulators don't reliably test push.

### 2.9 Test plan before declaring done

End-to-end on a real Android device:

1. Fresh install → enroll patient → pair phone → grant Health Connect → walk 2 min → see HR samples on the patient mobile dashboard.
2. Clinician dashboard → "Call patient" → patient's phone rings (app foreground) → answer → audio works → hang up.
3. Repeat #2 with the mobile app **fully killed** (swipe from recents) → phone still rings → answer → audio works.
4. Trigger an alert (mock high HR) → patient sees red banner on Status; clinician sees alert on dashboard.
5. Unpair from settings → app returns to pair screen → re-pair with new code works.

Same flow on iOS with the teammate's Mac.

---

## Quick reference — what NOT to do

- **Do not** edit `apps/mobile/android/app/src/main/AndroidManifest.xml` directly. It's regenerated every prebuild. Edit `plugins/with-health-connect-delegate.js` instead.
- **Do not** edit `apps/mobile/android/app/src/main/java/.../MainActivity.kt` directly. Same reason.
- **Do not** revert the `<queries>` block, the `VIEW_PERMISSION_USAGE` intent filter, or the `HealthConnectPermissionDelegate.setPermissionDelegate(this)` call in MainActivity. Each one fixes a separate Android bug that breaks Health Connect entirely.
- **Do not** parse FastAPI errors as `json.error` anymore. Use the `readErrorCode` helper in `src/sync/client.ts` (and ideally promote it to `@sentinel/contract`).
- **Do not** add a second SecureStore write path for credentials. The auth guard now re-reads on every navigation; that's the contract.
- **Do not** add a runtime permission re-prompt loop. Health Connect's settings page is the user's grant surface; the mobile app surfaces grant state but doesn't re-ask. (See `app/(onboarding)/permissions.tsx` for the correct pattern.)

---

## Open questions for the user

If any of these matter to the design, ask before building:

1. Is the dashboard's call infrastructure built yet? (Affects whether to greenfield Twilio/LiveKit or integrate existing.)
2. Is push messaging set up (FCM project, APNs cert)? If not, the calling work depends on getting those provisioned.
3. Is there a HIPAA BAA in place with whoever provides voice? If not, **block calling work until there is**.
4. For the patient dashboard, are there existing Figma designs, or is the agent expected to design as well as build?
5. Should the patient be able to *initiate* a call (panic button), or only receive? Same SDK either way, but the UX is different.
