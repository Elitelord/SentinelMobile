import { Redirect } from 'expo-router';

// Catches sentinel:// deep links with no path (e.g. Health Connect redirect-back).
// The root layout's auth guard will redirect to the right screen.
export default function Index() {
  return <Redirect href="/(main)/status" />;
}
