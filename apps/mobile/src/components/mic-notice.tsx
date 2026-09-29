import React, { useState } from 'react';
import { View } from 'react-native';

import { AppText } from './app-text';
import { PrimaryButton, SecondaryButton } from './buttons';
import { NoticeBanner } from './notice-banner';
import { Mic, Settings } from './icon';
import { fr } from '@/i18n/fr';
import type { MicPermissionHelp } from '@/speech/use-mic-permission';
import { useTheme } from '@/theme';

export interface MicNoticeProps {
  /** How this screen names the problem ("Le micro est refusé.", "L'appel a échoué"). */
  title: string;
  /** One line about this screen, shown when the platform will still ask by itself. */
  hint?: string;
  help: MicPermissionHelp;
  /** Called once the microphone is allowed: the screen opens it again. */
  onAllowed?: () => void;
  /** Whatever else belongs in the banner (close it, try the call again). */
  children?: React.ReactNode;
  testID?: string;
}

/**
 * The banner that replaces "le micro est refusé" as a dead end.
 *
 * Two people in the first weeks pressed Refuser without reading, and the site
 * never asked again — because a browser only asks once and then answers for the
 * player. So the refusal is shown with the way out: a button that asks again
 * (which is all it takes when the browser did not store the refusal), and, when
 * the browser did store it, the steps for that browser. Turning the switch back
 * on is noticed on its own (`useMicPermission`), so nobody has to reload.
 */
export function MicNotice({ title, hint, help, onAllowed, children, testID }: MicNoticeProps) {
  const theme = useTheme();
  const [refused, setRefused] = useState(false);

  const ask = async () => {
    const granted = await help.ask();
    setRefused(!granted);
    if (granted) onAllowed?.();
  };

  return (
    <NoticeBanner
      testID={testID}
      tone="warn"
      busy={help.asking}
      title={title}
      hint={help.blocked ? fr.voice.micBlockedHint : (hint ?? fr.voice.micAskAgainHint)}
    >
      {help.blocked ? (
        <View testID="mic-steps" style={{ gap: theme.space.xxs }}>
          {help.steps.map((step, index) => (
            <AppText key={step} variant="small" tone="soft">
              {`${index + 1}. ${step}`}
            </AppText>
          ))}
        </View>
      ) : null}
      {refused && help.blocked ? (
        <AppText variant="small" tone="danger" testID="mic-still-blocked">
          {fr.voice.micStillBlocked}
        </AppText>
      ) : null}
      <PrimaryButton testID="mic-allow" icon={Mic} label={fr.voice.micAskAgain} disabled={help.asking} onPress={() => void ask()} />
      {help.openSettings && help.blocked ? (
        <SecondaryButton testID="mic-open-settings" icon={Settings} label={fr.voice.micOpenSettings} onPress={help.openSettings} />
      ) : null}
      {children}
    </NoticeBanner>
  );
}
