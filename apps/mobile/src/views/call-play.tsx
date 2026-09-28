import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import type { Role } from '@dsa/core';

import {
  AppText,
  Flag,
  Mic,
  MicOff,
  NoticeBanner,
  PrimaryButton,
  SecondaryButton,
  SecretCard,
  Sheet,
  X,
} from '@/components';
import { useCall } from '@/call';
import { fr } from '@/i18n/fr';
import { tapFeedback, warningFeedback } from '@/lib/haptics';
import { useSecret } from '@/state/use-secret';
import type { UseGame } from '@/state/use-game';
import { useTheme } from '@/theme';

export interface CallPlayProps {
  sessionId: string;
  game: UseGame;
}

/**
 * A room played with Voix, from the end of Tireur-ready to the end of the game:
 * the two players are on a live call, and the app is not listening to them
 * (GAME_RULES "Voix in a room is a call"). So this screen carries no question, no
 * answer pad and no microphone recording — only the state of the call, a mute
 * toggle, and, for the Tireur, the card and the two ways the game can end.
 *
 * There is no call countdown on purpose ("Call limits"): a banner and a haptic at
 * one minute and at thirty seconds, and nothing else. A timed game shows its own
 * timer in the header, as always.
 */
export function CallPlay({ sessionId, game }: CallPlayProps) {
  const theme = useTheme();
  const { state } = game;
  const myRole: Role = game.myRoles[0] ?? 'DECOUVREUR';
  const isTireur = myRole === 'TIREUR';
  const { secret } = useSecret(sessionId, isTireur);

  const [revealed, setRevealed] = useState(true);
  const [confirming, setConfirming] = useState<'FOUND' | 'NOT_FOUND' | null>(null);

  const other = state?.players.find((player) => !player.is_me && !player.is_ai) ?? null;
  const otherName = other?.display_name ?? fr.room.theOther(fr.roles[other?.role ?? (isTireur ? 'DECOUVREUR' : 'TIREUR')]);

  const playing = state?.status === 'PLAYING';
  const call = useCall({
    sessionId,
    endsAt: state?.call_ends_at ?? null,
    serverNow: state?.server_now ?? null,
    receivedAt: game.receivedAt,
    active: playing,
    onTimeUp: game.checkTime,
  });

  // The two warnings before the end of the call, each felt as well as read.
  const warned = useRef<number | null>(null);
  useEffect(() => {
    if (call.warning === null || warned.current === call.warning) return;
    warned.current = call.warning;
    warningFeedback();
  }, [call.warning]);

  // In a timed game the banner only appears if the call ends before the game does.
  const showWarning = useMemo(() => {
    if (call.warning === null) return false;
    if (!state?.timed || state.play_ends_at === null || state.call_ends_at === null) return true;
    return Date.parse(state.call_ends_at) < Date.parse(state.play_ends_at);
  }, [call.warning, state?.call_ends_at, state?.play_ends_at, state?.timed]);

  if (!state) return null;

  const stateLabel =
    call.state === 'connected'
      ? call.otherPresent
        ? fr.call.online
        : fr.call.waitingOther(otherName)
      : call.state === 'reconnecting'
        ? fr.call.reconnecting
        : call.state === 'failed'
          ? fr.call.failed
          : fr.call.connecting;

  const failure =
    call.error === null
      ? null
      : call.error.code === 'NEEDS_DEV_BUILD'
        ? fr.call.needsDevBuild
        : call.error.code === 'MIC_DENIED'
          ? fr.call.micDenied
          : (call.error.detail ?? fr.call.connectFailed);

  const declare = (found: boolean) => {
    setConfirming(null);
    void game.declareResult(found);
  };

  return (
    <View testID="call-play" style={{ gap: theme.space.md }}>
      {/* Who is on the line, and whether the line is up. */}
      <View
        testID="call-status"
        style={{
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.card,
          borderLeftWidth: 6,
          borderLeftColor: call.state === 'connected' ? theme.colors.brass : theme.colors.line,
          padding: theme.space.lg,
          gap: theme.space.xxs,
        }}
      >
        <AppText variant="lead" tone="soft">
          {fr.call.withPlayer(otherName, fr.roles[other?.role ?? (isTireur ? 'DECOUVREUR' : 'TIREUR')])}
        </AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>
          {call.state === 'connecting' || call.state === 'reconnecting' ? <ActivityIndicator color={theme.colors.brass} /> : null}
          <AppText variant="title" weight="bold" tight testID="call-state">
            {stateLabel}
          </AppText>
        </View>
        {/* Who is speaking right now, on each side. */}
        <View style={{ flexDirection: 'row', gap: theme.space.md }}>
          <AppText variant="small" tone={call.speaking.length > 0 ? 'brass' : 'faint'} testID="call-speaking-other">
            {`${otherName} : ${call.otherPresent && call.speaking.length > 0 ? fr.call.speaking : fr.call.quiet}`}
          </AppText>
        </View>
      </View>

      {failure ? (
        <NoticeBanner testID="call-failed" tone="warn" title={fr.call.failed} hint={failure}>
          <SecondaryButton testID="call-retry" icon={Mic} label={fr.call.retry} onPress={call.retry} />
        </NoticeBanner>
      ) : null}

      {call.audioBlocked ? (
        <NoticeBanner testID="call-sound-blocked" tone="warn" title={fr.call.soundBlocked}>
          <PrimaryButton testID="call-enable-sound" label={fr.call.enableSound} onPress={call.startAudio} />
        </NoticeBanner>
      ) : null}

      {showWarning ? (
        <NoticeBanner
          testID="call-ending-warning"
          tone="warn"
          title={fr.call.endsIn(call.warning === 60 ? fr.call.oneMinute : fr.call.thirtySeconds)}
        />
      ) : null}

      {/* The big toggle: the one control both players need during a call. */}
      <Pressable
        testID="call-mute"
        accessibilityRole="switch"
        accessibilityState={{ checked: !call.muted }}
        accessibilityLabel={call.muted ? fr.call.micMuted : fr.call.micOpen}
        disabled={call.state !== 'connected' && call.state !== 'reconnecting'}
        onPress={() => {
          tapFeedback();
          call.toggleMute();
        }}
        style={({ pressed }) => ({
          minHeight: theme.touch.primary,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: theme.space.sm,
          borderRadius: theme.radius.slab,
          borderWidth: 2,
          borderColor: call.muted ? theme.colors.danger : theme.colors.brass,
          backgroundColor: pressed ? theme.colors.surfaceRaised : 'transparent',
          paddingVertical: theme.space.md,
          opacity: call.state === 'connected' || call.state === 'reconnecting' ? 1 : 0.5,
        })}
      >
        {call.muted ? <MicOff size={28} color={theme.colors.danger} /> : <Mic size={28} color={theme.colors.brass} />}
        <AppText variant="title" weight="bold" tight>
          {call.muted ? fr.call.micMuted : fr.call.micOpen}
        </AppText>
      </Pressable>

      {isTireur ? (
        <>
          <SecretCard secret={secret} revealed={revealed} onToggle={() => setRevealed((r) => !r)} />
          <AppText variant="small" tone="soft" testID="call-tireur-hint">
            {fr.call.tireurHint}
          </AppText>
          {/* The Tireur ends the game: the app followed no question. */}
          <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
            <PrimaryButton
              testID="call-found"
              label={fr.call.found}
              disabled={game.busy}
              onPress={() => setConfirming('FOUND')}
              style={{ flex: 1.4, width: undefined }}
            />
            <SecondaryButton
              testID="call-not-found"
              label={fr.call.notFound}
              disabled={game.busy}
              onPress={() => setConfirming('NOT_FOUND')}
              style={{ flex: 1, width: undefined }}
            />
          </View>
        </>
      ) : (
        <View
          testID="call-decouvreur"
          style={{
            backgroundColor: theme.colors.surfaceRaised,
            borderRadius: theme.radius.card,
            padding: theme.space.lg,
          }}
        >
          <AppText variant="lead" weight="semibold">
            {fr.call.decouvreurHint}
          </AppText>
        </View>
      )}

      <SecondaryButton
        testID="call-quit"
        icon={Flag}
        label={fr.app.quit}
        disabled={game.busy}
        onPress={() => void game.abandon()}
      />

      {/* One tap to confirm, so neither ending happens by accident. */}
      <Sheet
        visible={confirming !== null}
        title={confirming === 'NOT_FOUND' ? fr.call.notFoundConfirm : fr.call.foundConfirm}
        hint={confirming === 'NOT_FOUND' ? fr.call.notFoundConfirmBody : fr.call.foundConfirmBody}
        onClose={() => setConfirming(null)}
        testID="call-declare-sheet"
      >
        <View style={{ gap: theme.space.sm }}>
          <PrimaryButton
            testID="call-declare-confirm"
            label={confirming === 'NOT_FOUND' ? fr.call.notFoundConfirmYes : fr.call.foundConfirmYes}
            disabled={game.busy}
            onPress={() => declare(confirming !== 'NOT_FOUND')}
          />
          <SecondaryButton testID="call-declare-cancel" icon={X} label={fr.app.cancel} onPress={() => setConfirming(null)} />
        </View>
      </Sheet>
    </View>
  );
}
