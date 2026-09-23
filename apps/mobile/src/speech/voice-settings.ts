/**
 * Voice settings kept on this device (AsyncStorage): the Tireur's calibration (GRAPH_SPECIFICATION §1). A tiny shared store, so the game
 * screen and "Réglages de la voix" always agree.
 */
import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseCalibration, type Calibration } from '@dsa/voice';

export interface VoiceSettings {
  loaded: boolean;
  /** null until this device has been calibrated. */
  calibration: Calibration | null;
  /** The calibration was offered once already ("Plus tard" or done). */
  calibrationOffered: boolean;
}

export const VOICE_KEYS = {
  calibration: 'dsa.voice.calibration',
  offered: 'dsa.voice.calibrationOffered',
} as const;

const initial: VoiceSettings = { loaded: false, calibration: null, calibrationOffered: false };

let current: VoiceSettings = initial;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<VoiceSettings>): void {
  current = { ...current, ...patch };
  listeners.forEach((listener) => listener());
}

export function loadVoiceSettings(): Promise<void> {
  if (current.loaded) return Promise.resolve();
  if (!loading) {
    loading = (async () => {
      try {
        const [calibration, offered] = await Promise.all([
          AsyncStorage.getItem(VOICE_KEYS.calibration),
          AsyncStorage.getItem(VOICE_KEYS.offered),
        ]);
        let parsed: Calibration | null = null;
        try {
          parsed = calibration ? parseCalibration(JSON.parse(calibration)) : null;
        } catch {
          parsed = null;
        }
        set({ loaded: true, calibration: parsed, calibrationOffered: offered === '1' });
      } catch {
        set({ loaded: true });
      } finally {
        loading = null;
      }
    })();
  }
  return loading;
}

export function getVoiceSettings(): VoiceSettings {
  return current;
}

export function saveCalibration(calibration: Calibration): void {
  set({ calibration, calibrationOffered: true });
  AsyncStorage.setItem(VOICE_KEYS.calibration, JSON.stringify(calibration)).catch(() => undefined);
  AsyncStorage.setItem(VOICE_KEYS.offered, '1').catch(() => undefined);
}

export function clearCalibration(): void {
  set({ calibration: null });
  AsyncStorage.removeItem(VOICE_KEYS.calibration).catch(() => undefined);
}

export function markCalibrationOffered(): void {
  set({ calibrationOffered: true });
  AsyncStorage.setItem(VOICE_KEYS.offered, '1').catch(() => undefined);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVoiceSettings(): VoiceSettings {
  const value = useSyncExternalStore(subscribe, getVoiceSettings, getVoiceSettings);
  useEffect(() => {
    void loadVoiceSettings();
  }, []);
  return value;
}

/** Test seam. */
export function resetVoiceSettingsForTests(): void {
  current = initial;
  loading = null;
  listeners.clear();
}
