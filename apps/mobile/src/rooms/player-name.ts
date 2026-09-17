import AsyncStorage from '@react-native-async-storage/async-storage';

/** The name shown on this player's seat in a room, remembered on the device. */
const KEY = 'dsa.player.name';
export const MAX_PLAYER_NAME = 24;

export function cleanPlayerName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_PLAYER_NAME);
}

export async function loadPlayerName(): Promise<string> {
  try {
    return cleanPlayerName((await AsyncStorage.getItem(KEY)) ?? '');
  } catch {
    return '';
  }
}

export async function savePlayerName(name: string): Promise<void> {
  try {
    const clean = cleanPlayerName(name);
    if (clean === '') await AsyncStorage.removeItem(KEY);
    else await AsyncStorage.setItem(KEY, clean);
  } catch {
    // Remembering the name is a convenience only.
  }
}
