import type { GameService } from './game-service';
import { OfflineGameService } from './offline-game-service';
import { SupabaseGameService } from './supabase-game-service';
import { isSupabaseConfigured } from './supabase';

export const OFFLINE_ENABLED = process.env.EXPO_PUBLIC_DSA_OFFLINE === '1';

/** The graph the app plays. `mini` is the test graph; the book is `livre`. */
export const GRAPH_SLUG = process.env.EXPO_PUBLIC_DSA_GRAPH_SLUG ?? 'livre';

let service: GameService | null = null;

/**
 * One service for the whole app. Offline is opt-in through the environment so a
 * misconfigured production build fails loudly (CONFIG_MISSING) instead of quietly
 * playing the 12-name demo graph.
 */
export function getGameService(): GameService {
  if (!service) service = OFFLINE_ENABLED ? new OfflineGameService() : new SupabaseGameService();
  return service;
}

/** Test seam. */
export function setGameService(next: GameService | null): void {
  service = next;
}

export function isPlayable(): boolean {
  return OFFLINE_ENABLED || isSupabaseConfigured();
}

export * from './types';
export * from './errors';
export type { GameService } from './game-service';
export { OfflineGameService } from './offline-game-service';
export { SupabaseGameService } from './supabase-game-service';
