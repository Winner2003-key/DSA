import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { speakableName } from '@dsa/voice';

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
import { acceptRematch, declineRematch, parseRematchOffer, proposeRematch, type RematchOffer } from '@/rooms/rematch';
import { useRoom } from '@/rooms/use-room';
import { getGameService } from '@/services';
import { toDsaError, type DsaError } from '@/services/errors';
import { cardDescription, type GameState, type RevealedPath, type SolutionPath } from '@/services/types';
import { useSpeech } from '@/speech/use-speech';
import { useTheme } from '@/theme';
import { House, RotateCcw } from '@/components';
import { RoomNext } from '@/views/room-next';

export default function ResultatScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { speak } = useSpeech();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null;

  const [reveal, setReveal] = useState<RevealedPath | null>(null);
  const [solution, setSolution] = useState<SolutionPath | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<DsaError | null>(null);
  const [starting, setStarting] = useState(false);
  const [offer, setOffer] = useState<RematchOffer | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const service = getGameService();
    Promise.all([
      service.getRevealedPath(sessionId),
      service.getState(sessionId),
      // The book's path is the point of this screen, but a server that predates
      // 06_timer.sql has no such RPC: the game card still shows without it.
      service.getSolutionPath(sessionId).catch(() => null),
    ])
      .then(([path, current, book]) => {
        if (cancelled) return;
        setReveal(path);
        setState(current);
        setSolution(book);
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
    if (discovered && secret) speak(fr.spoken.discovered(speakableName(secret.name)));
  }, [discovered, secret, speak]);

  // The book's path always ends on the name, whatever happened in the game.
  const graphName = useMemo(
    () => (secret ? { name: secret.name, description: cardDescription(secret) } : null),
    [secret],
  );

  // A room stays joined here, so "Nom suivant" can reach the other phone.
  const isRoom = state?.mode === 'HUMAN_VS_HUMAN';
  const me = isRoom ? (state?.players.find((p) => p.is_me && !p.is_ai) ?? null) : null;
  const room = useRoom(isRoom ? (state?.room_code ?? null) : null, me ? { role: me.role, name: me.display_name } : null, {
    onBroadcast: (event, payload) => {
      if (event !== 'rematch' || !sessionId) return;
      const parsed = parseRematchOffer(payload, sessionId);
      if (parsed) setOffer(parsed);
    },
  });

  const goToRoom = useCallback(
    (id: string, query = '') => {
      router.replace(`/partie/${id}${query}`);
    },
    [router],
  );

  /**
   * "Nom suivant" / "Changer de rôle": the first phone makes the next game (same
   * settings) and waits for the other; once the other phone has moved on, the
   * same button joins it with the roles it chose.
   */
  const nextName = async (swap: boolean) => {
    if (!sessionId || !me || starting) return;
    setStarting(true);
    setError(null);
    try {
      if (offer) {
        const next = await acceptRematch(getGameService(), offer);
        goToRoom(next.sessionId);
        return;
      }
      const next = await proposeRematch(getGameService(), room.handle, sessionId, swap, {
        role: me.role,
        name: me.display_name,
      });
      const other = state?.players.find((p) => !p.is_me)?.display_name ?? '';
      goToRoom(next.sessionId, `?revanche=${sessionId}&ancien=${state?.room_code ?? ''}&ami=${encodeURIComponent(other)}`);
    } catch (caught) {
      setError(toDsaError(caught));
      setStarting(false);
      setOffer(null);
    }
  };

  /** Leaving while the other phone waits for us: tell it, so it is not left hanging. */
  const goHome = () => {
    if (offer) void declineRematch(room.handle, offer, me?.display_name ?? null);
    router.replace('/');
  };

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
        isRoom && me ? (
          <RoomNext myRole={me.role} offer={offer} starting={starting} onNext={(swap) => void nextName(swap)} onHome={goHome} />
        ) : (
          <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
            <SecondaryButton
              testID="go-home"
              icon={House}
              label={fr.result.home}
              onPress={() => router.replace('/')}
              style={{ flex: 1, width: undefined }}
            />
            <PrimaryButton
              testID="replay"
              icon={RotateCcw}
              label={fr.result.replay}
              disabled={!state || starting}
              // A new solo game always goes through "Préparer la partie", with this game's mode ready.
              onPress={() => router.replace(state ? `/jouer?mode=${state.mode}` : '/jouer')}
              style={{ flex: 1.4, width: undefined }}
            />
          </View>
        )
      }
    >
      <TopBar onBack={() => router.replace('/')} backLabel={fr.app.home} right={<SoundToggle />} />

      {error ? <ErrorBanner message={error.message} onDismiss={() => setError(null)} /> : null}

      {!reveal && !error ? (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: theme.space.sm,
          }}
        >
          <ActivityIndicator color={theme.colors.brass} />
          <AppText variant="body" tone="soft">
            {fr.app.loading}
          </AppText>
        </View>
      ) : null}

      {reveal ? (
        <View
          style={{
            flex: 1,
            gap: theme.space.sm,
            paddingBottom: theme.space.sm,
          }}
        >
          <ResultHeader reveal={reveal} />
          {/* Then the book's own way to that name — not the players' detours.
              Whatever the outcome, this is what the end screen teaches (§9). */}
          {solution && secret ? (
            <>
              <AppText variant="lead" weight="semibold" testID="solution-title">
                {fr.result.solutionIntro(secret.name)}
              </AppText>
              <AppText variant="small" tone="soft">
                {fr.result.solutionHint}
              </AppText>
              <PathGraph path={solution.path} name={graphName} animate testID="result-graph" />
            </>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
