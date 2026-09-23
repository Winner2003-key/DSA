import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { AppText } from './app-text';
import { PrimaryButton, SecondaryButton } from './buttons';
import { fr } from '@/i18n/fr';
import { parseRoomCode } from '@/rooms/room-code';
import { useTheme } from '@/theme';
import { QrCode, X } from './icon';

export interface QrScannerProps {
  visible: boolean;
  onClose: () => void;
  /** Called once with the room code of a DSA join QR code. */
  onCode: (code: string) => void;
}

/**
 * Scanning a room's QR code with expo-camera's `CameraView`, which works in Expo
 * Go (Android, iOS) and in the browser. Anything that isn't a DSA join link is
 * refused in place; the code field is always there as the fallback.
 */
export function QrScanner({ visible, onClose, onCode }: QrScannerProps) {
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [notARoom, setNotARoom] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    if (visible) {
      done.current = false;
      setNotARoom(false);
    }
  }, [visible]);

  const onScanned = useCallback(
    ({ data }: { data: string }) => {
      if (done.current) return;
      const code = parseRoomCode(data);
      if (!code) {
        setNotARoom(true);
        return;
      }
      done.current = true;
      onCode(code);
    },
    [onCode],
  );

  let body: React.ReactNode;
  if (!permission) {
    body = null;
  } else if (!permission.granted) {
    body = (
      <View style={{ gap: theme.space.sm }}>
        <AppText variant="body" tone="soft">
          {permission.canAskAgain ? fr.join.scanPermission : fr.join.scanDenied}
        </AppText>
        {permission.canAskAgain ? (
          <PrimaryButton testID="scan-allow" icon={QrCode} label={fr.join.scanAllow} onPress={() => void requestPermission()} />
        ) : null}
      </View>
    );
  } else {
    body = (
      <View
        style={{
          width: '100%',
          aspectRatio: 1,
          borderRadius: theme.radius.card,
          overflow: 'hidden',
          borderWidth: 3,
          borderColor: theme.colors.brass,
          backgroundColor: '#000',
        }}
      >
        <CameraView
          testID="qr-camera"
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onScanned}
        />
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, justifyContent: 'center', padding: theme.space.lg }}>
        <View
          testID="qr-scanner"
          style={{ width: '100%', maxWidth: theme.maxContentWidth, alignSelf: 'center', gap: theme.space.md }}
        >
          <AppText variant="display" weight="bold" tight>
            {fr.join.scanTitle}
          </AppText>
          <AppText variant="body" tone="soft">
            {fr.join.scanHint}
          </AppText>
          {body}
          {notARoom ? (
            <AppText variant="body" tone="danger" testID="scan-not-a-room">
              {fr.join.scanNotARoom}
            </AppText>
          ) : null}
          <SecondaryButton testID="scan-close" icon={X} label={fr.app.close} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
