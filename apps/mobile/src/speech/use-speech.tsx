import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { textToSpeech, type SpeakOptions } from './tts';

const MUTED_KEY = 'dsa.speech.muted';

interface SpeechContextValue {
  muted: boolean;
  available: boolean;
  toggleMuted: () => void;
  speak: (text: string, options?: SpeakOptions) => void;
  stop: () => void;
  /**
   * The microphone is open: nothing is spoken (the mic would hear the phone). The
   * last utterance asked for meanwhile is spoken once the microphone closes.
   */
  setListening: (listening: boolean) => void;
}

const SpeechContext = createContext<SpeechContextValue>({
  muted: false,
  available: false,
  toggleMuted: () => undefined,
  speak: () => undefined,
  stop: () => undefined,
  setListening: () => undefined,
});

export function SpeechProvider({ children }: { children: React.ReactNode }) {
  const [muted, setMuted] = useState(false);
  const listening = useRef(false);
  const heldBack = useRef<{ text: string; options?: SpeakOptions } | null>(null);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(MUTED_KEY)
      .then((value) => {
        if (!cancelled && value === '1') setMuted(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((previous) => {
      const next = !previous;
      if (next) textToSpeech.stop();
      AsyncStorage.setItem(MUTED_KEY, next ? '1' : '0').catch(() => undefined);
      return next;
    });
  }, []);

  const value = useMemo<SpeechContextValue>(
    () => ({
      muted,
      available: textToSpeech.available,
      toggleMuted,
      speak: (text, options) => {
        if (muted) return;
        if (listening.current) {
          heldBack.current = { text, options };
          return;
        }
        void textToSpeech.speak(text, options);
      },
      stop: () => textToSpeech.stop(),
      setListening: (next) => {
        listening.current = next;
        if (next) {
          textToSpeech.stop();
          return;
        }
        const pending = heldBack.current;
        heldBack.current = null;
        if (pending && !muted) void textToSpeech.speak(pending.text, pending.options);
      },
    }),
    [muted, toggleMuted],
  );

  return <SpeechContext.Provider value={value}>{children}</SpeechContext.Provider>;
}

export function useSpeech(): SpeechContextValue {
  return useContext(SpeechContext);
}
