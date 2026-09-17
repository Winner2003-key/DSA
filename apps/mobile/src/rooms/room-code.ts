/**
 * Room codes (`DSA-1234`) as people type, paste, scan and share them.
 *
 * The server also accepts `dsa1234` and `1234` (`dsa_join_session`); the app
 * normalises first so the field always shows the canonical form, and so a scanned
 * or pasted link (`dsa://rejoindre/DSA-1234`, `https://…/rejoindre/DSA-1234`,
 * Expo Go's `exp://…/--/rejoindre/DSA-1234`) resolves to the same code.
 */

export const ROOM_CODE_PATTERN = /^DSA-\d{4}$/;
const DIGITS = 4;

/** The code a string designates, or null. Accepts codes and join links. */
export function parseRoomCode(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  if (text === '') return null;

  const link = /rejoindre\/([^/?#\s]+)/i.exec(text);
  if (link?.[1]) {
    try {
      text = decodeURIComponent(link[1]);
    } catch {
      text = link[1];
    }
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    // Some other link: not a room.
    return null;
  }

  const compact = text.toUpperCase().replace(/\s+/g, '');
  const match = /^(?:DSA-?)?(\d{4})$/.exec(compact);
  return match ? `DSA-${match[1]}` : null;
}

/**
 * What the code field shows while someone types: the `DSA-` prefix is added as
 * soon as there is a digit, letters and extra digits are dropped, and a pasted
 * link or code is recognised whole.
 */
export function formatRoomCodeInput(raw: string): string {
  const parsed = parseRoomCode(raw);
  if (parsed) return parsed;
  const withoutPrefix = raw.replace(/^\s*d\s*s\s*a\s*-?/i, '');
  const digits = withoutPrefix.replace(/\D/g, '').slice(0, DIGITS);
  return digits === '' ? '' : `DSA-${digits}`;
}

export function isCompleteRoomCode(value: string): boolean {
  return ROOM_CODE_PATTERN.test(value);
}

/** The app route that joins a room: `/rejoindre/DSA-1234`. */
export function roomJoinPath(code: string): string {
  return `/rejoindre/${code}`;
}

export interface JoinUrlEnvironment {
  /** Public web address of the app (`EXPO_PUBLIC_DSA_WEB_URL`), if configured. */
  webUrl?: string | null;
  /** `expo-linking`'s `createURL`: `dsa://…` in a build, `exp://…/--/…` in Expo Go, the origin on the web. */
  createURL: (path: string) => string;
}

/**
 * The link a QR code and the share sheet carry. A configured web address is
 * preferred because any phone camera can open it (the web version plays too);
 * otherwise the app's own link.
 */
export function roomJoinUrl(code: string, env: JoinUrlEnvironment): string {
  const web = env.webUrl?.trim().replace(/\/+$/, '');
  if (web) return `${web}${roomJoinPath(code)}`;
  return env.createURL(roomJoinPath(code));
}
