import React from 'react';
import { View } from 'react-native';

import { AppText } from './app-text';
import { fr } from '@/i18n/fr';
import type { Seat, SeatPresence } from '@/rooms/room-phase';
import { useTheme } from '@/theme';

export function presenceLabel(presence: SeatPresence): string | null {
  switch (presence) {
    case 'connected':
      return fr.lobby.connected;
    case 'away':
      return fr.lobby.away;
    case 'disconnected':
      return fr.lobby.disconnected;
    case 'unknown':
      return fr.lobby.unknown;
    default:
      return null;
  }
}

/** One seat at the table in the lobby: role, who sits there, and whether their phone is connected. */
export function SeatCard({ seat }: { seat: Seat }) {
  const theme = useTheme();
  const empty = seat.presence === 'empty';
  const dot =
    seat.presence === 'connected'
      ? theme.colors.answers.OUI.fill
      : seat.presence === 'away'
        ? theme.colors.answers.NON.fill
        : seat.presence === 'disconnected'
          ? theme.colors.danger
          : theme.colors.inkFaint;
  const label = presenceLabel(seat.presence);
  const who = empty ? fr.lobby.waitingFor(fr.roles[seat.role]) : seat.isMe ? `${seat.name ?? fr.lobby.you} (${fr.lobby.you})` : (seat.name ?? fr.table.player);

  return (
    <View
      testID={`lobby-seat-${seat.role}`}
      accessible
      accessibilityLabel={`${fr.roles[seat.role]}, ${who}${label ? `, ${label}` : ''}`}
      style={{
        flex: 1,
        minHeight: 112,
        borderRadius: theme.radius.card,
        borderWidth: 2,
        borderStyle: empty ? 'dashed' : 'solid',
        borderColor: empty ? theme.colors.line : seat.isMe ? theme.colors.brass : theme.colors.line,
        backgroundColor: empty ? 'transparent' : theme.colors.surface,
        padding: theme.space.md,
        gap: theme.space.xxs,
        justifyContent: 'space-between',
      }}
    >
      <AppText variant="small" weight="semibold" tone="soft">
        {fr.roles[seat.role]}
      </AppText>
      <AppText
        variant={empty ? 'body' : 'lead'}
        weight={empty ? 'regular' : 'bold'}
        tone={empty ? 'faint' : 'ink'}
        numberOfLines={2}
        testID={`lobby-seat-${seat.role}-name`}
      >
        {who}
      </AppText>
      {label ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.xs }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot }} />
          <AppText variant="micro" weight="semibold" tone="soft" testID={`lobby-seat-${seat.role}-presence`}>
            {label}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}
