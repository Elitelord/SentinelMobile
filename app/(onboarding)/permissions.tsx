import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  type AppStateStatus,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { getHealthAdapter } from '../../src/health';
import { registerBackgroundSync, runSyncOnce } from '../../src/sync/task';

type Phase = 'intro' | 'sheet' | 'awaiting-system' | 'verifying';

export default function PermissionsScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('intro');
  const [error, setError] = useState<string | null>(null);
  const adapter = getHealthAdapter();

  // Auto-detect when the user returns from the system Health Connect
  // settings screen. If they granted anything, advance to Status without
  // requiring another tap. This is the trick that makes the round-trip
  // feel like a single guided handoff instead of two disconnected screens.
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (next: AppStateStatus) => {
      const wasBackground = appState.current.match(/inactive|background/);
      appState.current = next;
      if (!wasBackground || next !== 'active') return;
      if (phase !== 'awaiting-system') return;

      setPhase('verifying');
      const ok = await adapter.hasPermissions();
      if (ok) {
        await onGranted();
      } else {
        setPhase('sheet');
        setError(
          Platform.OS === 'android'
            ? 'It looks like access wasn\u2019t granted. Tap Continue to try again.'
            : 'Permissions still missing. Open Health to grant.',
        );
      }
    });
    return () => sub.remove();
  }, [phase]);

  async function onGranted() {
    await registerBackgroundSync().catch(() => {});
    runSyncOnce().catch(() => {});
    router.replace('/(main)/status');
  }

  async function onContinue() {
    setError(null);
    setPhase('awaiting-system');
    const granted = await adapter.requestPermissions();
    // If the OS dismisses without sending us to background (e.g. denied
    // immediately, or Health Connect missing), the AppState listener won't
    // fire. Fall back to the direct return value.
    if (granted) {
      await onGranted();
      return;
    }
    // If we got back here without going through background, treat as denied.
    if (appState.current === 'active') {
      setPhase('sheet');
      setError(
        Platform.OS === 'android'
          ? 'Health Connect closed without granting access. Tap Continue to try again, or open Health Connect manually.'
          : 'Open the Health app \u2192 Sharing \u2192 Sentinel to grant access.',
      );
    }
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
        <Text style={styles.bodyMuted}>Sentinel never writes to {sourceName}.</Text>
        <TouchableOpacity onPress={() => setPhase('sheet')} style={styles.button}>
          <Text style={styles.buttonText}>Get started</Text>
        </TouchableOpacity>
      </View>

      <HandoffSheet
        visible={phase !== 'intro'}
        loading={phase === 'awaiting-system' || phase === 'verifying'}
        loadingLabel={phase === 'verifying' ? 'Checking access\u2026' : 'Opening Health Connect\u2026'}
        error={error}
        sourceName={sourceName}
        onContinue={onContinue}
        onClose={() => {
          if (phase === 'awaiting-system' || phase === 'verifying') return;
          setPhase('intro');
          setError(null);
        }}
      />
    </View>
  );
}

type SheetProps = {
  visible: boolean;
  loading: boolean;
  loadingLabel: string;
  error: string | null;
  sourceName: string;
  onContinue: () => void;
  onClose: () => void;
};

function HandoffSheet({
  visible,
  loading,
  loadingLabel,
  error,
  sourceName,
  onContinue,
  onClose,
}: SheetProps) {
  const translateY = useRef(new Animated.Value(600)).current;
  const backdrop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: visible ? 0 : 600,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdrop, {
        toValue: visible ? 1 : 0,
        duration: 240,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible]);

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, { opacity: backdrop }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View
        style={[styles.sheet, { transform: [{ translateY }] }]}
      >
        <View style={styles.handle} />
        <Text style={styles.sheetTitle}>Connect to {sourceName}</Text>
        <Text style={styles.sheetBody}>
          {Platform.OS === 'android'
            ? 'When you tap Continue, Android will open the Health Connect settings page so you can choose what to share.'
            : 'When you tap Continue, the Health app will ask which vitals to share.'}
        </Text>

        <View style={styles.steps}>
          <Step n={1} text={Platform.OS === 'android' ? 'Tap "Allow all" at the top of the Health Connect screen.' : 'Tap "Turn On All" at the top.'} />
          <Step n={2} text={Platform.OS === 'android' ? 'Press the back button or swipe back when you\u2019re done.' : 'Tap "Allow" in the top-right corner.'} />
          <Step n={3} text="Sentinel will pick up where it left off automatically." />
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity
          onPress={onContinue}
          disabled={loading}
          style={[styles.primary, loading && styles.primaryDisabled]}
        >
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="white" />
              <Text style={styles.loadingText}>{loadingLabel}</Text>
            </View>
          ) : (
            <Text style={styles.primaryText}>
              Continue to {sourceName}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={onClose} disabled={loading} style={styles.secondary}>
          <Text style={[styles.secondaryText, loading && { opacity: 0.4 }]}>Not now</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepBadge}>
        <Text style={styles.stepBadgeText}>{n}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#f5f5f7' },
  card: { backgroundColor: 'white', borderRadius: 16, padding: 24, gap: 16 },
  title: { fontSize: 24, fontWeight: '600' },
  body: { fontSize: 15, color: '#444', lineHeight: 21 },
  bodyMuted: { fontSize: 13, color: '#888', lineHeight: 18 },
  button: {
    backgroundColor: '#0a84ff',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: 'white', fontWeight: '600', fontSize: 16 },

  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'white',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
    gap: 16,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#d0d0d5',
    marginBottom: 8,
  },
  sheetTitle: { fontSize: 20, fontWeight: '600' },
  sheetBody: { fontSize: 15, color: '#444', lineHeight: 21 },

  steps: { gap: 12, marginTop: 4 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#0a84ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeText: { color: 'white', fontWeight: '700', fontSize: 13 },
  stepText: { flex: 1, fontSize: 14, color: '#333', lineHeight: 20 },

  error: {
    fontSize: 13,
    color: '#b3261e',
    backgroundColor: '#fdecea',
    padding: 12,
    borderRadius: 8,
  },

  primary: {
    backgroundColor: '#0a84ff',
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryDisabled: { opacity: 0.7 },
  primaryText: { color: 'white', fontWeight: '600', fontSize: 16 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  loadingText: { color: 'white', fontWeight: '500', fontSize: 15 },

  secondary: { paddingVertical: 12, alignItems: 'center' },
  secondaryText: { color: '#0a84ff', fontWeight: '500', fontSize: 15 },
});
