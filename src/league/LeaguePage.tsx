import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { EmailAuthProvider, confirmPasswordReset, createUserWithEmailAndPassword, linkWithCredential, sendPasswordResetEmail, signInAnonymously, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { firebaseAuth, authMessage, avatar, LeagueError, request, restoreLeagueSession, type Config, type Invitation, type Lobby, type Match, type Trainer } from './client';
import OnlineBattle from './OnlineBattle';
import ReplayViewer from './ReplayViewer';
import ChallengeInbox from './ChallengeInbox';
import Modal from './Modal';
import { mergeMatch } from './matchUpdates';
import './league.css';
import './leagueFeatures.css';

const AVATARS = [25, 6, 9, 3, 94, 149, 131, 143];
type Tab = 'lobby' | 'friends' | 'history' | 'profile';
const message = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong. Try again.';
function Portrait({ trainer }: { trainer: Trainer }) {
  return <span className="lg-portrait"><img src={avatar(trainer.avatar)} alt="" /><i className={`lg-presence ${trainer.presence.replace(' ', '-')}`} title={trainer.presence} /></span>;
}
/** A password-reset link's mode/oobCode may land in the query string or, if Firebase
 * appended them after an existing #hash continue URL, inside the hash itself. */
function actionParams(): URLSearchParams {
  const fromSearch = new URLSearchParams(location.search);
  if (fromSearch.get('oobCode')) return fromSearch;
  const hash = location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?') + 1) : '';
  return new URLSearchParams(hash);
}

export default function LeaguePage({ route }: { route: string }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [replay, setReplay] = useState<Match | null>(null);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [tab, setTab] = useState<Tab>('lobby');
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [connected, setConnected] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'reset' | 'password'>('login');
  const [resetCode, setResetCode] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Trainer[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [friendPending, setFriendPending] = useState<string | null>(null);
  const lobbyRevision = useRef(0);
  const [name, setName] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState(25);
  const [privacy, setPrivacy] = useState('everyone');
  const lastChallenges = useRef<Set<string> | null>(null);
  const inviteId = route.startsWith('#invite/') ? route.slice(8) : null;
  const matchId = route.startsWith('#match/') ? route.slice(7) : null;
  const goMatch = (id: string) => { window.location.hash = `match/${id}`; };
  const updateMatch = (incoming: Match) => setMatch(current => mergeMatch(current, incoming));
  const refreshLobby = async () => {
    lobbyRevision.current++;
    const snapshot = await request<Lobby>('session');
    lobbyRevision.current++;
    setLobby(snapshot);
  };

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(message(e)); if (e instanceof LeagueError && e.status === 401) setLobby(null); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    void (async () => {
      try {
        const c = await request<Config>('config'); if (!live) return; setConfig(c);
        const params = actionParams();
        if (params.get('mode') === 'resetPassword' && params.get('oobCode')) { setResetCode(params.get('oobCode')); setAuthMode('password'); setAccountOpen(true); }
        const snapshot = await restoreLeagueSession(c);
        if (live) { setError(''); setLobby(snapshot); }
      } catch (e) { if (live) setError(message(e)); }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [connectionAttempt]);

  useEffect(() => {
    if (!lobby) return;
    let live = true, timer: number;
    const poll = async () => {
      try {
        const revision = lobbyRevision.current;
        const query = new URLSearchParams({ away: String(document.hidden), ...(matchId ? { match: matchId } : inviteId ? { invite: inviteId } : {}) });
        const data = await request<{ lobby: Lobby; match: Match | null; invitation: Invitation | null }>(`poll?${query}`);
        if (!live) return;
        setConnected(true); setConnectionError('');
        const incoming = data.lobby.challenges.filter(c => c.to?.id === data.lobby.user.id);
        if (lastChallenges.current && incoming.some(c => !lastChallenges.current!.has(c.id))) setNotice('A trainer challenged you to a duel.');
        lastChallenges.current = new Set(incoming.map(c => c.id));
        if (revision === lobbyRevision.current) setLobby(data.lobby);
        setMatch(prev => mergeMatch(prev, data.match));
        if (data.invitation) {
          setInvitation(data.invitation);
          if (data.invitation.matchId) goMatch(data.invitation.matchId);
        }
        if (data.match?.next) goMatch(data.match.next);
      } catch (e) {
        if (live) { setConnected(false); setConnectionError(message(e)); if (e instanceof LeagueError && e.status === 401) setLobby(null); }
      } finally { if (live) timer = window.setTimeout(() => void poll(), 10000); }
    };
    void poll();
    return () => { live = false; clearTimeout(timer); };
  }, [lobby?.user.id, matchId, inviteId]);

  useEffect(() => {
    setMatch(null); setInvitation(null); setReplay(null);
    if (!lobby) return;
    if (inviteId) void run(async () => setInvitation(await request<Invitation>('invitation', { id: inviteId })));
    if (matchId) void run(async () => { const incoming = await request<Match>('match', { id: matchId }); setMatch(current => mergeMatch(current, incoming)); });
  }, [inviteId, matchId, lobby?.user.id, run]);

  useEffect(() => {
    if (lobby && tab === 'profile') { setName(lobby.user.username); setSelectedAvatar(lobby.user.avatar); setPrivacy(lobby.user.privacy); }
  }, [tab, lobby?.user.id]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get('password') || '');
    await run(async () => {
      const client = firebaseAuth(config!);
      const fail = (e: unknown) => { throw new Error(authMessage(e)); };
      if (authMode === 'reset') {
        try { await sendPasswordResetEmail(client, email, { url: `${location.origin}/?recovery=1#league` }); } catch (e) { fail(e); }
        setNotice('Check your email for a password reset link.'); return;
      }
      if (authMode === 'password') {
        if (!resetCode) fail(new Error('This reset link is invalid or expired. Request a new one.'));
        try { await confirmPasswordReset(client, resetCode!, password); } catch (e) { fail(e); }
        setNotice('Password updated. Sign in below.'); setAuthMode('login'); setResetCode(null); return;
      }
      if (authMode === 'register') {
        const credential = EmailAuthProvider.credential(email, password);
        try {
          if (client.currentUser?.isAnonymous) await linkWithCredential(client.currentUser, credential);
          else await createUserWithEmailAndPassword(client, email, password);
        } catch (e) {
          const code = (e as { code?: string }).code;
          if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') { try { await signInWithEmailAndPassword(client, email, password); } catch (e2) { fail(e2); } }
          else fail(e);
        }
      } else {
        try { await signInWithEmailAndPassword(client, email, password); } catch (e) { fail(e); }
      }
      setLobby(await request<Lobby>('session')); setAccountOpen(false); setNotice('Welcome to the League.');
    });
  }
  async function respond(id: string, action: string) {
    await run(async () => { const result = await request<{ matchId: string | null }>('respond', { id, action }); if (result.matchId) goMatch(result.matchId); else setInvitation(null); });
  }
  async function challenge(target?: string) {
    await run(async () => {
      const c = await request<{ id: string }>('challenge', { target });
      if (target) setNotice('Challenge sent.');
      else { setInvitation(await request<Invitation>('invitation', { id: c.id })); window.location.hash = `invite/${c.id}`; }
    });
  }
  async function friendship(target: string, action: string) {
    setFriendPending(target);
    try { await run(async () => { await request('friends', { target, action }); await refreshLobby(); setNotice(action === 'request' ? 'Friend request sent.' : 'Friends list updated.'); }); }
    finally { setFriendPending(null); }
  }
  const incomingFriends = lobby?.friends.filter(f => f.status === 'pending' && f.to === lobby.user.id) || [];
  const incoming = lobby?.challenges.filter(c => c.to?.id === lobby.user.id) || [];

  const accountForm = <form className="lg-auth" onSubmit={submitAuth}>
    <h2>{authMode === 'register' ? 'Join the League' : authMode === 'reset' ? 'Reset password' : authMode === 'password' ? 'Choose a new password' : 'Welcome back'}</h2>
    {accountOpen && error && <p className="lg-alert" role="alert">{error}</p>}
    {accountOpen && notice && <p className="lg-notice" role="status">{notice}</p>}
    {!config?.accounts && <p className="lg-muted">The League server is not configured yet.</p>}
    {authMode !== 'password' && <label>Email<input name="email" type="email" autoComplete="email" required disabled={!config?.accounts} value={email} onChange={e => setEmail(e.target.value)} /></label>}
    {authMode !== 'reset' && <label>Password<input name="password" type="password" minLength={8} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} required disabled={!config?.accounts} /></label>}
    <button className="lg-primary" disabled={busy || !config?.accounts}>{busy ? 'Please wait...' : authMode === 'register' ? 'Create account' : authMode === 'reset' ? 'Send reset link' : authMode === 'password' ? 'Update password' : 'Sign in'}</button>
    {authMode !== 'password' && <div className="lg-inline"><button type="button" className="lg-link" onClick={() => setAuthMode(authMode === 'register' ? 'login' : 'register')}>{authMode === 'register' ? 'Already a member? Sign in' : 'Create an account'}</button><button type="button" className="lg-link" onClick={() => setAuthMode('reset')}>Forgot password?</button></div>}
  </form>;

  if (lobby && replay) return <ReplayViewer key={replay.id} match={replay} user={lobby.user} onClose={() => setReplay(null)} />;
  if (lobby && match && (match.status === 'battle' || match.status === 'ended')) return <>
    {(error || connectionError) && <div className="lg-alert" role="alert">{error || connectionError}</div>}
    <OnlineBattle match={match} user={lobby.user} busy={busy} connected={connected} run={run} onNotice={setNotice} onMatch={updateMatch} />
  </>;

  return <main id="main-content" className={`league${matchId ? ' lg-in-match' : ''}`}>
    <div className="lg-heading"><div><span className="lg-kicker">ONLINE / STANDARD 6V6</span><h1>Pokemon <span className="lg-heading-dot">League.</span></h1></div><div className="lg-heading-meta"><span>YOUR NEXT RIVAL AWAITS</span><a className="lg-link" href="#battle">Practice vs CPU &#8599;</a></div></div>
    {(error || connectionError) && <div className="lg-alert" role="alert"><span>{error || connectionError}</span>{!lobby && connectionError && <button className="lg-alert-action" disabled={loading || busy} onClick={() => setConnectionAttempt(value => value + 1)}>Retry</button>}<button aria-label="Dismiss error" onClick={() => { setError(''); setConnectionError(''); }}>&times;</button></div>}
    {notice && <div className="lg-notice" role="status"><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}>&times;</button></div>}
    {!matchId && <ChallengeInbox invitations={incoming} busy={busy || !!lobby?.activeMatch} onRespond={respond} />}
    {loading ? <div className="lg-empty" role="status">Connecting to the League...</div> : !lobby ? <div className="lg-entry">
      <section className="lg-guest"><span className="lg-kicker">YOUR NEXT RIVAL IS WAITING</span><div className="lg-starters"><img src={avatar(6)} alt="Charizard" /><img src={avatar(25)} alt="Pikachu" /><img src={avatar(9)} alt="Blastoise" /></div><h2>A new challenger<br />enters the League.</h2><button className="lg-primary" disabled={busy || !config?.accounts} onClick={() => void run(async () => { await signInAnonymously(firebaseAuth(config!)); setLobby(await request<Lobby>('session')); })}>Play as Guest <span>&#8594;</span></button><p className="lg-muted">Guest identity lasts as long as this browser keeps it signed in. Create an account to keep your trainer and add friends.</p></section>
      {accountForm}
    </div> : <>
      <div className="lg-playerbar"><div className="lg-inline"><Portrait trainer={lobby.user} /><div><strong>{lobby.user.username}</strong><small>{lobby.user.guest ? 'Guest trainer' : 'League trainer'} <span className={connected ? 'lg-live' : 'lg-muted'}>{connected ? ' / Connected' : ' / Reconnecting...'}</span></small></div></div><div className="lg-inline"><span className="lg-stat"><b>{lobby.stats.wins}</b> WINS</span><span className="lg-stat"><b>{lobby.stats.played}</b> MATCHES</span>{lobby.user.guest && <button className="lg-secondary" onClick={() => { setAuthMode('register'); setAccountOpen(true); }}>Keep my trainer</button>}<button className="lg-link" disabled={busy} onClick={() => void run(async () => { if (config?.accounts) await signOut(firebaseAuth(config)); setLobby(null); window.location.hash = 'league'; })}>Sign out</button></div></div>
      {accountOpen && <Modal label="Account" close={() => setAccountOpen(false)}><button className="lg-close" aria-label="Close account" onClick={() => setAccountOpen(false)}>&times;</button>{accountForm}</Modal>}
      {matchId ? match ? <OnlineBattle match={match} user={lobby.user} busy={busy} connected={connected} run={run} onNotice={setNotice} onMatch={updateMatch} /> : <div className="lg-empty">{error ? <a href="#league">Return to lobby</a> : 'Opening match...'}</div> : <>
        {lobby.activeMatch && <div className="lg-resume"><span>Your match is still open.</span><button className="lg-primary" onClick={() => goMatch(lobby.activeMatch!)}>Return to match &#8594;</button></div>}
        {invitation && <section className="lg-invitation"><div><span className="lg-kicker">6V6 / LEVEL 50 / STANDARD</span><h2>{invitation.from.id === lobby.user.id ? 'Your invitation is ready' : `${invitation.from.username} challenged you`}</h2><p>Expires {new Date(invitation.expires).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} &middot; {invitation.status}</p></div>{invitation.status === 'pending' && (invitation.from.id === lobby.user.id ? <div className="lg-invite-copy"><label>Invitation link<input readOnly value={`${location.origin}/#invite/${invitation.id}`} onFocus={e => e.target.select()} /></label><button className="lg-secondary" onClick={() => void run(async () => { await navigator.clipboard.writeText(`${location.origin}/#invite/${invitation.id}`); setNotice('Invitation link copied.'); })}>Copy link</button><button className="lg-link" disabled={busy} onClick={() => void respond(invitation.id, 'cancel')}>Cancel invitation</button></div> : <button className="lg-primary" disabled={busy || !!lobby.activeMatch} onClick={() => void respond(invitation.id, 'accept')}>Accept duel &#8594;</button>)}{invitation.matchId && <button className="lg-primary" onClick={() => goMatch(invitation.matchId!)}>Enter match</button>}</section>}
        <nav className="lg-tabs" aria-label="League views">{(['lobby', 'friends', 'history', 'profile'] as const).map(t => <button key={t} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>{t === 'lobby' ? 'Overview' : t === 'history' ? 'Battle history' : t === 'profile' ? 'Trainer profile' : 'Friends'}{t === 'friends' && incomingFriends.length > 0 && <span>{incomingFriends.length}</span>}</button>)}</nav>
        {tab === 'lobby' && <div className="lg-dashboard"><section className="lg-play"><span className="lg-kicker">FRIENDLY BATTLE</span><h2>Bring your team.<br />Find your rival.</h2><div className="lg-play-art"><img src={avatar(149)} alt="Dragonite" /><img src={avatar(94)} alt="Gengar" /></div><div className="lg-inline"><button className="lg-primary" disabled={busy || !!lobby.activeMatch} onClick={() => void challenge()}>Create duel invitation <span>&#8594;</span></button><span className="lg-format">6 POKEMON<br />LEVEL 50</span></div></section><section className="lg-inbox"><div className="lg-section-title"><h2>Challenges</h2><span>{incoming.length}</span></div>{incoming.length === 0 ? <div className="lg-empty"><span className="brand-ball" /><h3>All quiet for now</h3><p>Your incoming duels will appear here.</p></div> : incoming.map(c => <div className="lg-person" key={c.id}><Portrait trainer={c.from} /><div className="lg-person-copy"><strong>{c.from.username}</strong><small>Standard 6v6 challenge</small></div><button className="lg-secondary" disabled={busy} onClick={() => void respond(c.id, 'accept')}>Accept</button><button className="lg-link" disabled={busy} onClick={() => void respond(c.id, 'decline')}>Decline</button></div>)}{lobby.challenges.filter(c => c.from.id === lobby.user.id).map(c => <div className="lg-person" key={c.id}><div className="lg-person-copy"><strong>{c.to?.username || 'Shareable invitation'}</strong><small>Awaiting a challenger</small></div><button className="lg-link" onClick={() => { setInvitation(c); window.location.hash = `invite/${c.id}`; }}>View</button><button className="lg-link" disabled={busy} onClick={() => void respond(c.id, 'cancel')}>Cancel</button></div>)}</section><section className="lg-friends-preview"><div className="lg-section-title"><h2>Your circle</h2><button className="lg-link" onClick={() => setTab('friends')}>View friends &#8594;</button></div>{lobby.friends.filter(f => f.status === 'accepted').length === 0 ? <p className="lg-muted">{lobby.user.guest ? 'Create an account to build your friends list.' : 'Every great rivalry starts with a friend request.'}</p> : lobby.friends.filter(f => f.status === 'accepted').slice(0, 5).map(f => <div className="lg-person" key={f.trainer.id}><Portrait trainer={f.trainer} /><div className="lg-person-copy"><strong>{f.trainer.username}</strong><small>{f.trainer.presence}</small></div><button className="lg-secondary" disabled={busy || !!lobby.activeMatch || f.trainer.presence === 'in battle'} onClick={() => void challenge(f.trainer.id)}>Challenge</button></div>)}</section></div>}
        {tab === 'friends' && <section className="lg-social"><div className="lg-section-title"><h2>Friends & rivals</h2><span>{lobby.friends.filter(f => f.status === 'accepted').length} friends</span></div>{lobby.user.guest ? <div className="lg-empty"><h3>Make your trainer permanent</h3><p>Accounts can find trainers and keep friendships.</p><button className="lg-primary" onClick={() => { setAuthMode('register'); setAccountOpen(true); }}>Create account</button></div> : <><form className="lg-search" onSubmit={e => { e.preventDefault(); void run(async () => { setSearching(true); try { setResults((await request<{ trainers: Trainer[] }>('search', { query: search })).trainers); setSearched(true); } finally { setSearching(false); } }); }}><label htmlFor="trainer-search">Find a trainer</label><div className="lg-inline"><input id="trainer-search" minLength={3} maxLength={20} placeholder="Trainer name" value={search} onChange={e => setSearch(e.target.value)} required /><button className="lg-primary" disabled={busy}>{searching ? 'Searching...' : 'Search'}</button></div></form>{searched && results.length === 0 && <p className="lg-form-feedback" role="status">No trainers found. Try another name.</p>}{results.map(t => <div className="lg-person" key={t.id}><Portrait trainer={t} /><div className="lg-person-copy"><strong>{t.username}</strong><small>{t.presence}</small></div><button className="lg-secondary" disabled={busy || lobby.friends.some(f => f.trainer.id === t.id)} onClick={() => void friendship(t.id, 'request')}>{friendPending === t.id ? 'Sending...' : lobby.friends.some(f => f.trainer.id === t.id && f.status === 'accepted') ? 'Friends' : lobby.friends.some(f => f.trainer.id === t.id) ? 'Request pending' : 'Add friend'}</button><button className="lg-link" disabled={busy} onClick={() => void friendship(t.id, 'block')}>Block</button></div>)}{lobby.friends.length === 0 && <p className="lg-muted">No friends yet. Search for a trainer by name.</p>}{lobby.friends.map(f => <div className="lg-person" key={f.trainer.id}><Portrait trainer={f.trainer} /><div className="lg-person-copy"><strong>{f.trainer.username}</strong><small>{f.status === 'accepted' ? f.trainer.presence : f.from === lobby.user.id ? 'Request sent' : 'Wants to be friends'}</small></div>{f.status === 'accepted' ? <><button className="lg-secondary" disabled={busy || !!lobby.activeMatch} onClick={() => void challenge(f.trainer.id)}>Challenge</button><button className="lg-link" disabled={busy} onClick={() => void friendship(f.trainer.id, 'remove')}>Remove</button></> : f.to === lobby.user.id ? <><button className="lg-secondary" disabled={busy} onClick={() => void friendship(f.trainer.id, 'accept')}>Accept</button><button className="lg-link" disabled={busy} onClick={() => void friendship(f.trainer.id, 'decline')}>Decline</button></> : <button className="lg-link" disabled={busy} onClick={() => void friendship(f.trainer.id, 'cancel')}>Cancel</button>}<button className="lg-link" disabled={busy} onClick={() => void friendship(f.trainer.id, 'block')}>Block</button></div>)}</>}</section>}
{tab === 'history' && <section><div className="lg-section-title"><h2>Battle history</h2><span>{lobby.stats.played} completed</span></div>{lobby.history.length === 0 ? <div className="lg-empty"><h3>Your story starts here</h3><p>Completed online battles will appear here.</p></div> : lobby.history.map(h => <button className="lg-history-row" key={h.id} onClick={() => void run(async () => setReplay(await request<Match>('match', { id: h.id })))}><span className={`lg-result-tag ${h.result}`}>{h.result}</span><Portrait trainer={h.opponent} /><strong>vs {h.opponent.username}</strong><span>{h.reason}</span><time>{new Date(h.ended).toLocaleDateString()}</time><span>Watch replay &#9654;</span></button>)}</section>}
        {tab === 'profile' && <section className="lg-profile"><form onSubmit={e => { e.preventDefault(); void run(async () => { setSavingProfile(true); setProfileSaved(false); try { await request('profile', { username: name, avatar: selectedAvatar, privacy }); await refreshLobby(); setProfileSaved(true); setNotice('Trainer profile saved.'); } finally { setSavingProfile(false); } }); }}><h2>Trainer profile</h2><fieldset><legend>Partner avatar</legend><div className="lg-avatar-picker">{AVATARS.map(a => <label key={a}><input type="radio" disabled={savingProfile} name="avatar" value={a} checked={selectedAvatar === a} onChange={() => { setSelectedAvatar(a); setProfileSaved(false); }} aria-label={`Pokemon avatar ${a}`} /><img src={avatar(a)} alt="" /></label>)}</div></fieldset><label>Trainer name<input disabled={savingProfile} value={name} onChange={e => { setName(e.target.value); setProfileSaved(false); }} minLength={3} maxLength={20} pattern="[a-zA-Z0-9_]+" required /></label><label>Who can challenge me?<select disabled={savingProfile} value={privacy} onChange={e => { setPrivacy(e.target.value); setProfileSaved(false); }}><option value="everyone">Everyone</option><option value="friends">Friends only</option><option value="nobody">Nobody</option></select></label><button className="lg-primary" disabled={busy}>{savingProfile ? 'Saving...' : profileSaved ? 'Profile saved' : 'Save profile'}</button><p className="lg-form-feedback" role="status">{savingProfile ? 'Updating your trainer card...' : profileSaved ? 'Your trainer profile is up to date.' : 'Your name and partner appear to other trainers.'}</p></form><section><div className="lg-trainer-card"><span className="lg-kicker">YOUR TRAINER CARD</span><img src={avatar(selectedAvatar)} alt="Partner Pokémon" /><h2>{name || lobby.user.username}</h2><p>{lobby.user.guest ? 'Guest trainer' : 'League trainer'}</p><div className="lg-inline"><span><b>{lobby.stats.wins}</b> wins</span><span><b>{lobby.stats.played}</b> battles</span></div></div><h2>Blocked trainers</h2>{lobby.blocked.length === 0 ? <p className="lg-muted">No blocked trainers.</p> : lobby.blocked.map(t => <div className="lg-person" key={t.id}><Portrait trainer={t} /><strong className="lg-person-copy">{t.username}</strong><button className="lg-link" disabled={busy} onClick={() => void friendship(t.id, 'unblock')}>Unblock</button></div>)}</section></section>}
      </>}
    </>}
  </main>;
}
