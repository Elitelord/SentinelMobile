import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { config } from '../../src/config';
import { clearCredentials } from '../../src/auth/storage';
import { unregisterBackgroundSync } from '../../src/sync/task';

export default function SettingsScreen() {
  const router = useRouter();

  function onUnpair() {
    Alert.alert(
      'Unpair this device?',
      'You will need a new pairing code from your care team to reconnect.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unpair',
          style: 'destructive',
          onPress: async () => {
            await unregisterBackgroundSync().catch(() => {});
            await clearCredentials();
            router.replace('/(onboarding)/pair');
          },
        },
      ],
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.h1}>Settings</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Backend</Text>
        <Text style={styles.mono}>{config.apiUrl}</Text>

        <Text style={[styles.label, { marginTop: 12 }]}>App version</Text>
        <Text style={styles.body}>{config.appVersion}</Text>

        <Text style={[styles.label, { marginTop: 12 }]}>Sync interval</Text>
        <Text style={styles.body}>{config.syncIntervalMinutes} minutes</Text>
      </View>

      <TouchableOpacity onPress={onUnpair} style={styles.dangerButton}>
        <Text style={styles.dangerButtonText}>Unpair this device</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.back()}>
        <Text style={styles.link}>Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 64, gap: 16, backgroundColor: '#f5f5f7' },
  h1: { fontSize: 28, fontWeight: '700' },
  card: { backgroundColor: 'white', borderRadius: 16, padding: 20, gap: 4 },
  label: { fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 },
  body: { fontSize: 15, color: '#222' },
  mono: { fontSize: 13, fontFamily: 'Menlo', color: '#222' },
  dangerButton: {
    borderWidth: 1,
    borderColor: '#cf222e',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  dangerButtonText: { color: '#cf222e', fontWeight: '600' },
  link: { fontSize: 15, color: '#0a84ff', textAlign: 'center', padding: 16 },
});
