import React, { useCallback, useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AppText, ErrorBanner, OfflineBadge, Screen, SoundToggle, TopBar } from '@/components';
import { fr } from '@/i18n/fr';
import { OFFLINE_ENABLED } from '@/services';
import { useGame, type TablePhase } from '@/state/use-game';
import { useTheme } from '@/theme';
import { GameTable } from '@/views/game-table';
import { RoomTable } from '@/views/room-table';

export default function PartieScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string; revanche?: string; ancien?: string }>();
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null;
  const rematchOf =
    typeof params.revanche === 'string' && typeof params.ancien === 'string'
      ? { sessionId: params.revanche, roomCode: params.ancien }
      : null;

  const game = useGame(sessionId);
  const { state, loading, error, phase } = game;

  // DISCOVERED or ABANDONED — on either device of a room — goes to the result.
  // A room that ends before anyone played (cancelled in the lobby, or closed as
  // stale) goes home instead: there is no path to show, and no card to reveal.
  const previousPhase = useRef<TablePhase | null>(null);
  useEffect(() => {
    const before = previousPhase.current;
    previousPhase.current = phase;
    if (phase !== 'ENDED' || !sessionId) return;
    router.replace(before === 'LOBBY' ? '/' : `/resultat/${sessionId}`);
  }, [phase, router, sessionId]);

  const quit = useCallback(async () => {
    if (!sessionId) return;
    const inLobby = game.phase === 'LOBBY';
    await game.abandon();
    router.replace(inLobby ? '/' : `/resultat/${sessionId}`);
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

  const isRoom = state.mode === 'HUMAN_VS_HUMAN';

  return (
    <Screen scroll testID="screen-partie">
      <TopBar
        onBack={() => void quit()}
        backLabel={phase === 'LOBBY' ? fr.lobby.cancel : fr.app.quit}
        right={<SoundToggle />}
      />
      <View style={{ paddingBottom: theme.space.xxl, gap: theme.space.sm }}>
        {OFFLINE_ENABLED ? <OfflineBadge /> : null}
        {isRoom ? (
          <>
            {phase === 'LOBBY' && game.error ? <ErrorBanner message={game.error.message} onDismiss={game.clearError} /> : null}
            <RoomTable sessionId={sessionId} game={game} rematchOf={rematchOf} onCancelled={() => router.replace('/')} />
          </>
        ) : (
          <GameTable sessionId={sessionId} game={game} />
        )}
      </View>
    </Screen>
  );
}
