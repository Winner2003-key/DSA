import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView } from 'expo-camera';

import { AppText, ErrorBanner, PrimaryButton, QrScanner, SecondaryButton, TextField } from '@/components';
import { fr } from '@/i18n/fr';
import { cleanPlayerName, loadPlayerName, MAX_PLAYER_NAME, savePlayerName } from '@/rooms/player-name';
import { formatRoomCodeInput, isCompleteRoomCode, parseRoomCode } from '@/rooms/room-code';
import { getGameService, isPlayable } from '@/services';
import { DsaError, toDsaError } from '@/services/errors';
import { useTheme } from '@/theme';
import { LogIn, QrCode } from '@/components';

export interface JoinViewProps {
  /** From a link or a scanned QR code (`/rejoindre/DSA-1234`). */
  initialCode?: string | null;
}

/**
 * Joining a room: type the code (the `DSA-` prefix is added, lower case and a
 * missing dash are fine), or scan the QR code. Opened from a link, the code is
 * already filled in and — when this phone remembers the player's name — the room
 * is joined straight away.
 */
export function JoinView({ initialCode = null }: JoinViewProps) {
  const theme = useTheme();
  const router = useRouter();
  const linked = parseRoomCode(initialCode);

  const [code, setCode] = useState(linked ?? '');
  const [name, setName] = useState('');
  const [nameLoaded, setNameLoaded] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<DsaError | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [canScan, setCanScan] = useState(Platform.OS !== 'web');
  const autoJoined = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void loadPlayerName().then((stored) => {
      if (cancelled) return;
      setName((current) => current || stored);
      setNameLoaded(true);
    });
    if (Platform.OS === 'web') {
      CameraView.isAvailableAsync()
        .then((available) => {
          if (!cancelled) setCanScan(available);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const join = useCallback(
    async (target: string, playerName: string) => {
      if (joining) return;
      if (!isCompleteRoomCode(target)) {
        setError(null);
        return;
      }
      setJoining(true);
      setError(null);
      try {
        if (!isPlayable()) throw new DsaError('CONFIG_MISSING');
        const clean = cleanPlayerName(playerName);
        void savePlayerName(clean);
        const { sessionId } = await getGameService().joinSession(target, clean || undefined);
        router.replace(`/partie/${sessionId}`);
      } catch (caught) {
        setError(toDsaError(caught));
        setJoining(false);
      }
    },
    [joining, router],
  );

  // Opened from a link: join at once if we already know who is playing.
  useEffect(() => {
    if (!linked || !nameLoaded || autoJoined.current) return;
    autoJoined.current = true;
    if (name) void join(linked, name);
  }, [join, linked, name, nameLoaded]);

  const complete = isCompleteRoomCode(code);

  return (
    <View testID="join-view" style={{ gap: theme.space.lg, paddingTop: theme.space.sm, paddingBottom: theme.space.lg }}>
      <AppText variant="display" weight="bold" tight>
        {fr.join.title}
      </AppText>

      {error ? <ErrorBanner message={error.message} onDismiss={() => setError(null)} /> : null}

      <TextField
        testID="join-code"
        label={fr.join.codeLabel}
        hint={code !== '' && !complete ? fr.join.incomplete : fr.join.codeHint}
        placeholder={fr.join.codePlaceholder}
        value={code}
        onChangeText={(text) => setCode(formatRoomCodeInput(text))}
        large
        autoCapitalize="characters"
        autoCorrect={false}
        keyboardType={Platform.OS === 'web' ? 'default' : 'number-pad'}
        returnKeyType="go"
        onSubmitEditing={() => void join(code, name)}
        editable={!joining}
      />

      {canScan ? (
        <SecondaryButton testID="join-scan" icon={QrCode} label={fr.join.scan} disabled={joining} onPress={() => setScannerOpen(true)} />
      ) : (
        <AppText variant="small" tone="faint" testID="join-scan-unavailable">
          {fr.join.scanUnavailable}
        </AppText>
      )}

      <TextField
        testID="join-name"
        label={fr.friend.nameTitle}
        hint={fr.friend.nameHint}
        placeholder={fr.friend.namePlaceholder}
        value={name}
        onChangeText={setName}
        maxLength={MAX_PLAYER_NAME}
        autoCapitalize="words"
        autoCorrect={false}
        editable={!joining}
      />

      {joining ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space.sm }}>
          <ActivityIndicator color={theme.colors.brass} />
          <AppText variant="small" tone="soft">
            {fr.join.joining}
          </AppText>
        </View>
      ) : null}

      <PrimaryButton testID="join-submit" icon={LogIn} label={fr.join.submit} disabled={!complete || joining} onPress={() => void join(code, name)} />

      <QrScanner
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onCode={(scanned) => {
          setScannerOpen(false);
          setCode(scanned);
          void join(scanned, name);
        }}
      />
    </View>
  );
}
