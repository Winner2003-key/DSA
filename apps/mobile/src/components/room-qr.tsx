import React from 'react';
import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { AppText } from './app-text';
import { fr } from '@/i18n/fr';
import { useTheme } from '@/theme';

/**
 * The join link as a QR code. Always dark on white, whatever the theme: phone
 * cameras read inverted codes badly. It sits on a paper "ticket".
 */
export function RoomQr({ code, url, size = 184 }: { code: string; url: string; size?: number }) {
  const theme = useTheme();
  return (
    <View
      testID="room-qr"
      accessible
      accessibilityRole="image"
      accessibilityLabel={fr.lobby.qrLabel(code)}
      style={{
        alignSelf: 'center',
        backgroundColor: '#FFFFFF',
        borderRadius: theme.radius.card,
        padding: theme.space.md,
        gap: theme.space.xs,
        alignItems: 'center',
        borderBottomWidth: 6,
        borderBottomColor: theme.colors.line,
      }}
    >
      <QRCode value={url} size={size} color="#0E1A17" backgroundColor="#FFFFFF" ecl="M" />
      <AppText variant="micro" weight="semibold" style={{ color: '#4F6459' }} numberOfLines={1}>
        {code}
      </AppText>
    </View>
  );
}
