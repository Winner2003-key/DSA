import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
// Subpath imports on purpose: the package barrel pulls in all ten weights
// (2.4 MB of TTF), and this app only ever draws four of them.
import { useFonts } from 'expo-font';
import { ZillaSlab_400Regular } from '@expo-google-fonts/zilla-slab/400Regular';
import { ZillaSlab_500Medium } from '@expo-google-fonts/zilla-slab/500Medium';
import { ZillaSlab_600SemiBold } from '@expo-google-fonts/zilla-slab/600SemiBold';
import { ZillaSlab_700Bold } from '@expo-google-fonts/zilla-slab/700Bold';

import { SpeechProvider } from '@/speech/use-speech';
import { ThemeProvider, lightPalette, useTheme } from '@/theme';

void SplashScreen.preventAutoHideAsync();

/** If the font server is slow or blocked, play anyway with the system serif. */
const FONT_TIMEOUT_MS = 4000;

export default function RootLayout() {
  const [loaded, error] = useFonts({
    ZillaSlab_400Regular,
    ZillaSlab_500Medium,
    ZillaSlab_600SemiBold,
    ZillaSlab_700Bold,
  });
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), FONT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  const ready = loaded || Boolean(error) || timedOut;

  const onLayout = useCallback(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: lightPalette.bg }}>
      <SafeAreaProvider>
        <ThemeProvider fontsReady={loaded}>
          <SpeechProvider>
            <Navigator onLayout={onLayout} />
          </SpeechProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Inside the providers so the navigator background follows the active theme. */
function Navigator({ onLayout }: { onLayout: () => void }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }} onLayout={onLayout}>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          contentStyle: { backgroundColor: theme.colors.bg },
        }}
      />
    </View>
  );
}
