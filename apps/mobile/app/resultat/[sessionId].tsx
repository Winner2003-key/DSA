import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { speakableName } from '@dsa/voice';

import {
  AppText,
  ChoiceCard,
  ErrorBanner,
  LinkButton,
  NoticeBanner,
  PathGraph,
  PrimaryButton,
  ResultHeader,
  Screen,
  SecondaryButton,
  Sheet,
  SoundToggle,
  TopBar,
} from '@/components';
import { fr } from '@/i18n/fr';
import { acceptRematch, declineRematch, parseRematchOffer, proposeRematch, roleOnAccept, type RematchOffer } from '@/rooms/rematch';
import { useRoom } from '@/rooms/use-room';
import { getGameService } from '@/services';
import { toDsaError, type DsaError } from '@/services/errors';
import { cardDescription, type GameState, type RevealedPath, type SolutionPath } from '@/services/types';
import { useSpeech } from '@/speech/use-speech';
import { useTheme } from '@/theme';
import { Check, House, RefreshCw, RotateCcw, X } from '@/components';

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
  const [replayOpen, setReplayOpen] = useState(false);
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

  // A room stays joined here, so "Rejouer" can reach the other phone.
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

  const replayRoom = async (swap: boolean) => {
    if (!sessionId || !me || starting) return;
    setStarting(true);
    setError(null);
    try {
      const next = await proposeRematch(getGameService(), room.handle, sessionId, swap, {
        role: me.role,
        name: me.display_name,
      });
      setReplayOpen(false);
      goToRoom(next.sessionId, `?revanche=${sessionId}&ancien=${state?.room_code ?? ''}`);
    } catch (caught) {
      setError(toDsaError(caught));
      setStarting(false);
    }
  };

  const accept = async () => {
    if (!offer || starting) return;
    setStarting(true);
    setError(null);
    try {
      const next = await acceptRematch(getGameService(), offer);
      goToRoom(next.sessionId);
    } catch (caught) {
      setError(toDsaError(caught));
      setStarting(false);
      setOffer(null);
    }
  };

  const decline = () => {
    if (!offer) return;
    void declineRematch(room.handle, offer, me?.display_name ?? null);
    setOffer(null);
  };

  if (!sessionId) {
    return (
      <Screen testID="screen-resultat">
        <TopBar onBack={() => router.replace('/')} backLabel={fr.app.home} />
        <ErrorBanner message={fr.errors.SESSION_NOT_FOUND} />
      </Screen>
    );
  }

  const myRoleLabel = me ? fr.roles[me.role] : '';
  const otherRoleLabel = me ? fr.roles[me.role === 'TIREUR' ? 'DECOUVREUR' : 'TIREUR'] : '';

  return (
    <Screen
      testID="screen-resultat"
      style={{ flex: 1, maxWidth: 1040 }}
      footer={
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
            onPress={() => {
              if (isRoom && me) setReplayOpen(true);
              // A new solo game always goes through "Préparer la partie", with this game's mode ready.
              else router.replace(state ? `/jouer?mode=${state.mode}` : '/jouer');
            }}
            style={{ flex: 1.4, width: undefined }}
          />
        </View>
      }
    >
      <TopBar onBack={() => router.replace('/')} backLabel={fr.app.home} right={<SoundToggle />} />

      {error ? <ErrorBanner message={error.message} onDismiss={() => setError(null)} /> : null}

      {offer && me ? (
        <View style={{ marginBottom: theme.space.sm }}>
          <NoticeBanner
            testID="rematch-offer"
            title={fr.rematch.offer(offer.fromName)}
            hint={
              offer.swap
                ? fr.rematch.offerSwap(fr.roles[roleOnAccept(offer)])
                : fr.rematch.offerSame(fr.roles[roleOnAccept(offer)])
            }
          >
            <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
              <SecondaryButton
                testID="rematch-decline"
                icon={X}
                label={fr.rematch.decline}
                disabled={starting}
                onPress={decline}
                style={{ flex: 1, width: undefined }}
              />
              <PrimaryButton
                testID="rematch-accept"
                icon={Check}
                label={fr.rematch.accept}
                disabled={starting}
                onPress={() => void accept()}
                style={{ flex: 1.4, width: undefined }}
              />
            </View>
          </NoticeBanner>
        </View>
      ) : null}

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

      <Sheet
        visible={replayOpen}
        title={fr.rematch.title}
        hint={fr.rematch.hint}
        onClose={() => setReplayOpen(false)}
        testID="rematch-sheet"
      >
        <View accessibilityRole="radiogroup" style={{ gap: theme.space.sm }}>
          <ChoiceCard
            testID="rematch-same"
            title={fr.rematch.same}
            hint={fr.rematch.sameHint(myRoleLabel)}
            selected={false}
            disabled={starting}
            onPress={() => void replayRoom(false)}
          />
          <ChoiceCard
            testID="rematch-swap"
            title={fr.rematch.swap}
            hint={fr.rematch.swapHint(otherRoleLabel)}
            selected={false}
            disabled={starting}
            onPress={() => void replayRoom(true)}
          />
          {starting ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space.sm }}>
              <ActivityIndicator color={theme.colors.brass} />
              <AppText variant="small" tone="soft">
                {fr.rematch.creating}
              </AppText>
            </View>
          ) : null}
          <LinkButton
            testID="rematch-solo"
            icon={RefreshCw}
            label={fr.rematch.newGame}
            onPress={() => {
              setReplayOpen(false);
              router.replace('/jouer');
            }}
          />
        </View>
      </Sheet>
    </Screen>
  );
}
