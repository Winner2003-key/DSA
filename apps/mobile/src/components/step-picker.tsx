import React from 'react';
import { ScrollView } from 'react-native';

import { PathTrail } from './path-trail';
import { Sheet } from './sheet';
import { fr } from '@/i18n/fr';
import type { PathEntry } from '@/services/types';

export interface StepPickerProps {
  visible: boolean;
  path: PathEntry[];
  onClose: () => void;
  onSelect: (stepIndex: number) => void;
}

/** "Revenir à une question": pick a step from the path already taken. */
export function StepPicker({ visible, path, onClose, onSelect }: StepPickerProps) {
  return (
    <Sheet
      visible={visible}
      title={fr.game.goBackTitle}
      hint={fr.game.goBackHint}
      onClose={onClose}
      testID="step-picker"
    >
      <ScrollView style={{ maxHeight: 420 }}>
        <PathTrail path={path} onSelect={onSelect} reverse />
      </ScrollView>
    </Sheet>
  );
}
