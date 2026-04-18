import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { exchangePairingCode, parsePairingInput } from '../../src/auth/pairing';

export default function PairScreen() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    const code = parsePairingInput(input);
    if (!code) {
      Alert.alert('Invalid code', 'Enter the 6-digit code from your care team.');
      return;
    }
    setLoading(true);
    const result = await exchangePairingCode(code);
    setLoading(false);

    if (!result.ok) {
      const msg =
        result.error.kind === 'code_invalid_or_expired'
          ? 'That code is invalid or has expired. Ask your care team for a new one.'
          : result.error.kind === 'code_already_consumed'
            ? 'That code has already been used.'
            : result.error.kind === 'network'
              ? `Could not reach the server: ${result.error.message}`
              : `Unexpected error (${'status' in result.error ? result.error.status : '?'})`;
      Alert.alert('Pairing failed', msg);
      return;
    }
    router.replace('/(onboarding)/permissions');
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Pair with Sentinel</Text>
        <Text style={styles.body}>
          Enter the 6-digit code from your care team to connect this phone to your record.
        </Text>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="123456"
          keyboardType="number-pad"
          maxLength={6}
          autoFocus
          style={styles.input}
          editable={!loading}
        />
        <TouchableOpacity
          onPress={onSubmit}
          disabled={loading}
          style={[styles.button, loading && styles.buttonDisabled]}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.buttonText}>Connect</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#f5f5f7' },
  card: { backgroundColor: 'white', borderRadius: 16, padding: 24, gap: 16 },
  title: { fontSize: 24, fontWeight: '600' },
  body: { fontSize: 15, color: '#444', lineHeight: 21 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 14,
    fontSize: 24,
    letterSpacing: 8,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#0a84ff',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: 'white', fontWeight: '600', fontSize: 16 },
});
