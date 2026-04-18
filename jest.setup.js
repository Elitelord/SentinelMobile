// Inject env vars so config.ts doesn't throw at import time during unit tests.
// Real values come from .env at runtime (via Expo's EXPO_PUBLIC_* mechanism).
process.env.EXPO_PUBLIC_API_URL = 'http://test.local:8000';
process.env.EXPO_PUBLIC_APP_VERSION = '0.0.0-test';
