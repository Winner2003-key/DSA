/**
 * "Ask again" as a hook, for every screen that needs the microphone: the game
 * (`use-voice-turn`), the calibration and the call.
 *
 * What it gives a screen: the state of the permission, one `ask()` that raises
 * the platform's dialog whenever a dialog can still be raised, the French steps
 * for this browser when it cannot, and — the part that makes a refusal harmless —
 * `onGranted`, fired the moment the player turns the microphone back on, whether
 * from our button or from the browser's own panel. Nothing here ever remembers a
 * refusal: every tap asks again.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fr } from '@/i18n/fr';
import { micPermission } from './mic-permission';
import type { MicPermissionPort, MicPermissionState } from './mic-permission-types';

export interface MicPermissionHelp {
  /** What the platform says now (`unknown` when it will not say). */
  state: MicPermissionState;
  /** The refusal is stored: asking raises no dialog, so `steps` is the way back. */
  blocked: boolean;
  /** An ask is in flight (the platform's dialog may be up). */
  asking: boolean;
  /** Asks again. True when the microphone can be used afterwards. */
  ask: () => Promise<boolean>;
  /** What to do in this browser, once `blocked`. */
  steps: readonly string[];
  /** Opens the phone's settings, on the platforms that have one. */
  openSettings: (() => void) | null;
}

export interface UseMicPermissionOptions {
  /** Called when the microphone becomes usable — never on the first read. */
  onGranted?: () => void;
  /** Injected in tests. */
  port?: MicPermissionPort;
}

export function useMicPermission(options: UseMicPermissionOptions = {}): MicPermissionHelp {
  const port = options.port ?? micPermission;
  const [state, setState] = useState<MicPermissionState>('unknown');
  const [asking, setAsking] = useState(false);
  const mounted = useRef(true);
  const last = useRef<MicPermissionState | null>(null);
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * `read` is what the platform already thought, so it announces nothing; a
   * `change` is the player turning the switch outside the app — the one that must
   * not need a reload — and an `ask` is our own button, whose answer the screen is
   * waiting for even when the permission had not moved.
   */
  const settle = useCallback((next: MicPermissionState, source: 'read' | 'change' | 'ask') => {
    if (!mounted.current) return;
    const previous = last.current;
    last.current = next;
    setState(next);
    if (next !== 'granted' || source === 'read') return;
    if (source === 'ask' || previous !== 'granted') latest.current.onGranted?.();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void port.read().then((next) => {
      if (!cancelled) settle(next, 'read');
    });
    const unwatch = port.watch((next) => {
      if (!cancelled) settle(next, 'change');
    });
    return () => {
      cancelled = true;
      unwatch();
    };
  }, [port, settle]);

  const ask = useCallback(async () => {
    setAsking(true);
    let next: MicPermissionState;
    try {
      next = await port.request();
    } finally {
      if (mounted.current) setAsking(false);
    }
    settle(next, 'ask');
    return next === 'granted';
  }, [port, settle]);

  const steps = useMemo(() => fr.voice.micSteps[port.helpKind()], [port]);

  return {
    state,
    blocked: state === 'denied',
    asking,
    ask,
    steps,
    openSettings: port.openSettings ? () => port.openSettings?.() : null,
  };
}
