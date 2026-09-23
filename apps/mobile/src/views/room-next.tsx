import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import type { Role } from '@dsa/core';

import { AppText, LinkButton, NoticeBanner, PrimaryButton, SecondaryButton } from '@/components';
import { fr } from '@/i18n/fr';
import { roleOnAccept, type RematchOffer } from '@/rooms/rematch';
import { useTheme } from '@/theme';
import { ArrowLeftRight, House, SkipForward } from '@/components';

export interface RoomNextProps {
  myRole: Role;
  /** The other phone already moved on to the next name. */
  offer: RematchOffer | null;
  starting: boolean;
  /** "Nom suivant" (swap false) or "Changer de rôle" (swap true). */
  onNext: (swap: boolean) => void;
  onHome: () => void;
}

const otherRole = (role: Role): Role => (role === 'TIREUR' ? 'DECOUVREUR' : 'TIREUR');

/**
 * The end of a game in a room: the pair goes on to the next name, with the same
 * settings, without making a new room. Roles can only change here, between two
 * names, never during one.
 *
 * Once the other phone has moved on, the one button joins that game with the
 * roles it chose: calling `dsa_rematch` again always lands in the same room.
 */
export function RoomNext({ myRole, offer, starting, onNext, onHome }: RoomNextProps) {
  const theme = useTheme();

  return (
    <View testID="room-next" style={{ gap: theme.space.sm }}>
      {offer ? (
        <NoticeBanner
          testID="rematch-offer"
          title={fr.rematch.offer(offer.fromName)}
          hint={
            offer.swap
              ? fr.rematch.offerSwap(fr.roles[roleOnAccept(offer)])
              : fr.rematch.offerSame(fr.roles[roleOnAccept(offer)])
          }
        />
      ) : null}

      {starting ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space.sm }}>
          <ActivityIndicator color={theme.colors.brass} />
          <AppText variant="small" tone="soft">
            {fr.rematch.starting}
          </AppText>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
        <SecondaryButton
          testID="go-home"
          icon={House}
          label={fr.result.home}
          onPress={onHome}
          style={{ flex: 1, width: undefined }}
        />
        <PrimaryButton
          testID="room-next-name"
          icon={SkipForward}
          label={offer ? fr.rematch.join : fr.rematch.next}
          hint={offer ? undefined : fr.rematch.nextHint}
          disabled={starting}
          onPress={() => onNext(false)}
          style={{ flex: 1.4, width: undefined }}
        />
      </View>

      {/* Once the friend has chosen the roles, there is nothing left to choose. */}
      {offer ? null : (
        <LinkButton
          testID="room-next-swap"
          icon={ArrowLeftRight}
          label={fr.rematch.swap(fr.roles[otherRole(myRole)])}
          disabled={starting}
          onPress={() => onNext(true)}
        />
      )}
    </View>
  );
}
