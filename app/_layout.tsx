import { Stack, useRouter, useSegments } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { loadCredentials } from '../src/auth/storage';
import { registerBackgroundSync } from '../src/sync/task';

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const [ready, setReady] = useState(false);
  const [paired, setPaired] = useState(false);
  const lastChecked = useRef(0);

  // Re-read credentials from SecureStore. We keep this debounced (250ms)
  // because expo-router fires `segments` updates several times during a
  // single navigation, and we don't want to thrash SecureStore decryption.
  const refreshAuth = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastChecked.current < 250) return;
    lastChecked.current = now;
    const creds = await loadCredentials();
    setPaired((prev) => {
      if (prev !== !!creds) {
        if (creds) registerBackgroundSync().catch(() => {});
        return !!creds;
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    (async () => {
      await refreshAuth(true);
      setReady(true);
    })();
  }, [refreshAuth]);

  // Re-check on every navigation. Without this, a successful pair (which
  // writes credentials and replaces() into a different group) leaves the
  // layout's `paired` state stale, and the auth guard below bounces the
  // user straight back to /(onboarding)/pair even though they're now paired.
  useEffect(() => {
    if (ready) refreshAuth();
  }, [segments, ready, refreshAuth]);

  // Re-check when the app foregrounds (e.g. after the Health Connect
  // round-trip) so the guard doesn't act on stale state.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && ready) refreshAuth(true);
    });
    return () => sub.remove();
  }, [ready, refreshAuth]);

  useEffect(() => {
    if (!ready) return;
    const inOnboarding = segments[0] === '(onboarding)';
    if (!paired && !inOnboarding) {
      router.replace('/(onboarding)/pair');
    } else if (paired && inOnboarding) {
      // Only auto-promote out of the pair screen. The permissions screen
      // is part of (onboarding) but should NOT bounce the user away —
      // they need to grant Health Connect access before reaching status.
      if (segments[1] === 'pair') {
        router.replace('/(onboarding)/permissions');
      }
    }
  }, [ready, paired, segments, router]);

  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
