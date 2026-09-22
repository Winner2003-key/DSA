import React from 'react';
import { render, type RenderOptions } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SpeechProvider } from '@/speech/use-speech';
import { ThemeProvider } from '@/theme';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider fontsReady={false}>
        <SpeechProvider>{children}</SpeechProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/** RNTL v14 made `render` asynchronous; every caller awaits it. */
export function renderWithProviders(ui: React.ReactElement, options?: RenderOptions) {
  return render(ui, { wrapper: Providers, ...options });
}

// ---------------------------------------------------------------------------
// Fixtures. Since §9 a `GameState` carries the clock and the name changes too,
// so tests build one from these rather than repeating every field.

import { DEFAULT_SETTINGS, type GameSettings, type GameState, type GameStats } from '@/services/types';

/** A frozen instant, so a timed fixture reads the same on every run. */
export const T0 = '2026-09-17T12:00:00.000Z';

export const at = (seconds: number): string => new Date(Date.parse(T0) + seconds * 1000).toISOString();

export function makeSettings(overrides: Partial<GameSettings> = {}): GameSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

/** Untimed by default, exactly like a game nobody ticked the box for. */
export function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    status: 'PLAYING',
    mode: 'LOCAL',
    awaiting: 'QUESTION',
    prompt: { node_id: 'n-ancien', text: 'ANCIEN', node_type: 'QUESTION', answer_classes: ['OUI', 'NON'] },
    dead_end: false,
    pending_guess: null,
    path: [],
    players: [
      { role: 'TIREUR', display_name: 'Awa', is_ai: false, is_me: true },
      { role: 'DECOUVREUR', display_name: 'Bill', is_ai: false, is_me: false },
    ],
    settings: makeSettings(),
    tireur_ready: true,
    room_code: 'DSA-4821',
    timed: false,
    phase: 'PLAYING',
    think_ends_at: null,
    play_ends_at: null,
    server_now: T0,
    redraws_used: 0,
    redraws_left: 2,
    ...overrides,
  };
}

export function makeStats(overrides: Partial<GameStats> = {}): GameStats {
  return {
    questions: 0,
    non: 0,
    backs: 0,
    rewinds: 0,
    timed: false,
    play_seconds: null,
    found_in_seconds: null,
    ...overrides,
  };
}
