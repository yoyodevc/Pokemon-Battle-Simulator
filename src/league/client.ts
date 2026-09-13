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
// Supabase reports sign-in problems as short codes. Surfacing them verbatim
// ("Email not confirmed") hides what the trainer has to do next, so map the
// ones this form can actually produce onto an instruction.
const AUTH_MESSAGES: Record<string, string> = {
  email_not_confirmed: 'Confirm your email address first. Open the link we sent you, or resend it below.',
  email_address_invalid: 'That email address was rejected. Use a real inbox you can receive mail at.',
  over_email_send_rate_limit: 'The confirmation email limit has been reached. Try again later; requesting more emails will not bypass the limit.',
  email_address_not_authorized: 'This server cannot send confirmation emails to your address yet. You can play as a guest while the site owner configures email delivery.',
  over_request_rate_limit: 'Too many attempts. Wait a minute, then try again.',
  invalid_credentials: 'That email and password do not match an account.',
  weak_password: 'Choose a longer password with a mix of characters.',
  user_already_exists: 'That email already has an account. Sign in instead.',
  signup_disabled: 'New accounts are turned off on this League server.',
  validation_failed: 'Enter both an email address and a password.',
};
export function authMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code && AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];
  const text = error instanceof Error ? error.message : '';
  return text.includes('Failed to fetch')
    ? 'Could not reach the accounts service. Check your connection and try again.'
    : text || 'Sign-in failed. Please try again.';
}

let client: SupabaseClient | null = null;
export function auth(config: Config): SupabaseClient {
  if (!config.accounts) throw new Error('Account sign-in is not configured yet. You can play as a guest.');
  client ??= createClient(config.supabaseUrl, config.supabaseKey, { auth: { flowType: 'pkce' } });
  return client;
}
export async function restoreLeagueSession(config: Config): Promise<Lobby | null> {
  if (config.accounts) {
    const { data: { session }, error } = await auth(config).auth.getSession();
    if (error) throw new Error(authMessage(error));
    if (session) {
      try { return await request<Lobby>('auth', { token: session.access_token }); }
      catch (error) { if (!(error instanceof LeagueError && error.status === 401)) throw error; }
    }
  }
  try { return await request<Lobby>('session'); }
  catch (error) { if (error instanceof LeagueError && error.status === 401) return null; throw error; }
}
export function confirmationRedirect(): string {
  const route = /^#(?:invite|match)\/[a-zA-Z0-9-]+$/.test(location.hash) ? location.hash : '#league';
  return `${location.origin}/${route}`;
}
export const avatar = (id: number) => new URL(`../../preview/sprites/${id}.gif`, import.meta.url).href;
const localIds: Record<string, number> = { pikachu: 25, charizard: 6, blastoise: 9, venusaur: 3, gengar: 94,
  dragonite: 149, lapras: 131, snorlax: 143, arcanine: 59, alakazam: 65, machamp: 68, gyarados: 130 };
const localSprites = import.meta.glob('../../preview/sprites/**/*.gif', { eager: true, query: '?url', import: 'default' });
export const sprite = (name: string, back = false): string => {
  const local = localSprites[`../../preview/sprites/${back ? 'back/' : ''}${localIds[name]}.gif`];
  return typeof local === 'string' ? local : `https://play.pokemonshowdown.com/sprites/ani${back ? '-back' : ''}/${name}.gif`;
};
