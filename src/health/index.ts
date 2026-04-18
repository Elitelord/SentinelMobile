import { Platform } from 'react-native';
import type { HealthAdapter } from './types';

export * from './types';

let cached: HealthAdapter | null = null;

export function getHealthAdapter(): HealthAdapter {
  if (cached) return cached;
  if (Platform.OS === 'ios') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('./ios').iosAdapter;
  } else if (Platform.OS === 'android') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('./android').androidAdapter;
  } else {
    throw new Error(`Unsupported platform: ${Platform.OS}`);
  }
  return cached!;
}
