import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { NoticeBanner, PrimaryButton, SecondaryButton } from '@/components';
import { fr } from '@/i18n/fr';
import { parseRematchDeclined } from '@/rooms/rematch';
import { describeRoom, OTHER_GONE_GRACE_MS, trackAbsence } from '@/rooms/room-phase';
import { useRoom } from '@/rooms/use-room';
import type { UseGame } from '@/state/use-game';
import { useTheme } from '@/theme';
import { GameTable } from './game-table';
import { LobbyView } from './lobby-view';
import { Clock, Flag } from '@/components';

export interface RoomTableProps {
  sessionId: string;
  game: UseGame;
  /** The lobby's "Annuler la partie" went through. */
  onCancelled: () => void;
  /** This room is the next name of another one: listen there for a refusal. */
  rematchOf?: { sessionId: string; roomCode: string; friendName?: string | null } | null;
  /** Injected in tests. */
  graceMs?: number;
}

/**
 * A HUMAN_VS_HUMAN game on one of its two devices: the lobby until the second
 * player joins, then the table (the Tireur-ready phase first). Above it, what the
 * room knows that the game state doesn't: this phone's connection, and whether the
 * other phone is still there.
 */
export function RoomTable({ sessionId, game, onCancelled, rematchOf = null, graceMs = OTHER_GONE_GRACE_MS }: RoomTableProps) {
  const theme = useTheme();
  const { state } = game;
  const me = state?.players.find((p) => p.is_me && !p.is_ai) ?? null;
  const room = useRoom(state?.room_code ?? null, me ? { role: me.role, name: me.display_name } : null);

  const [declinedBy, setDeclinedBy] = useState<string | null | undefined>(undefined);
  useRoom(rematchOf?.roomCode ?? null, null, {
    onBroadcast: (event, payload) => {
      if (event !== 'rematch_declined' || !rematchOf) return;
      const declined = parseRematchDeclined(payload, rematchOf.sessionId, sessionId);
      if (declined) setDeclinedBy(declined.fromName);
    },
  });

  const [absentSince, setAbsentSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [waitingSince, setWaitingSince] = useState<number | null>(null);

  const view = useMemo(
    () =>
      state
        ? describeRoom({
            state,
            presence: room.presence,
            presenceReady: room.status === 'SUBSCRIBED',
            otherAbsentSince: absentSince,
            now,
            graceMs,
          })
        : null,
    [absentSince, graceMs, now, room.presence, room.status, state],
  );

  const otherPresence = view?.otherRole ? view.seats[view.otherRole].presence : 'empty';
  useEffect(() => {
    setAbsentSince((since) => trackAbsence(since, otherPresence, Date.now()));
  }, [otherPresence]);

  // Re-evaluate once the grace period has passed.
  useEffect(() => {
    if (absentSince === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, absentSince + graceMs - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [absentSince, graceMs]);

  if (!state || !view) return null;

  const otherSeat = view.otherRole ? view.seats[view.otherRole] : null;
  const otherName = otherSeat?.name ?? (view.otherRole ? fr.room.theOther(fr.roles[view.otherRole]) : '');
  const showGone = view.otherGone && waitingSince !== absentSince;
  const showAway = !showGone && view.phase !== 'LOBBY' && otherSeat?.presence === 'away';

  const banners = (
    <>
      {game.connectionLost ? (
        <NoticeBanner testID="connection-lost" busy title={fr.room.connectionLost} hint={fr.room.connectionLostHint} />
      ) : null}
      {showGone ? (
        <NoticeBanner testID="other-gone" tone="warn" title={fr.room.otherGone(otherName)} hint={fr.room.otherGoneHint}>
          <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
            <SecondaryButton
              testID="other-gone-wait"
              icon={Clock}
              label={fr.room.wait}
              onPress={() => setWaitingSince(absentSince)}
              style={{ flex: 1, width: undefined }}
            />
            <PrimaryButton
              testID="other-gone-abandon"
              icon={Flag}
              label={fr.room.abandon}
              disabled={game.busy}
              onPress={() => void game.abandon()}
              style={{ flex: 1, width: undefined }}
            />
          </View>
        </NoticeBanner>
      ) : null}
      {showAway ? <NoticeBanner testID="other-away" title={fr.room.otherAway(otherName)} /> : null}
    </>
  );

  if (view.phase === 'LOBBY') {
    return (
      <View style={{ gap: theme.space.md }}>
        {banners}
        <LobbyView
          state={state}
          room={view}
          busy={game.busy}
          declinedBy={declinedBy}
          rematch={rematchOf ? { friendName: rematchOf.friendName ?? null } : null}
          onCancel={() => {
            void game.abandon().then(onCancelled);
          }}
        />
      </View>
    );
  }

  return (
    <View style={{ gap: theme.space.md }}>
      {banners}
      <GameTable sessionId={sessionId} game={game} />
    </View>
  );
}
