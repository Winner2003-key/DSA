import React, { useState } from 'react';
import { View } from 'react-native';
import type { Role } from '@dsa/core';

import { ErrorBanner, GameHeader, PassPhone } from '@/components';
import type { UseGame } from '@/state/use-game';
import { useTheme } from '@/theme';
import { DecouvreurView } from './decouvreur-view';
import { DecouvreurWaitingView } from './decouvreur-waiting-view';
import { TireurReadyView } from './tireur-ready-view';
import { TireurView } from './tireur-view';

export interface GameTableProps {
  sessionId: string;
  game: UseGame;
}

/**
 * One game on this device: the table header, then the view of whoever holds the
 * phone. In LOCAL the phone goes to the Tireur first (the preparation phase, with
 * the thinking time of a timed game), then to the Découvreur for the first
 * question, then back and forth with each turn — and nothing of either view is
 * rendered while it is being handed over.
 */
export function GameTable({ sessionId, game }: GameTableProps) {
  const theme = useTheme();
  const { state } = game;
  const [handedTo, setHandedTo] = useState<Role | null>(null);
  if (!state) return null;

  const isLocal = state.mode === 'LOCAL';
  const readyPhase = game.phase === 'TIREUR_READY';
  // Who must be holding the phone right now.
  const holder: Role | null = isLocal ? (readyPhase ? 'TIREUR' : game.activeRole) : null;
  const mustHandOver = isLocal && holder !== null && handedTo !== holder;
  // A room device only ever renders its own role's view.
  const viewRole: Role = isLocal ? (holder ?? 'DECOUVREUR') : (game.myRoles[0] ?? 'DECOUVREUR');

  let content: React.ReactNode = null;
  if (!mustHandOver) {
    if (readyPhase && viewRole === 'TIREUR') content = <TireurReadyView sessionId={sessionId} game={game} />;
    // A room's Découvreur waits on their own phone while the Tireur looks at the card.
    else if (readyPhase) content = <DecouvreurWaitingView game={game} />;
    else if (viewRole === 'TIREUR') content = <TireurView sessionId={sessionId} game={game} />;
    else content = <DecouvreurView game={game} />;
  }

  return (
    <View style={{ gap: theme.space.md }}>
      <GameHeader game={game} viewRole={viewRole} />
      {game.error ? <ErrorBanner message={game.error.message} onDismiss={game.clearError} /> : null}
      {content}
      <PassPhone visible={mustHandOver} to={holder ?? 'DECOUVREUR'} onReady={() => setHandedTo(holder)} />
    </View>
  );
}
