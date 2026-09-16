import React from 'react';
import { Modal, View } from 'react-native';
import type { Role } from '@dsa/core';

import { AppText } from './app-text';
import { PrimaryButton } from './buttons';
import { fr } from '@/i18n/fr';
import { useTheme } from '@/theme';

export interface PassPhoneProps {
  visible: boolean;
  /** Who should be holding the phone next. */
  to: Role;
  onReady: () => void;
}

/**
 * LOCAL mode is one phone and two people, so the screen has to be blanked between
 * turns — otherwise the Découvreur sees the card. Full-bleed and unmissable.
 */
export function PassPhone({ visible, to, onReady }: PassPhoneProps) {
  const theme = useTheme();
  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onReady} transparent={false}>
      <View
        testID={`pass-phone-${to}`}
        style={{
          flex: 1,
          backgroundColor: theme.colors.bg,
          justifyContent: 'center',
          padding: theme.space.xl,
          gap: theme.space.md,
        }}
      >
        <View style={{ width: '100%', maxWidth: theme.maxContentWidth, alignSelf: 'center', gap: theme.space.sm }}>
          <AppText variant="lead" tone="soft">
            {fr.pass.title}
          </AppText>
          <AppText variant="hero" weight="bold" tight>
            {to === 'TIREUR' ? fr.pass.toTireur : fr.pass.toDecouvreur}
          </AppText>
          <AppText variant="body" tone="soft" style={{ marginBottom: theme.space.lg }}>
            {to === 'TIREUR' ? fr.pass.hintTireur : fr.pass.hintDecouvreur}
          </AppText>
          <PrimaryButton
            testID="pass-ready"
            label={to === 'TIREUR' ? fr.pass.readyTireur : fr.pass.readyDecouvreur}
            onPress={onReady}
          />
        </View>
      </View>
    </Modal>
  );
}
