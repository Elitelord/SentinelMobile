import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { getHealthAdapter } from '../../src/health';
import { registerBackgroundSync, runSyncOnce } from '../../src/sync/task';

export default function PermissionsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onGrant() {
    setLoading(true);
    const adapter = getHealthAdapter();
    const granted = await adapter.requestPermissions();
    setLoading(false);

    if (!granted) {
      Alert.alert(
        'Permissions needed',
        Platform.OS === 'ios'
          ? 'Open the Health app → Sharing → Sentinel to grant the required types.'
          : 'Open Health Connect → App permissions → Sentinel to grant the required types.',
      );
      return;
    }
    await registerBackgroundSync().catch(() => {});
    runSyncOnce().catch(() => {});
    router.replace('/(main)/status');
  }

  const sourceName = Platform.OS === 'ios' ? 'Apple Health' : 'Health Connect';

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Allow vitals access</Text>
        <Text style={styles.body}>
          Sentinel reads your heart rate, blood oxygen, respiratory rate, temperature, sleep, and
          activity from {sourceName}. Your care team uses this alongside check-in calls to spot
          early signs of post-operative deterioration.
        </Text>
        <Text style={styles.body}>Sentinel never writes to {sourceName}.</Text>
        <TouchableOpacity
          onPress={onGrant}
          disabled={loading}
          style={[styles.button, loading && styles.buttonDisabled]}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.buttonText}>Grant access</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#f5f5f7' },
  card: { backgroundColor: 'white', borderRadius: 16, padding: 24, gap: 16 },
  title: { fontSize: 24, fontWeight: '600' },
  body: { fontSize: 15, color: '#444', lineHeight: 21 },
  button: {
    backgroundColor: '#0a84ff',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: 'white', fontWeight: '600', fontSize: 16 },
});
