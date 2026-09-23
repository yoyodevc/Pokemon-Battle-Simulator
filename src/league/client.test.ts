import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { restoreLeagueSession } from './client';

// Mirrors the real SDK's guarantee: by the time onAuthStateChanged's callback fires,
// auth.currentUser already reflects the same user (request() reads currentUser directly).
const authObj: { currentUser: { uid: string; getIdToken: () => Promise<string> } | null } = { currentUser: null };
vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }));
vi.mock('firebase/auth', () => ({
  getAuth: () => authObj,
  // Real Firebase invokes the callback asynchronously, never before onAuthStateChanged
  // itself returns — a synchronous call here would break callers that assign the
  // unsubscribe function before using it inside the callback (a legitimate pattern).
  onAuthStateChanged: (_auth: unknown, cb: (u: unknown) => void) => { queueMicrotask(() => cb(authObj.currentUser)); return () => {}; },
}));

const config = { accounts: true, firebase: { apiKey: 'test-key', authDomain: 'test.firebaseapp.com', projectId: 'test', appId: 'test-app' } };
const signedIn = (uid: string) => ({ uid, getIdToken: () => Promise.resolve(`token-${uid}`) });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => { vi.clearAllMocks(); authObj.currentUser = null; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('League session recovery', () => {
  it('restores the session when Firebase already has a signed-in user', async () => {
    authObj.currentUser = signedIn('trainer');
    const fetch = vi.fn().mockResolvedValue(json({ user: { id: 'trainer' } }));
    vi.stubGlobal('fetch', fetch);
    expect(await restoreLeagueSession(config)).toEqual({ user: { id: 'trainer' } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/league/session');
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer token-trainer' });
  });

  it('surfaces a temporarily-unavailable error instead of silently signing the trainer out', async () => {
    authObj.currentUser = signedIn('trainer');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'Temporarily unavailable' }, 503)));
    await expect(restoreLeagueSession(config)).rejects.toThrow('Temporarily unavailable');
  });

  it('returns the entry screen when Firebase has no signed-in user', async () => {
    expect(await restoreLeagueSession(config)).toBeNull();
  });

  it('returns the entry screen without contacting the server when accounts are not configured', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await restoreLeagueSession({ accounts: false, firebase: null })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
