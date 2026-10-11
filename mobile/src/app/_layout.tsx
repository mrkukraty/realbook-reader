import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { useSettings } from '@/state/settings-store';
import { useLibrary } from '@/state/library-store';
import { useAccount } from '@/state/account-store';
import { useAppTheme } from '@/components/ui';

void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const loadSettings = useSettings((s) => s.load);
  const settingsLoaded = useSettings((s) => s.loaded);
  const loadLibrary = useLibrary((s) => s.load);
  const t = useAppTheme();

  useEffect(() => {
    void loadSettings();
    void loadLibrary().then(() => useAccount.getState().init());
  }, [loadSettings, loadLibrary]);
  useEffect(() => {
    if (settingsLoaded) void SplashScreen.hideAsync().catch(() => {});
  }, [settingsLoaded]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.chrome }}>
      <SafeAreaProvider>
        <StatusBar style={t.dark ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: t.chrome },
            headerTintColor: t.chromeText,
            headerTitleStyle: { color: t.chromeText },
            contentStyle: { backgroundColor: t.chrome },
            headerShadowVisible: false,
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Library' }} />
          <Stack.Screen name="book/[id]" options={{ title: 'Book details' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          <Stack.Screen name="account" options={{ title: 'Account' }} />
          <Stack.Screen name="reader/[id]" options={{ headerShown: false, animation: 'fade' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
