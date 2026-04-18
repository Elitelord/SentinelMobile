import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { loadCredentials, type Credentials } from '../../src/auth/storage';
import { readLastSyncStatus, runSyncOnce, type LastSyncStatus } from '../../src/sync/task';

export default function StatusScreen() {
  const router = useRouter();
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [last, setLast] = useState<LastSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    const [c, s] = await Promise.all([loadCredentials(), readLastSyncStatus()]);
    setCreds(c);
    setLast(s);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  useEffect(() => {
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  async function onSyncNow() {
    setSyncing(true);
    await runSyncOnce().catch(() => {});
    await refresh();
    setSyncing(false);
  }

  if (!creds) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} />}
    >
      <Text style={styles.h1}>Sentinel</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Patient</Text>
        <Text style={styles.mono}>{creds.patientId}</Text>
        <Text style={[styles.label, { marginTop: 12 }]}>Device</Text>
        <Text style={styles.mono}>{creds.deviceId}</Text>
        <Text style={[styles.label, { marginTop: 12 }]}>Paired</Text>
        <Text style={styles.body}>{new Date(creds.pairTime).toLocaleString()}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Last sync</Text>
        {last ? (
          <>
            <Text style={styles.body}>{new Date(last.at).toLocaleString()}</Text>
            <Text style={[styles.body, resultStyle(last.result)]}>
              {labelFor(last.result)}
              {last.acceptedTotal != null ? ` — ${last.acceptedTotal} samples` : ''}
              {last.flaggedClockSkewTotal ? ` (${last.flaggedClockSkewTotal} clock-skew)` : ''}
            </Text>
            {last.message ? <Text style={styles.muted}>{last.message}</Text> : null}
          </>
        ) : (
          <Text style={styles.muted}>No sync has run yet.</Text>
        )}

        <TouchableOpacity
          onPress={onSyncNow}
          disabled={syncing}
          style={[styles.button, syncing && styles.buttonDisabled]}
        >
          {syncing ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.buttonText}>Sync now</Text>
          )}
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={() => router.push('/(main)/settings')}>
        <Text style={styles.link}>Settings</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function labelFor(r: LastSyncStatus['result']): string {
  switch (r) {
    case 'ok': return 'OK';
    case 'no_creds': return 'Not paired';
    case 'no_perms': return 'Health permissions missing';
    case 'partial': return 'Partial — some chunks failed';
    case 'rate_limited': return 'Rate limited — will retry';
    case 'revoked': return 'Device unpaired by care team';
    case 'error': return 'Error';
  }
}

function resultStyle(r: LastSyncStatus['result']) {
  if (r === 'ok') return { color: '#1a7f37' };
  if (r === 'partial' || r === 'rate_limited') return { color: '#bf8700' };
  return { color: '#cf222e' };
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 64, gap: 16, backgroundColor: '#f5f5f7' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  h1: { fontSize: 28, fontWeight: '700' },
  card: { backgroundColor: 'white', borderRadius: 16, padding: 20, gap: 4 },
  label: { fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 },
  body: { fontSize: 15, color: '#222' },
  mono: { fontSize: 13, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }), color: '#222' },
  muted: { fontSize: 13, color: '#888' },
  link: { fontSize: 15, color: '#0a84ff', textAlign: 'center', padding: 16 },
  button: {
    backgroundColor: '#0a84ff',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: 'white', fontWeight: '600' },
});

