import { initializeApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, onAuthStateChanged, type Auth } from 'firebase/auth';
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
export interface Config { accounts: boolean; firebase: FirebaseOptions | null }
export class LeagueError extends Error { constructor(message: string, readonly status: number) { super(message); } }

let authInstance: Auth | null = null;
/** Builds (once) and returns the Firebase Auth client used both for sign-in UI and to
 * attach the bearer token every request() call sends to the League API. */
export function firebaseAuth(config: Config): Auth {
  if (!config.firebase) throw new Error('Account sign-in is not configured yet. You can play as a guest once it is.');
  authInstance ??= getAuth(initializeApp(config.firebase));
  return authInstance;
}

export async function request<T>(path: string, body?: unknown, timeoutMs = 30000): Promise<T> {
  const token = authInstance?.currentUser ? await authInstance.currentUser.getIdToken() : null;
  const response = await fetch(`/api/league/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The League server is unavailable. Please try again shortly.');
  const result = await response.json();
  if (!response.ok) throw new LeagueError(result.error || 'Request failed.', response.status);
  return result as T;
}
export async function streamMatch(id: string, signal: AbortSignal, onMatch: (match: Match) => void): Promise<void> {
  const token = authInstance?.currentUser ? await authInstance.currentUser.getIdToken() : null;
  const response = await fetch('/api/league/stream', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ id }),
  });
  if (!response.ok || !response.body) throw new Error('Match stream unavailable.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const event = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (event.startsWith('data: ')) onMatch(JSON.parse(event.slice(6)) as Match);
    }
  }
}
// Firebase reports sign-in problems as short codes. Surfacing them verbatim ("Firebase:
// Error (auth/wrong-password).") hides what the trainer has to do next, so map the ones
// this form can actually produce onto an instruction.
const AUTH_MESSAGES: Record<string, string> = {
  'auth/email-already-in-use': 'That email already has an account. Sign in instead.',
  'auth/credential-already-in-use': 'That email already has an account. Sign in instead.',
  'auth/invalid-email': 'That email address was rejected. Use a real inbox you can receive mail at.',
  'auth/weak-password': 'Choose a longer password with a mix of characters.',
  'auth/wrong-password': 'That email and password do not match an account.',
  'auth/invalid-credential': 'That email and password do not match an account.',
  'auth/user-not-found': 'That email and password do not match an account.',
  'auth/too-many-requests': 'Too many attempts. Wait a minute, then try again.',
  'auth/network-request-failed': 'Could not reach the accounts service. Check your connection and try again.',
  'auth/invalid-action-code': 'This reset link has expired or was already used. Request a new one.',
  'auth/expired-action-code': 'This reset link has expired. Request a new one.',
};
export function authMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code && AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];
  const text = error instanceof Error ? error.message : '';
  return text || 'Sign-in failed. Please try again.';
}

export async function restoreLeagueSession(config: Config): Promise<Lobby | null> {
  if (!config.firebase) return null;
  const client = firebaseAuth(config);
  const user = await new Promise<Auth['currentUser']>(resolve => {
    const unsubscribe = onAuthStateChanged(client, u => { unsubscribe(); resolve(u); });
  });
  if (!user) return null;
  try { return await request<Lobby>('session'); }
  catch (error) { if (error instanceof LeagueError && error.status === 401) return null; throw error; }
}
export const avatar = (id: number) => new URL(`../../preview/sprites/${id}.gif`, import.meta.url).href;
const localIds: Record<string, number> = { pikachu: 25, charizard: 6, blastoise: 9, venusaur: 3, gengar: 94,
  dragonite: 149, lapras: 131, snorlax: 143, arcanine: 59, alakazam: 65, machamp: 68, gyarados: 130 };
const localSprites = import.meta.glob('../../preview/sprites/**/*.gif', { eager: true, query: '?url', import: 'default' });
export const sprite = (name: string, back = false): string => {
  const local = localSprites[`../../preview/sprites/${back ? 'back/' : ''}${localIds[name]}.gif`];
  return typeof local === 'string' ? local : `https://play.pokemonshowdown.com/sprites/ani${back ? '-back' : ''}/${name}.gif`;
};
