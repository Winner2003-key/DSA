import React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AppText } from '@/components';
import { fr } from '@/i18n/fr';
import { useTheme } from '@/theme';

/**
 * A room's Découvreur while the Tireur looks at the card (`TIREUR_READY`). Nothing
 * about the card is known on this device; the §9 thinking-time countdown will be
 * shown here too.
 */
export function DecouvreurWaitingView() {
  const theme = useTheme();
  return (
    <View
      testID="decouvreur-waiting-tireur"
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.card,
        padding: theme.space.xl,
        gap: theme.space.md,
        alignItems: 'center',
      }}
    >
      <View testID="think-timer-slot" />
      <ActivityIndicator size="large" color={theme.colors.brass} />
      <AppText variant="title" weight="bold" tight style={{ textAlign: 'center' }}>
        {fr.room.tireurLooking}
      </AppText>
      <AppText variant="body" tone="soft" style={{ textAlign: 'center' }}>
        {fr.room.tireurLookingHint}
      </AppText>
    </View>
  );
}
