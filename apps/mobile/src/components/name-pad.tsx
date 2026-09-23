import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { AppText } from './app-text';
import { PrimaryButton } from './buttons';
import { Sheet } from './sheet';
import { fr } from '@/i18n/fr';
import { searchNames } from '@/state/use-names';
import { useTheme } from '@/theme';
import { Check } from './icon';

export interface NamePadProps {
  visible: boolean;
  names: string[];
  onClose: () => void;
  onSubmit: (name: string) => void;
}

/**
 * Calling a name, which the rules allow at any time. The field is free text — a
 * player may know a name the graph spells differently — but the suggestions are
 * accent-insensitive so "cain" reaches CAÏN without a keyboard fight.
 */
export function NamePad({ visible, names, onClose, onSubmit }: NamePadProps) {
  const theme = useTheme();
  const [query, setQuery] = useState('');

  const suggestions = useMemo(() => searchNames(names, query), [names, query]);
  const trimmed = query.trim();

  const submit = (name: string) => {
    const value = name.trim();
    if (value === '') return;
    setQuery('');
    onSubmit(value);
  };

  return (
    <Sheet
      visible={visible}
      title={fr.game.proposeNameTitle}
      onClose={() => {
        setQuery('');
        onClose();
      }}
      testID="name-pad"
    >
      <TextInput
        testID="name-input"
        value={query}
        onChangeText={setQuery}
        placeholder={fr.game.proposeNamePlaceholder}
        placeholderTextColor={theme.colors.inkFaint}
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="send"
        onSubmitEditing={() => submit(trimmed)}
        accessibilityLabel={fr.game.proposeNameTitle}
        style={{
          minHeight: theme.touch.primary,
          borderRadius: theme.radius.field,
          borderWidth: 1,
          borderColor: theme.colors.line,
          backgroundColor: theme.colors.surface,
          paddingHorizontal: theme.space.md,
          color: theme.colors.ink,
          fontFamily: theme.font.semibold,
          fontSize: theme.fontSize.title,
        }}
      />

      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 240 }}>
        {suggestions.length === 0 && trimmed.length > 0 ? (
          <AppText variant="small" tone="faint" style={{ paddingVertical: theme.space.sm }}>
            {fr.game.proposeNameEmpty}
          </AppText>
        ) : null}
        {suggestions.map((name) => (
          <Pressable
            key={name}
            testID={`name-suggestion-${name}`}
            accessibilityRole="button"
            onPress={() => submit(name)}
            style={({ pressed }) => ({
              minHeight: theme.touch.secondary,
              justifyContent: 'center',
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.line,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <AppText variant="lead" weight="semibold">
              {name}
            </AppText>
          </Pressable>
        ))}
      </ScrollView>

      <View style={{ paddingTop: theme.space.xs }}>
        <PrimaryButton
          testID="name-submit"
          icon={Check}
          label={fr.game.proposeNameSend}
          disabled={trimmed.length === 0}
          onPress={() => submit(trimmed)}
        />
      </View>
    </Sheet>
  );
}
