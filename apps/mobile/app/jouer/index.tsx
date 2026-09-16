import React, { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { GameMode } from '@dsa/core';

import { AppText, ChoiceCard, ErrorBanner, OfflineBadge, PrimaryButton, Screen, SoundToggle, TopBar } from '@/components';
import { fr } from '@/i18n/fr';
import { GRAPH_SLUG, OFFLINE_ENABLED, getGameService, isPlayable } from '@/services';
import { DsaError, toDsaError } from '@/services/errors';
import type { InputMode } from '@/services/types';
import { useTheme } from '@/theme';

/** The modes this screen offers. HUMAN_VS_HUMAN rooms come with S6. */
const MODES: { mode: GameMode; title: string; hint: string; testID: string }[] = [
  { mode: 'AI_TIREUR', title: fr.choose.decouvreur, hint: fr.choose.decouvreurHint, testID: 'mode-ai-tireur' },
  { mode: 'AI_DECOUVREUR', title: fr.choose.tireur, hint: fr.choose.tireurHint, testID: 'mode-ai-decouvreur' },
  { mode: 'LOCAL', title: fr.choose.local, hint: fr.choose.localHint, testID: 'mode-local' },
];

function modeParam(value: unknown): GameMode {
  return MODES.some((m) => m.mode === value) ? (value as GameMode) : 'AI_TIREUR';
}

/**
 * "Préparer la partie", before every game: who plays, and how answers are given.
 * The input mode is stored in `game_sessions.settings.input_mode`. Voice is shown
 * so players know it is coming, and stays unavailable until S7.
 */
export default function PreparerScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<GameMode>(() => modeParam(params.mode));
  const [inputMode, setInputMode] = useState<InputMode>('BUTTONS');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<DsaError | null>(null);

  const start = async () => {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      if (!isPlayable()) throw new DsaError('CONFIG_MISSING');
      const { sessionId } = await getGameService().createSession({
        graphSlug: GRAPH_SLUG,
        mode,
        settings: { input_mode: inputMode },
      });
      router.replace(`/partie/${sessionId}`);
    } catch (caught) {
      setError(toDsaError(caught));
      setStarting(false);
    }
  };

  return (
    <Screen
      scroll
      testID="screen-jouer"
      footer={
        <View style={{ gap: theme.space.xs }}>
          {starting ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space.sm }}>
              <ActivityIndicator color={theme.colors.brass} />
              <AppText variant="small" tone="soft">
                {fr.choose.starting}
              </AppText>
            </View>
          ) : null}
          <PrimaryButton testID="setup-start" label={fr.setup.start} disabled={starting} onPress={() => void start()} />
        </View>
      }
    >
      <TopBar onBack={() => router.replace('/')} backLabel={fr.app.home} right={<SoundToggle />} />

      <View style={{ gap: theme.space.lg, paddingTop: theme.space.sm, paddingBottom: theme.space.lg }}>
        {OFFLINE_ENABLED ? <OfflineBadge /> : null}
        <AppText variant="display" weight="bold" tight>
          {fr.setup.title}
        </AppText>

        {error ? <ErrorBanner message={error.message} onDismiss={() => setError(null)} /> : null}

        <View accessibilityRole="radiogroup" style={{ gap: theme.space.sm }}>
          <AppText variant="lead" weight="semibold" tone="soft">
            {fr.setup.roleTitle}
          </AppText>
          {MODES.map((m) => (
            <ChoiceCard
              key={m.mode}
              testID={m.testID}
              title={m.title}
              hint={m.hint}
              selected={mode === m.mode}
              disabled={starting}
              onPress={() => setMode(m.mode)}
            />
          ))}
        </View>

        <View accessibilityRole="radiogroup" style={{ gap: theme.space.sm }}>
          <AppText variant="lead" weight="semibold" tone="soft">
            {fr.setup.inputTitle}
          </AppText>
          <ChoiceCard
            testID="input-voice"
            title={fr.setup.voice}
            hint={fr.setup.voiceHint}
            selected={inputMode === 'VOICE'}
            disabled
            badge={fr.app.soon}
            onPress={() => setInputMode('VOICE')}
          />
          <ChoiceCard
            testID="input-buttons"
            title={fr.setup.buttons}
            hint={fr.setup.buttonsHint}
            selected={inputMode === 'BUTTONS'}
            disabled={starting}
            onPress={() => setInputMode('BUTTONS')}
          />
        </View>
      </View>
    </Screen>
  );
}
