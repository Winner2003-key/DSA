import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { GameMode, Role } from '@dsa/core';

import {
  AppText,
  ChoiceCard,
  ErrorBanner,
  OfflineBadge,
  PrimaryButton,
  Screen,
  SoundToggle,
  TextField,
  TopBar,
} from '@/components';
import { fr } from '@/i18n/fr';
import { cleanPlayerName, loadPlayerName, MAX_PLAYER_NAME, savePlayerName } from '@/rooms/player-name';
import { GRAPH_SLUG, OFFLINE_ENABLED, getGameService, isPlayable } from '@/services';
import { DsaError, toDsaError } from '@/services/errors';
import type { InputMode } from '@/services/types';
import { useTheme } from '@/theme';

/** The modes this screen offers alone; a room (`?ami=1`) offers the two roles instead. */
const MODES: { mode: GameMode; title: string; hint: string; testID: string }[] = [
  { mode: 'AI_TIREUR', title: fr.choose.decouvreur, hint: fr.choose.decouvreurHint, testID: 'mode-ai-tireur' },
  { mode: 'AI_DECOUVREUR', title: fr.choose.tireur, hint: fr.choose.tireurHint, testID: 'mode-ai-decouvreur' },
  { mode: 'LOCAL', title: fr.choose.local, hint: fr.choose.localHint, testID: 'mode-local' },
];

const ROOM_ROLES: { role: Role; title: string; hint: string; testID: string }[] = [
  { role: 'TIREUR', title: fr.friend.tireur, hint: fr.friend.tireurHint, testID: 'room-role-tireur' },
  { role: 'DECOUVREUR', title: fr.friend.decouvreur, hint: fr.friend.decouvreurHint, testID: 'room-role-decouvreur' },
];

function modeParam(value: unknown): GameMode {
  return MODES.some((m) => m.mode === value) ? (value as GameMode) : 'AI_TIREUR';
}

/**
 * "Préparer la partie", before every game: who plays, and how answers are given.
 * The input mode is stored in `game_sessions.settings.input_mode`. With Voix the
 * players speak and the phone listens; the buttons stay on screen either way.
 *
 * With `?ami=1` it prepares a room (HUMAN_VS_HUMAN): the creator picks their role
 * and their name, and chooses the input mode for both players.
 */
export default function PreparerScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; ami?: string }>();
  const forRoom = params.ami === '1';
  const [mode, setMode] = useState<GameMode>(() => modeParam(params.mode));
  const [role, setRole] = useState<Role>('TIREUR');
  const [name, setName] = useState('');

  useEffect(() => {
    if (!forRoom) return;
    let cancelled = false;
    void loadPlayerName().then((stored) => {
      if (!cancelled && stored) setName((current) => current || stored);
    });
    return () => {
      cancelled = true;
    };
  }, [forRoom]);
  const [inputMode, setInputMode] = useState<InputMode>('BUTTONS');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<DsaError | null>(null);

  const start = async () => {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      if (!isPlayable()) throw new DsaError('CONFIG_MISSING');
      const displayName = cleanPlayerName(name);
      if (forRoom) void savePlayerName(displayName);
      const { sessionId } = await getGameService().createSession(
        forRoom
          ? {
              graphSlug: GRAPH_SLUG,
              mode: 'HUMAN_VS_HUMAN',
              role,
              displayName: displayName || undefined,
              settings: { input_mode: inputMode },
            }
          : { graphSlug: GRAPH_SLUG, mode, settings: { input_mode: inputMode } },
      );
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
          <PrimaryButton
            testID="setup-start"
            label={forRoom ? fr.friend.createRoom : fr.setup.start}
            disabled={starting}
            onPress={() => void start()}
          />
        </View>
      }
    >
      <TopBar
        onBack={() => router.replace(forRoom ? '/ami' : '/')}
        backLabel={forRoom ? fr.app.back : fr.app.home}
        right={<SoundToggle />}
      />

      <View style={{ gap: theme.space.lg, paddingTop: theme.space.sm, paddingBottom: theme.space.lg }}>
        {OFFLINE_ENABLED ? <OfflineBadge /> : null}
        <AppText variant="display" weight="bold" tight>
          {fr.setup.title}
        </AppText>

        {error ? <ErrorBanner message={error.message} onDismiss={() => setError(null)} /> : null}

        <View accessibilityRole="radiogroup" style={{ gap: theme.space.sm }}>
          <AppText variant="lead" weight="semibold" tone="soft">
            {forRoom ? fr.friend.roleTitle : fr.setup.roleTitle}
          </AppText>
          {forRoom
            ? ROOM_ROLES.map((r) => (
                <ChoiceCard
                  key={r.role}
                  testID={r.testID}
                  title={r.title}
                  hint={r.hint}
                  selected={role === r.role}
                  disabled={starting}
                  onPress={() => setRole(r.role)}
                />
              ))
            : MODES.map((m) => (
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

        {forRoom ? (
          <TextField
            testID="player-name"
            label={fr.friend.nameTitle}
            hint={fr.friend.nameHint}
            placeholder={fr.friend.namePlaceholder}
            value={name}
            onChangeText={setName}
            maxLength={MAX_PLAYER_NAME}
            autoCapitalize="words"
            autoCorrect={false}
            editable={!starting}
          />
        ) : null}

        <View accessibilityRole="radiogroup" style={{ gap: theme.space.sm }}>
          <AppText variant="lead" weight="semibold" tone="soft">
            {fr.setup.inputTitle}
          </AppText>
          {forRoom ? (
            <AppText variant="small" tone="faint">
              {fr.friend.inputChosenByCreator}
            </AppText>
          ) : null}
          <ChoiceCard
            testID="input-voice"
            title={fr.setup.voice}
            hint={fr.setup.voiceHint}
            selected={inputMode === 'VOICE'}
            disabled={starting}
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
