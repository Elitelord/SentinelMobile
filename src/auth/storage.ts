import * as SecureStore from 'expo-secure-store';

const KEYS = {
  deviceToken: 'sentinel.device_token',
  patientId: 'sentinel.patient_id',
  deviceId: 'sentinel.device_id',
  pairTime: 'sentinel.pair_time',
  syncCursor: 'sentinel.sync_cursor',
} as const;

export type Credentials = {
  deviceToken: string;
  patientId: string;
  deviceId: string;
  pairTime: string; // ISO8601
};

export async function saveCredentials(c: Credentials): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEYS.deviceToken, c.deviceToken),
    SecureStore.setItemAsync(KEYS.patientId, c.patientId),
    SecureStore.setItemAsync(KEYS.deviceId, c.deviceId),
    SecureStore.setItemAsync(KEYS.pairTime, c.pairTime),
    // Initial cursor = pair_time (forward-only, no backfill).
    SecureStore.setItemAsync(KEYS.syncCursor, c.pairTime),
  ]);
}

export async function loadCredentials(): Promise<Credentials | null> {
  const [deviceToken, patientId, deviceId, pairTime] = await Promise.all([
    SecureStore.getItemAsync(KEYS.deviceToken),
    SecureStore.getItemAsync(KEYS.patientId),
    SecureStore.getItemAsync(KEYS.deviceId),
    SecureStore.getItemAsync(KEYS.pairTime),
  ]);
  if (!deviceToken || !patientId || !deviceId || !pairTime) return null;
  return { deviceToken, patientId, deviceId, pairTime };
}

export async function clearCredentials(): Promise<void> {
  await Promise.all(
    Object.values(KEYS).map((k) => SecureStore.deleteItemAsync(k)),
  );
}

export async function getSyncCursor(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.syncCursor);
}

export async function setSyncCursor(iso: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.syncCursor, iso);
}
