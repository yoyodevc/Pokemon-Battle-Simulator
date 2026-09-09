import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Action, BattleEvent, BattleState } from '../engine/types';

export interface Trainer { id: string; username: string; avatar: number; guest: boolean; privacy: string; presence: string }
export interface Friendship { from: string; to: string; status: string; trainer: Trainer }
export interface Invitation { id: string; from: Trainer; to: Trainer | null; status: string; expires: number; matchId: string | null }
export interface Lobby {
  user: Trainer; friends: Friendship[]; blocked: Trainer[]; challenges: Invitation[]; activeMatch: string | null;
  stats: { played: number; wins: number; draws: number };
  history: { id: string; opponent: Trainer; result: string; reason: string; ended: number }[];
}
export interface Match {
  id: string; side: 0 | 1; players: [Trainer, Trainer]; status: string; ready: boolean[];
  roster: string[] | null; state: Omit<BattleState, 'rng'> | null; version: number;
  submitted: boolean; opponentSubmitted: boolean; legal: Action[]; events: BattleEvent[];
  deadline: number; winner?: 0 | 1 | 'draw'; reason?: string; error?: string; rematch: string[];
  next?: string; connections: boolean[];
}
export interface Config { accounts: boolean; supabaseUrl: string; supabaseKey: string }
export class LeagueError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/league/${path}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The League server is unavailable. Please try again shortly.');
  const result = await response.json();
  if (!response.ok) throw new LeagueError(result.error || 'Request failed.', response.status);
  return result as T;
}
let client: SupabaseClient | null = null;
export function auth(config: Config): SupabaseClient {
  if (!config.accounts) throw new Error('Account sign-in is not configured yet. You can play as a guest.');
  client ??= createClient(config.supabaseUrl, config.supabaseKey, { auth: { flowType: 'pkce' } });
  return client;
}
export const avatar = (id: number) => new URL(`../../preview/sprites/${id}.gif`, import.meta.url).href;
const localIds: Record<string, number> = { pikachu: 25, charizard: 6, blastoise: 9, venusaur: 3, gengar: 94,
  dragonite: 149, lapras: 131, snorlax: 143, arcanine: 59, alakazam: 65, machamp: 68, gyarados: 130 };
const localSprites = import.meta.glob('../../preview/sprites/**/*.gif', { eager: true, query: '?url', import: 'default' });
export const sprite = (name: string, back = false): string => {
  const local = localSprites[`../../preview/sprites/${back ? 'back/' : ''}${localIds[name]}.gif`];
  return typeof local === 'string' ? local : `https://play.pokemonshowdown.com/sprites/ani${back ? '-back' : ''}/${name}.gif`;
};
