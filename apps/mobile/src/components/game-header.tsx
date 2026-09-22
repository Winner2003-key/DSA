import React from 'react';
import { View } from 'react-native';
import type { Role } from '@dsa/core';

import { AppText } from './app-text';
import { CountdownRing } from './countdown-ring';
import { fr } from '@/i18n/fr';
import type { UseGame } from '@/state/use-game';
import { useTheme } from '@/theme';

export interface GameHeaderProps {
  game: UseGame;
  /** The seat this screen belongs to right now (LOCAL changes it with the phone). */
  viewRole: Role;
}

/** Whose move it is, as the table sees it. */
export function turnOf(game: UseGame): Role | null {
  const { state } = game;
  if (!state || state.status !== 'PLAYING') return null;
  if (game.phase === 'TIREUR_READY') return 'TIREUR';
  if (game.outgoing) return 'TIREUR';
  return game.activeRole;
}

/**
 * The game table seen from above: the two seats, whose turn it is, and how far
 * the game has gone. In a timed game the middle column is the countdown ring
 * (GRAPH_SPECIFICATION §9); in an untimed one it is just the question counter,
 * exactly as before.
 */
export function GameHeader({ game, viewRole }: GameHeaderProps) {
  const theme = useTheme();
  const { state } = game;
  if (!state) return null;

  const turn = turnOf(game);
  const mine = turn !== null && (game.isLocal ? turn === viewRole : game.myRoles.includes(turn));
  const turnText =
    turn === null ? null : mine ? fr.table.yourTurn : turn === 'TIREUR' ? fr.table.tireurThinking : fr.table.decouvreurThinking;

  const answered = state.path.length;
  const counter =
    state.status === 'PLAYING' && (state.prompt !== null || game.outgoing?.kind === 'ASK')
      ? fr.table.questionNumber(answered + 1)
      : fr.table.questionsAsked(answered);

  const occupant = (role: Role): string | null => {
    const player = state.players.find((p) => p.role === role);
    if (!player) return null;
    if (player.is_ai) return fr.table.ai;
    if (game.isLocal) return null;
    if (player.is_me) return fr.table.you;
    return player.display_name ?? fr.table.player;
  };

  const seat = (role: Role) => {
    const active = turn === role;
    const who = occupant(role);
    return (
      <View
        testID={`seat-${role}`}
        accessibilityLabel={`${fr.roles[role]}${who ? `, ${who}` : ''}${active ? `, ${turnText ?? ''}` : ''}`}
        style={{
          flex: 1,
          minHeight: theme.touch.icon,
          borderRadius: theme.radius.field,
          borderWidth: 2,
          borderColor: active ? theme.colors.brass : theme.colors.line,
          backgroundColor: active ? theme.colors.surfaceRaised : 'transparent',
          paddingHorizontal: theme.space.sm,
          paddingVertical: theme.space.xs,
          alignItems: role === 'TIREUR' ? 'flex-start' : 'flex-end',
          justifyContent: 'center',
        }}
      >
        <AppText variant="small" weight={active ? 'bold' : 'semibold'} tone={active ? 'ink' : 'soft'} numberOfLines={1}>
          {fr.roles[role]}
        </AppText>
        {who ? (
          <AppText variant="micro" weight="semibold" tone={active ? 'brass' : 'faint'} numberOfLines={1}>
            {who}
          </AppText>
        ) : null}
      </View>
    );
  };

  return (
    <View testID="game-header" style={{ gap: theme.space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: theme.space.xs }}>
        {seat('TIREUR')}
        <View style={{ minWidth: 88, alignItems: 'center', justifyContent: 'center', gap: theme.space.xxs }}>
          <View testID="timer-slot">
            {/* The ring shows only during play: the thinking time has its own,
                larger ring on the preparation views. */}
            {game.phase === 'PLAYING' ? <CountdownRing countdown={game.countdown} size="sm" /> : null}
          </View>
          <AppText variant="micro" weight="semibold" tone="soft" testID="question-counter">
            {counter}
          </AppText>
        </View>
        {seat('DECOUVREUR')}
      </View>
      {turnText ? (
        <View
          testID="turn-indicator"
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space.xs }}
        >
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: mine ? theme.colors.brass : theme.colors.inkFaint,
            }}
          />
          <AppText variant="lead" weight="semibold" style={{ color: mine ? theme.colors.brass : theme.colors.inkSoft }}>
            {turnText}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}
