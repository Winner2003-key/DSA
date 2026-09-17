/**
 * Fallback for platforms without a dedicated recorder. Metro resolves
 * `@/speech/recorder` to `recorder.native.ts` on Android/iOS and to
 * `recorder.web.ts` on the web, so this file is only what TypeScript reads: the
 * three files export the same `useRecorder`.
 */
import { useMemo } from 'react';

import { RecorderError, type Recorder } from './recorder-types';

export * from './recorder-types';

export function useRecorder(): Recorder {
  return useMemo<Recorder>(
    () => ({
      supported: false,
      requestPermission: async () => false,
      start: async () => {
        throw new RecorderError('UNAVAILABLE');
      },
      stop: async () => null,
      cancel: async () => undefined,
    }),
    [],
  );
}
