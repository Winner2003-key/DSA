import React, { useState } from 'react';
import { View } from 'react-native';

import { AppText, NoticeBanner, RoomCodeDisplay, RoomQr, SeatCard, SecondaryButton } from '@/components';
import { fr } from '@/i18n/fr';
import type { RoomView } from '@/rooms/room-phase';
import { shareRoom } from '@/rooms/share';
import { joinUrlFor } from '@/rooms/use-room';
import type { GameState } from '@/services/types';
import { useTheme } from '@/theme';

export interface LobbyViewProps {
  state: GameState;
  room: RoomView;
  busy: boolean;
  onCancel: () => void;
  /** Set when this room is a rematch the other player turned down. */
  declinedBy?: string | null | undefined;
}

/**
 * The room before the second player arrives: the code, large, to say aloud; a
 * share button and a QR code; the two seats with each phone's presence; and a way
 * out. The joiner never sees this screen — joining starts the game.
 */
export function LobbyView({ state, room, busy, onCancel, declinedBy }: LobbyViewProps) {
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
          {fr.lobby.title}
        </AppText>
        <AppText variant="body" tone="soft">
          {fr.lobby.codeHint}
        </AppText>
      </View>

      {declinedBy !== undefined ? <NoticeBanner testID="rematch-declined" tone="warn" title={fr.lobby.declined(declinedBy)} /> : null}

      {code ? (
        <View style={{ gap: theme.space.md }}>
          <RoomCodeDisplay code={code} />
          <SecondaryButton testID="lobby-share" label={fr.lobby.share} onPress={() => void share()} />
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
      </View>

      <SecondaryButton testID="lobby-cancel" label={fr.lobby.cancel} disabled={busy} onPress={onCancel} />
    </View>
  );
}
