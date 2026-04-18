import Constants from 'expo-constants';
import { Platform } from 'react-native';

function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required env ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

export const config = {
  get apiUrl(): string {
    return requireEnv('EXPO_PUBLIC_API_URL', process.env.EXPO_PUBLIC_API_URL);
  },
  appVersion: process.env.EXPO_PUBLIC_APP_VERSION ?? '0.1.0',
  platform: Platform.OS as 'ios' | 'android',
  deviceModel: Constants.deviceName ?? 'unknown',
  osVersion: `${Platform.OS} ${Platform.Version}`,
  // Background sync cadence (minutes). iOS minimum is ~15.
  syncIntervalMinutes: 15,
  // Per-batch sample cap. Backend returns 413 above this.
  maxSamplesPerBatch: 1000,
  // How far back to look for samples on each sync if no cursor exists yet.
  initialLookbackMinutes: 15,
};

export const BACKGROUND_SYNC_TASK = 'sentinel.background-sync';
