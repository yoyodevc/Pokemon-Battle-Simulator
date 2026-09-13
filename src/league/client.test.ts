import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmationRedirect, restoreLeagueSession } from './client';

const { getSession, signOut } = vi.hoisted(() => ({ getSession: vi.fn(), signOut: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getSession, signOut } }) }));
const config = { accounts: true, supabaseUrl: 'https://example.supabase.co', supabaseKey: 'public-test-key' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('League session recovery', () => {
  it('restores the account directly without depending on an old League cookie', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null });
    const fetch = vi.fn().mockResolvedValue(json({ user: { id: 'trainer' } }));
    vi.stubGlobal('fetch', fetch);
    expect(await restoreLeagueSession(config)).toEqual({ user: { id: 'trainer' } });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/league/auth');
  });

  it('preserves Supabase credentials when the League is temporarily unavailable', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'Temporarily unavailable' }, 503)));
    await expect(restoreLeagueSession(config)).rejects.toThrow('Temporarily unavailable');
    expect(signOut).not.toHaveBeenCalled();
  });

  it('keeps an existing guest session if an account token is rejected', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'expired' } }, error: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ error: 'Expired' }, 401)).mockResolvedValueOnce(json({ user: { id: 'guest' } })));
    expect(await restoreLeagueSession(config)).toEqual({ user: { id: 'guest' } });
  });

  it('returns the entry screen when neither session exists', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'Expired' }, 401)));
    expect(await restoreLeagueSession(config)).toBeNull();
  });

  it('preserves invitation links through email confirmation on the same origin', () => {
    vi.stubGlobal('location', { origin: 'https://league.example', hash: '#invite/abc123' });
    expect(confirmationRedirect()).toBe('https://league.example/#invite/abc123');
    vi.stubGlobal('location', { origin: 'https://league.example', hash: '#home' });
    expect(confirmationRedirect()).toBe('https://league.example/#league');
  });
});
