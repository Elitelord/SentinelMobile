import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { loadCredentials } from '../src/auth/storage';
import { registerBackgroundSync } from '../src/sync/task';

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const [ready, setReady] = useState(false);
  const [paired, setPaired] = useState(false);

  useEffect(() => {
    (async () => {
      const creds = await loadCredentials();
      setPaired(!!creds);
      setReady(true);
      if (creds) {
        // Best-effort — failures are non-fatal (denied/restricted background mode).
        registerBackgroundSync().catch(() => {});
      }
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    const inOnboarding = segments[0] === '(onboarding)';
    if (!paired && !inOnboarding) {
      router.replace('/(onboarding)/pair');
    } else if (paired && inOnboarding) {
      router.replace('/(main)/status');
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
