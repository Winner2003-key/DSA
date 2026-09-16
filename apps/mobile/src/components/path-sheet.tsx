import React from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from './app-text';
import { PathGraph } from './path-graph';
import { fr } from '@/i18n/fr';
import type { PathEntry } from '@/services/types';
import { useTheme } from '@/theme';

export interface PathSheetProps {
  visible: boolean;
  path: PathEntry[];
  onClose: () => void;
}

/**
 * "Voir le chemin" during play: the same graph as the result screen, drawn at once,
 * with only the answered steps — never the question being asked, never the name.
 */
export function PathSheet({ visible, path, onClose }: PathSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View
        testID="path-sheet"
        style={{
          flex: 1,
          backgroundColor: theme.colors.bg,
          paddingTop: insets.top + theme.space.sm,
          paddingBottom: Math.max(insets.bottom, theme.space.md),
          paddingHorizontal: theme.space.lg,
          gap: theme.space.sm,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <AppText variant="title" weight="bold" tight>
            {fr.conversation.pathTitle}
          </AppText>
          <Pressable
            testID="path-sheet-close"
            accessibilityRole="button"
            onPress={onClose}
            hitSlop={12}
            style={{ minHeight: theme.touch.icon, justifyContent: 'center', paddingHorizontal: theme.space.sm }}
          >
            <AppText variant="body" weight="semibold" tone="brass">
              {fr.app.close}
            </AppText>
          </Pressable>
        </View>
        {visible ? <PathGraph path={path} animate={false} testID="path-sheet-graph" /> : null}
      </View>
    </Modal>
  );
}
