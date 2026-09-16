export type EngineErrorCode =
  | 'NOT_AWAITING_QUESTION'
  | 'NOT_AWAITING_ANSWER'
  | 'NO_PROMPT'
  | 'ANSWER_NOT_ALLOWED'
  | 'NOT_AWAITING_GUESS_CONFIRM'
  | 'INVALID_STEP'
  | 'INVALID_REWIND'
  | 'GAME_OVER';

export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message?: string) {
    super(message ? `${code}: ${message}` : code);
    this.name = 'EngineError';
    this.code = code;
  }
}

export function isEngineError(e: unknown, code?: EngineErrorCode): e is EngineError {
  return e instanceof EngineError && (code === undefined || e.code === code);
}
