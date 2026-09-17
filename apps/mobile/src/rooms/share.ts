import { Platform, Share } from 'react-native';

import { fr } from '@/i18n/fr';

export type ShareOutcome = 'shared' | 'copied' | 'dismissed' | 'failed';

/**
 * The system share sheet (React Native `Share`). A desktop browser often has no
 * share sheet: the message is copied to the clipboard instead.
 */
export async function shareRoom(code: string, url: string): Promise<ShareOutcome> {
  const message = fr.lobby.shareMessage(code, url);
  if (Platform.OS === 'web') {
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    try {
      if (nav && typeof nav.share === 'function') {
        await nav.share({ title: 'DSA', text: message });
        return 'shared';
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'dismissed';
    }
    try {
      await nav?.clipboard?.writeText(message);
      return nav?.clipboard ? 'copied' : 'failed';
    } catch {
      return 'failed';
    }
  }
  try {
    const result = await Share.share({ message });
    return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
  } catch {
    return 'failed';
  }
}
