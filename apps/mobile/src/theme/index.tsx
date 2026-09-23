import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { darkPalette, lightPalette, type Palette } from './colors';
import { fallbackFamily, fontFamilies, fontSize, lineHeight } from './typography';
import { maxContentWidth, radius, space, touch } from './spacing';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface FontFamilySet {
  readonly regular: string;
  readonly medium: string;
  readonly semibold: string;
  readonly bold: string;
}

export interface Theme {
  readonly colors: Palette;
  readonly font: FontFamilySet;
  readonly fontSize: typeof fontSize;
  readonly lineHeight: typeof lineHeight;
  readonly space: typeof space;
  readonly radius: typeof radius;
  readonly touch: typeof touch;
  readonly maxContentWidth: number;
  /** False until the webfont is ready; components fall back to a system serif. */
  readonly fontsReady: boolean;
}

interface ThemeContextValue {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}

const PREFERENCE_KEY = 'dsa.theme.preference';

function buildTheme(colors: Palette, fontsReady: boolean): Theme {
  return {
    colors,
    font: fontsReady
      ? fontFamilies
      : { regular: fallbackFamily, medium: fallbackFamily, semibold: fallbackFamily, bold: fallbackFamily },
    fontSize,
    lineHeight,
    space,
    radius,
    touch,
    maxContentWidth,
    fontsReady,
  };
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: buildTheme(lightPalette, false),
  preference: 'system',
  setPreference: () => undefined,
});

export function ThemeProvider({ children, fontsReady }: { children: React.ReactNode; fontsReady: boolean }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(PREFERENCE_KEY)
      .then((value) => {
        if (!cancelled && (value === 'light' || value === 'dark' || value === 'system')) setPreferenceState(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
    AsyncStorage.setItem(PREFERENCE_KEY, p).catch(() => undefined);
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const scheme = preference === 'system' ? (system ?? 'light') : preference;
    return {
      theme: buildTheme(scheme === 'light' ? lightPalette : darkPalette, fontsReady),
      preference,
      setPreference,
    };
  }, [preference, system, fontsReady, setPreference]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext).theme;
}

export function useThemePreference(): { preference: ThemePreference; setPreference: (p: ThemePreference) => void } {
  const { preference, setPreference } = useContext(ThemeContext);
  return { preference, setPreference };
}

export { darkPalette, lightPalette };
export type { Palette, AnswerColor } from './colors';
export * from './spacing';
export * from './typography';
