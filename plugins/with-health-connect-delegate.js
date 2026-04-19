/**
 * Expo config plugin for react-native-health-connect on Android 11+.
 *
 * Does three things, all required for Health Connect to work at all:
 *
 * 1. Registers HealthConnectPermissionDelegate in MainActivity.onCreate.
 *    The library's delegate holds a `lateinit` ActivityResultLauncher that
 *    must be wired via registerForActivityResult before the activity reaches
 *    STARTED. Without this, tapping the permissions button crashes with:
 *      kotlin.UninitializedPropertyAccessException: lateinit property
 *      requestPermission has not been initialized
 *
 * 2. Adds Health Connect to AndroidManifest's <queries> block. On Android
 *    11+ (R), package visibility is opt-in. If we don't query the Health
 *    Connect package, PermissionController.createRequestPermissionResultContract
 *    silently launches an empty intent — the system shows nothing, the
 *    activity result returns an empty Set, and the user sees no dialog.
 *
 *    Two package names exist in the wild:
 *      - com.google.android.apps.healthdata  (legacy standalone app)
 *      - com.google.android.healthdata       (Android 14+ system module)
 *    We query both so the permission picker resolves on every device.
 *
 * 3. Adds the Android 14+ permissions rationale intent filter to MainActivity.
 *    Health Connect's PermissionsActivity refuses to display the picker
 *    unless the requesting app advertises a screen that explains why it
 *    needs the data. On Android 14+ the system checks for:
 *      action  = android.intent.action.VIEW_PERMISSION_USAGE
 *      category = android.intent.category.HEALTH_PERMISSIONS
 *    Without this, logcat shows:
 *      E/PermissionsActivity: App should support rationale intent, finishing!
 *    and the picker activity finishes immediately without any UI.
 *
 *    The legacy `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE` filter
 *    that the official react-native-health-connect plugin adds is needed
 *    for Android 13 and below, so we keep both.
 */
const { withMainActivity, withAndroidManifest } = require('@expo/config-plugins');

const IMPORT_LINE =
  'import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate';

const SETUP_CALL = 'HealthConnectPermissionDelegate.setPermissionDelegate(this)';

function addImport(src) {
  if (src.includes(IMPORT_LINE)) return src;
  // Insert after the package line so all imports stay grouped.
  return src.replace(/^(package [^\n]+\n)/, `$1\n${IMPORT_LINE}\n`);
}

function addSetupCall(src) {
  if (src.includes(SETUP_CALL)) return src;

  // Match the Kotlin onCreate signature Expo generates:
  //   override fun onCreate(savedInstanceState: Bundle?) {
  //     ...
  //     super.onCreate(...)
  //     ...
  //   }
  // We inject our call right after super.onCreate so the activity is
  // fully constructed but still pre-STARTED.
  const superCallRe = /(super\.onCreate\([^)]*\))/;
  if (!superCallRe.test(src)) {
    throw new Error(
      '[with-health-connect-delegate] Could not find super.onCreate(...) in MainActivity. ' +
        'The plugin needs an update for this Expo template.',
    );
  }
  return src.replace(superCallRe, `$1\n    ${SETUP_CALL}`);
}

const HC_PACKAGES = [
  'com.google.android.apps.healthdata',
  'com.google.android.healthdata',
];

function withRationaleIntentFilter(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    const main = app?.activity?.find((a) => a.$?.['android:name'] === '.MainActivity');
    if (!main) {
      throw new Error(
        '[with-health-connect-delegate] Could not find <activity android:name=".MainActivity"> in manifest.',
      );
    }
    main['intent-filter'] = main['intent-filter'] || [];

    const ANDROID_14_ACTION = 'android.intent.action.VIEW_PERMISSION_USAGE';
    const ANDROID_14_CATEGORY = 'android.intent.category.HEALTH_PERMISSIONS';

    const alreadyHas14 = main['intent-filter'].some(
      (f) =>
        f.action?.some((a) => a.$?.['android:name'] === ANDROID_14_ACTION) &&
        f.category?.some((c) => c.$?.['android:name'] === ANDROID_14_CATEGORY),
    );
    if (!alreadyHas14) {
      main['intent-filter'].push({
        action: [{ $: { 'android:name': ANDROID_14_ACTION } }],
        category: [{ $: { 'android:name': ANDROID_14_CATEGORY } }],
      });
    }
    return cfg;
  });
}

function withHealthConnectQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.queries = manifest.queries || [];
    if (manifest.queries.length === 0) manifest.queries.push({});
    const q = manifest.queries[0];
    q.package = q.package || [];
    for (const pkg of HC_PACKAGES) {
      const present = q.package.some((p) => p.$ && p.$['android:name'] === pkg);
      if (!present) {
        q.package.push({ $: { 'android:name': pkg } });
      }
    }
    return cfg;
  });
}

function withMainActivityDelegate(config) {
  return withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error(
        '[with-health-connect-delegate] Expected Kotlin MainActivity. Got: ' +
          cfg.modResults.language,
      );
    }
    let src = cfg.modResults.contents;
    src = addImport(src);
    src = addSetupCall(src);
    cfg.modResults.contents = src;
    return cfg;
  });
}

const withHealthConnectDelegate = (config) => {
  config = withMainActivityDelegate(config);
  config = withHealthConnectQueries(config);
  config = withRationaleIntentFilter(config);
  return config;
};

module.exports = withHealthConnectDelegate;
