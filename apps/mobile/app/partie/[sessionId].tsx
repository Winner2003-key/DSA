import React, { useCallback, useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppText, ErrorBanner, OfflineBadge, Screen, SoundToggle, TopBar } from '@/components';
import { fr } from '@/i18n/fr';
import { OFFLINE_ENABLED } from '@/services';
import { useGame } from '@/state/use-game';
import { useTheme } from '@/theme';
import { GameTable } from '@/views/game-table';

export default function PartieScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null;

  const game = useGame(sessionId);
  const { state, loading, error } = game;

  useEffect(() => {
    if (state && state.status !== 'PLAYING' && sessionId) {
      router.replace(`/resultat/${sessionId}`);
    }
  }, [router, sessionId, state]);

  const quit = useCallback(async () => {
    if (!sessionId) return;
    await game.abandon();
    router.replace(`/resultat/${sessionId}`);
  }, [game, router, sessionId]);

  if (!sessionId) {
    return (
      <Screen testID="screen-partie">
        <TopBar onBack={() => router.replace('/')} backLabel={fr.app.home} />
        <ErrorBanner message={fr.errors.SESSION_NOT_FOUND} />
      </Screen>
    );
  }

  if (loading && !state) {
    return (
      <Screen testID="screen-partie">
        <TopBar onBack={() => router.replace('/')} backLabel={fr.app.home} right={<SoundToggle />} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.space.sm }}>
          <ActivityIndicator color={theme.colors.brass} />
          <AppText variant="body" tone="soft">
            {fr.app.loading}
          </AppText>
        </View>
      </Screen>
    );
  }

  if (!state) {
    return (
      <Screen testID="screen-partie">
        <TopBar onBack={() => router.replace('/')} backLabel={fr.app.home} right={<SoundToggle />} />
        <ErrorBanner message={error?.message ?? fr.errors.SESSION_NOT_FOUND} />
      </Screen>
    );
  }

  return (
    <Screen scroll testID="screen-partie">
      <TopBar onBack={() => void quit()} backLabel={fr.app.quit} right={<SoundToggle />} />
      <View style={{ paddingBottom: theme.space.xxl, gap: theme.space.sm }}>
        {OFFLINE_ENABLED ? <OfflineBadge /> : null}
        <GameTable sessionId={sessionId} game={game} />
      </View>
    </Screen>
  );
}
