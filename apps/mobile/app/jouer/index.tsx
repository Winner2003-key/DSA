import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { GameMode, Role } from '@dsa/core';

import {
  AppText,
  BookOpen,
  CheckCard,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  IconTile,
  Mic,
  Play,
  Users,
  ChoiceCard,
  ErrorBanner,
  OfflineBadge,
  PrimaryButton,
  Screen,
  ScopePicker,
  SoundToggle,
  TextField,
  TopBar,
} from '@/components';
import { fr } from '@/i18n/fr';
import { cleanPlayerName, loadPlayerName, MAX_PLAYER_NAME, savePlayerName } from '@/rooms/player-name';
import { GRAPH_SLUG, OFFLINE_ENABLED, getGameService, isPlayable } from '@/services';
import { DsaError, toDsaError } from '@/services/errors';
import { FALLBACK_TIMER_DEFAULTS, type BookSection, type InputMode, type TimerDefaults } from '@/services/types';
import { useTheme } from '@/theme';
import type { LucideIcon } from '@/components';

/** The modes this screen offers alone; a room (`?ami=1`) offers the two roles instead. */
/** The Découvreur looks for the name (eye); the Tireur holds it hidden (eye crossed out). */
const MODES: { mode: GameMode; title: string; hint: string; testID: string; icon: LucideIcon; accent?: boolean }[] = [
  { mode: 'AI_TIREUR', title: fr.choose.decouvreur, hint: fr.choose.decouvreurHint, testID: 'mode-ai-tireur', icon: Eye, accent: true },
  { mode: 'AI_DECOUVREUR', title: fr.choose.tireur, hint: fr.choose.tireurHint, testID: 'mode-ai-decouvreur', icon: EyeOff },
  { mode: 'LOCAL', title: fr.choose.local, hint: fr.choose.localHint, testID: 'mode-local', icon: Users },
];

const ROOM_ROLES: { role: Role; title: string; hint: string; testID: string; icon: LucideIcon; accent?: boolean }[] = [
  { role: 'TIREUR', title: fr.friend.tireur, hint: fr.friend.tireurHint, testID: 'room-role-tireur', icon: EyeOff },
  { role: 'DECOUVREUR', title: fr.friend.decouvreur, hint: fr.friend.decouvreurHint, testID: 'room-role-decouvreur', icon: Eye, accent: true },
];

function modeParam(value: unknown): GameMode {
  return MODES.some((m) => m.mode === value) ? (value as GameMode) : 'AI_TIREUR';
}

/**
 * "Préparer la partie", before every game: who plays, how answers are given, and
 * whether the chronometer runs. Both choices are stored in
 * `game_sessions.settings`. With Voix the players speak and the phone listens;
 * the buttons stay on screen either way.
 *
 * The chronometer is off by default (GAME_RULES, "Time limits"), and its line
 * quotes the durations the admin has actually set, so it never promises a time
 * the game will not give.
 *
 * With `?ami=1` it prepares a room (HUMAN_VS_HUMAN): the creator picks their role
 * and their name, and chooses the input mode and the chronometer for both players.
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
  const [timed, setTimed] = useState(false);
  const [timerDefaults, setTimerDefaults] = useState<TimerDefaults>(FALLBACK_TIMER_DEFAULTS);
  const [scope, setScope] = useState<string[]>([]);
  const [sections, setSections] = useState<BookSection[]>([]);
  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<DsaError | null>(null);

  // The real durations, so the checkbox says what the players will actually get.
  useEffect(() => {
    if (!isPlayable()) return;
    let cancelled = false;
    void getGameService()
      .getTimerDefaults()
      .then((defaults) => {
        if (!cancelled) setTimerDefaults(defaults);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  /** The sommaire is only read when the player asks for it: it is a whole extra call. */
  const openScopePicker = () => {
    setScopeOpen(true);
    if (sections.length > 0 || sectionsLoading || !isPlayable()) return;
    setSectionsLoading(true);
    void getGameService()
      .listSections(GRAPH_SLUG)
      .then(setSections)
      .catch(() => setSections([]))
      .finally(() => setSectionsLoading(false));
  };

  const scopeLabels = sections.filter((s) => scope.includes(s.node_id)).map((s) => s.label);

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
              settings: { input_mode: inputMode, timed, scope },
            }
          : { graphSlug: GRAPH_SLUG, mode, settings: { input_mode: inputMode, timed, scope } },
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
            icon={Play}
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

      <View style={{ gap: theme.space.lg, paddingTop: theme.space.xs, paddingBottom: theme.space.lg }}>
        {OFFLINE_ENABLED ? <OfflineBadge /> : null}
        <AppText variant="display" weight="medium" tight>
          {fr.setup.title}
        </AppText>

        {error ? <ErrorBanner message={error.message} onDismiss={() => setError(null)} /> : null}

        <View accessibilityRole="radiogroup" accessibilityLabel={forRoom ? fr.friend.roleTitle : fr.setup.roleTitle} style={{ gap: theme.space.xs }}>
          {forRoom
            ? ROOM_ROLES.map((r) => (
                <ChoiceCard
                  key={r.role}
                  testID={r.testID}
                  icon={r.icon}
                  tone={r.accent ? 'accent' : 'brass'}
                  title={r.title}
                  selected={role === r.role}
                  disabled={starting}
                  onPress={() => setRole(r.role)}
                />
              ))
            : MODES.map((m) => (
                <ChoiceCard
                  key={m.mode}
                  testID={m.testID}
                  icon={m.icon}
                  tone={m.accent ? 'accent' : 'brass'}
                  title={m.title}
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
            placeholder={fr.friend.namePlaceholder}
            value={name}
            onChangeText={setName}
            maxLength={MAX_PLAYER_NAME}
            autoCapitalize="words"
            autoCorrect={false}
            editable={!starting}
          />
        ) : null}

        <View style={{ gap: theme.space.xs }}>
          <View style={{ flexDirection: 'row', gap: theme.space.xs }}>
            <CheckCard
              compact
              testID="input-voice"
              icon={Mic}
              title={fr.setup.voice}
              hint={inputMode === 'VOICE' ? fr.setup.on : fr.setup.off}
              checked={inputMode === 'VOICE'}
              disabled={starting}
              onPress={() => setInputMode((m) => (m === 'VOICE' ? 'BUTTONS' : 'VOICE'))}
            />
            <CheckCard
              compact
              testID="setup-timer"
              icon={Clock}
              title={fr.setup.timer}
              hint={
                timed
                  ? fr.setup.timerShort(fr.timer.duration(timerDefaults.think_seconds), fr.timer.duration(timerDefaults.play_seconds))
                  : fr.setup.timerNone
              }
              checked={timed}
              disabled={starting}
              onPress={() => setTimed((on) => !on)}
            />
          </View>

          <Pressable
            testID="scope-part"
            accessibilityRole="button"
            accessibilityLabel={scope.length === 0 ? fr.setup.scopeWhole : fr.setup.scopeSummary(scopeLabels)}
            accessibilityHint={fr.setup.scopeQuestionsUnchanged}
            disabled={starting}
            onPress={openScopePicker}
            style={({ pressed }) => ({
              minHeight: theme.touch.secondary,
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space.xs,
              borderRadius: theme.radius.slab,
              borderWidth: 1,
              borderColor: theme.colors.line,
              backgroundColor: pressed ? theme.colors.surface : theme.colors.surfaceRaised,
              paddingHorizontal: theme.space.sm,
              paddingVertical: theme.space.xs,
            })}
          >
            <IconTile icon={BookOpen} selected={scope.length > 0} />
            <AppText variant="small" weight="semibold" numberOfLines={1} style={{ flex: 1 }}>
              {scope.length === 0 ? fr.setup.scopeWhole : scopeLabels.join(', ') || fr.setup.scopeChoose}
            </AppText>
            <ChevronRight size={18} color={theme.colors.inkFaint} />
          </Pressable>

          {forRoom ? (
            <AppText variant="micro" tone="faint">
              {fr.setup.forBoth}
            </AppText>
          ) : null}
        </View>
      </View>

      <ScopePicker
        visible={scopeOpen}
        sections={sections}
        value={scope}
        loading={sectionsLoading}
        onClose={() => setScopeOpen(false)}
        onConfirm={(next) => {
          setScope(next);
          setScopeOpen(false);
        }}
      />
    </Screen>
  );
}
