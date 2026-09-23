import React, { useState } from 'react';
import { View } from 'react-native';

import { AppText, NoticeBanner, RoomCodeDisplay, RoomQr, SeatCard, SecondaryButton } from '@/components';
import { fr } from '@/i18n/fr';
import type { RoomView } from '@/rooms/room-phase';
import { shareRoom } from '@/rooms/share';
import { joinUrlFor } from '@/rooms/use-room';
import type { GameState } from '@/services/types';
import { useTheme } from '@/theme';
import { Share2, X } from '@/components';

export interface LobbyViewProps {
  state: GameState;
  room: RoomView;
  busy: boolean;
  onCancel: () => void;
  /** Set when this room is a rematch the other player turned down. */
  declinedBy?: string | null | undefined;
  /**
   * The next name in a room the pair already played in: the friend is on the
   * end screen and joins with one tap, so there is no code to hand out.
   */
  rematch?: { friendName: string | null } | null;
}

/**
 * The room before the second player arrives: the code, large, to say aloud; a
 * share button and a QR code; the two seats with each phone's presence; and a way
 * out. The joiner never sees this screen — joining starts the game.
 */
export function LobbyView({ state, room, busy, onCancel, declinedBy, rematch = null }: LobbyViewProps) {
  const theme = useTheme();
  const [notice, setNotice] = useState<string | null>(null);
  const code = state.room_code ?? '';
  const url = code ? joinUrlFor(code) : '';

  const share = async () => {
    const outcome = await shareRoom(code, url);
    setNotice(outcome === 'copied' ? fr.lobby.copied : null);
  };

  return (
    <View testID="lobby" style={{ gap: theme.space.lg }}>
      <View style={{ gap: theme.space.xxs }}>
        <AppText variant="display" weight="bold" tight>
          {rematch ? fr.rematch.waitingTitle(rematch.friendName) : fr.lobby.title}
        </AppText>
        <AppText variant="body" tone="soft">
          {rematch ? fr.rematch.waitingHint : fr.lobby.codeHint}
        </AppText>
      </View>

      {declinedBy !== undefined ? <NoticeBanner testID="rematch-declined" tone="warn" title={fr.lobby.declined(declinedBy)} /> : null}

      {code && !rematch ? (
        <View style={{ gap: theme.space.md }}>
          <RoomCodeDisplay code={code} />
          <SecondaryButton testID="lobby-share" icon={Share2} label={fr.lobby.share} onPress={() => void share()} />
          {notice ? (
            <AppText variant="small" tone="brass" testID="lobby-share-notice" style={{ textAlign: 'center' }}>
              {notice}
            </AppText>
          ) : null}
          <RoomQr code={code} url={url} />
        </View>
      ) : null}

      <View style={{ gap: theme.space.sm }}>
        <AppText variant="lead" weight="semibold" tone="soft">
          {fr.lobby.seatsTitle}
        </AppText>
        <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
          <SeatCard seat={room.seats.TIREUR} />
          <SeatCard seat={room.seats.DECOUVREUR} />
        </View>
        <AppText variant="small" tone="faint" testID="lobby-input-mode">
          {fr.lobby.inputMode} : {state.settings.input_mode === 'VOICE' ? fr.setup.voice : fr.setup.buttons}
        </AppText>
        {/* The creator chose for both players; the joiner reads it here. */}
        <AppText variant="small" tone="faint" testID="lobby-timer">
          {fr.lobby.timer} : {state.settings.timed ? fr.lobby.timerOn : fr.lobby.timerOff}
          {state.settings.timed && state.settings.think_seconds !== null && state.settings.play_seconds !== null
            ? ` · ${fr.setup.timerHint(fr.timer.duration(state.settings.think_seconds), fr.timer.duration(state.settings.play_seconds))}`
            : ''}
        </AppText>
        <AppText variant="small" tone="faint" testID="lobby-scope">
          {fr.lobby.scope} :{' '}
          {state.scope_labels.length === 0 ? fr.setup.scopeWhole : state.scope_labels.join(', ')}
        </AppText>
      </View>

      <SecondaryButton testID="lobby-cancel" icon={X} label={fr.lobby.cancel} disabled={busy} onPress={onCancel} />
    </View>
  );
}
