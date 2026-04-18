/// <reference types="expo/types" />
/// <reference types="expo-router/types" />

declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_API_URL: string;
    EXPO_PUBLIC_APP_VERSION?: string;
  }
}
