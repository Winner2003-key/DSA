import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import {
  AppText,
  ErrorBanner,
  PathGraph,
  PrimaryButton,
  ResultHeader,
  Screen,
  SecondaryButton,
  SoundToggle,
  TopBar,
} from '@/components';
import { fr } from '@/i18n/fr';
import { getGameService } from '@/services';
import { toDsaError, type DsaError } from '@/services/errors';
import { cardDescription, type GameState, type RevealedPath } from '@/services/types';
import { useSpeech } from '@/speech/use-speech';
import { useTheme } from '@/theme';

export default function ResultatScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { speak } = useSpeech();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null;

  const [reveal, setReveal] = useState<RevealedPath | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<DsaError | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const service = getGameService();
    Promise.all([service.getRevealedPath(sessionId), service.getState(sessionId)])
      .then(([path, current]) => {
        if (cancelled) return;
        setReveal(path);
        setState(current);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(toDsaError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const discovered = reveal?.status === 'DISCOVERED';
  const secret = reveal?.secret ?? null;

  useEffect(() => {
    if (discovered && secret) speak(fr.spoken.discovered(secret.name));
  }, [discovered, secret, speak]);

  const graphName = useMemo(
    () => (secret && discovered ? { name: secret.name, description: cardDescription(secret) } : null),
    [discovered, secret],
  );

  if (!sessionId) {
    return (
      <Screen testID="screen-resultat">
        <TopBar onBack={() => router.replace('/')} backLabel={fr.app.home} />
        <ErrorBanner message={fr.errors.SESSION_NOT_FOUND} />
      </Screen>
    );
  }

  return (
    <Screen
      testID="screen-resultat"
      style={{ flex: 1, maxWidth: 1040 }}
      footer={
        <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
          <SecondaryButton
            testID="go-home"
            label={fr.result.home}
            onPress={() => router.replace('/')}
            style={{ flex: 1, width: undefined }}
          />
          <PrimaryButton
            testID="replay"
            label={fr.result.replay}
            disabled={!state}
            // A new game always goes through "Préparer la partie", with this game's mode ready.
            onPress={() => router.replace(state ? `/jouer?mode=${state.mode}` : '/jouer')}
            style={{ flex: 1.4, width: undefined }}
          />
        </View>
      }
    >
      <TopBar onBack={() => router.replace('/')} backLabel={fr.app.home} right={<SoundToggle />} />

      {error ? <ErrorBanner message={error.message} onDismiss={() => setError(null)} /> : null}

      {!reveal && !error ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.space.sm }}>
          <ActivityIndicator color={theme.colors.brass} />
          <AppText variant="body" tone="soft">
            {fr.app.loading}
          </AppText>
        </View>
      ) : null}

      {reveal ? (
        <View style={{ flex: 1, gap: theme.space.sm, paddingBottom: theme.space.sm }}>
          <ResultHeader reveal={reveal} />
          <AppText variant="small" tone="soft">
            {fr.result.pathIntro}
          </AppText>
          <PathGraph path={reveal.path} name={graphName} animate testID="result-graph" />
        </View>
      ) : null}
    </Screen>
  );
}
