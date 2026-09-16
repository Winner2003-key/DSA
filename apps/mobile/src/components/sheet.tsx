import React from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';

import { AppText } from './app-text';
import { fr } from '@/i18n/fr';
import { useTheme } from '@/theme';

export interface SheetProps {
  visible: boolean;
  title: string;
  hint?: string;
  onClose: () => void;
  children: React.ReactNode;
  testID?: string;
}

/** A panel that rises from the bottom for the two secondary Découvreur actions. */
export function Sheet({ visible, title, hint, onClose, children, testID }: SheetProps) {
  const theme = useTheme();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: theme.colors.overlay }}
      >
        <Pressable accessibilityLabel={fr.app.close} onPress={onClose} style={{ flex: 1 }} />
        <View
          testID={testID}
          style={{
            width: '100%',
            maxWidth: theme.maxContentWidth,
            alignSelf: 'center',
            backgroundColor: theme.colors.bg,
            borderTopLeftRadius: theme.radius.card,
            borderTopRightRadius: theme.radius.card,
            borderTopWidth: 1,
            borderColor: theme.colors.line,
            padding: theme.space.lg,
            paddingBottom: theme.space.xxl,
            gap: theme.space.sm,
            maxHeight: '86%',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: theme.space.sm }}>
              <AppText variant="title" weight="bold" tight>
                {title}
              </AppText>
              {hint ? (
                <AppText variant="small" tone="soft">
                  {hint}
                </AppText>
              ) : null}
            </View>
            <Pressable
              testID="sheet-close"
              accessibilityRole="button"
              accessibilityLabel={fr.app.close}
              onPress={onClose}
              hitSlop={12}
              style={{ minHeight: theme.touch.icon, justifyContent: 'center' }}
            >
              <AppText variant="body" weight="semibold" tone="brass">
                {fr.app.close}
              </AppText>
            </Pressable>
          </View>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
