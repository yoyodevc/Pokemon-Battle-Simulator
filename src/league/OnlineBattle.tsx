import { useEffect, useRef, useState, type FormEvent } from 'react';
import { loadPokemonPicker, DEFAULT_PLAYER_TEAM, COMPETITIVE_CORE_POOL, VIABLE_RANDOM_POOL, createCompetitiveTeams, createRandomTeams, type PickerPokemon } from '../api/battleSetup';
import { label, type Action, type Pokemon } from '../engine/types';
import { avatar, request, sprite, type Match, type Trainer } from './client';
import OnlineBattleScene from './OnlineBattleScene';
import Modal from './Modal';
import SavedTeams from './SavedTeams';
import TeamSelection from './TeamSelection';
import './onlinePreparation.css';

interface Props {
  match: Match; user: Trainer; busy: boolean; connected: boolean; ping: number | null;
  run: (fn: () => Promise<void>) => Promise<void>; onNotice: (text: string) => void; onMatch: (match: Match) => void;
}
function PokemonImage({ name, back = false }: { name: string; back?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [name]);
  return failed || name === 'unknown' ? <span className="lg-hidden-mon" aria-label={name === 'unknown' ? 'Unrevealed Pokemon' : name}>?</span> : <img src={sprite(name, back)} alt={label(name)} onError={() => setFailed(true)} />;
}
function Health({ pokemon }: { pokemon: Pokemon }) {
  const percent = Math.max(0, pokemon.hp / pokemon.stats.hp * 100);
  return <div className="lg-health"><div><strong>{label(pokemon.name)}</strong><span>Lv. {pokemon.level}{pokemon.status ? ` / ${pokemon.status}` : ''}</span></div><meter min="0" max={pokemon.stats.hp} value={pokemon.hp} low={pokemon.stats.hp * .25} high={pokemon.stats.hp * .5} optimum={pokemon.stats.hp} aria-label={`${label(pokemon.name)} health`} /><small>{pokemon.hp} / {pokemon.stats.hp} HP <span>{Math.round(percent)}%</span></small></div>;
}

export default function OnlineBattle({ match: m, user, busy, connected, ping, run, onNotice, onMatch }: Props) {
  const [roster, setRoster] = useState<string[]>(m.roster || [...DEFAULT_PLAYER_TEAM]);
  const [picker, setPicker] = useState<PickerPokemon[]>([]);
  const [pickerError, setPickerError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [confirmForfeit, setConfirmForfeit] = useState(false);
  const [muted, setMuted] = useState(() => localStorage.getItem('league-muted') !== 'false');
  const [volume, setVolume] = useState(() => Number(localStorage.getItem('league-volume') || '.2'));
  const [animate, setAnimate] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const previous = useRef(m.version);
  const audio = useRef<AudioContext | null>(null);
  const opponent = m.players[1 - m.side]!;

  useEffect(() => {
    if (m.status !== 'preparing') return;
    let live = true;
    void loadPokemonPicker().then(data => { if (live) setPicker(data); }).catch(() => { if (live) setPickerError('Full roster unavailable. The starter team is ready to use.'); });
    return () => { live = false; };
  }, [m.id, m.status]);
  useEffect(() => {
    const tick = () => setSeconds(Math.max(0, Math.ceil((m.deadline - Date.now()) / 1000)));
    tick(); const interval = setInterval(tick, 1000); return () => clearInterval(interval);
  }, [m.deadline]);
  useEffect(() => {
    if (m.version === previous.current) return;
    previous.current = m.version; setAnimate(true);
    const timer = setTimeout(() => setAnimate(false), 700);
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'instant' });
    if (!muted && audio.current?.state === 'running') {
      const oscillator = audio.current.createOscillator(), gain = audio.current.createGain();
      oscillator.frequency.value = m.status === 'ended' ? 660 : 440;
      gain.gain.setValueAtTime(volume * .15, audio.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, audio.current.currentTime + .18);
      oscillator.connect(gain); gain.connect(audio.current.destination); oscillator.start(); oscillator.stop(audio.current.currentTime + .2);
    }
    return () => clearTimeout(timer);
  }, [m.version, m.status, muted, volume]);
  useEffect(() => () => { void audio.current?.close(); }, []);
  function sound() {
    const next = !muted; setMuted(next); localStorage.setItem('league-muted', String(next));
    if (!next) { audio.current ??= new AudioContext(); void audio.current.resume(); }
  }
  async function action(choice: Action) { await run(async () => { const updated = await request<Match>('action', { id: m.id, action: choice, version: m.version }); if (updated?.id) onMatch(updated); setConfirmForfeit(false); }); }
  const ready = (e: FormEvent) => { e.preventDefault(); if (busy || !connected || roster.length !== 6 || m.ready[m.side] || m.status === 'loading') return; void run(async () => { const updated = await request<Match>('ready', { id: m.id, roster }); if (updated?.id) onMatch(updated); }); };
  const readyPending = busy || m.status === 'loading';
  const presetDisabled = busy || m.ready[m.side] || m.status === 'loading';
  const availableNames = picker.map(pokemon => pokemon.name);
  const viableNames = availableNames.filter(name => VIABLE_RANDOM_POOL.includes(name));
  const competitiveAvailable = COMPETITIVE_CORE_POOL.filter(name => availableNames.includes(name)).length >= 12;
  const own = m.state?.teams[m.side], enemy = m.state?.teams[1 - m.side];
  const active = own?.pokemon[own.active], rival = enemy?.pokemon[enemy.active];
  const ended = m.status === 'ended';

  const connectionQuality = !connected ? 'poor' : ping === null ? 'pending' : ping < 100 ? 'good' : ping < 250 ? 'fair' : 'poor';
  const connectionLabel = !connected ? 'Reconnecting' : ping === null ? 'Measuring latency' : `Ping: ${ping} ms`;
  const connection = <span className={`online-connection ${connectionQuality}`} aria-label={connectionLabel} title={connectionLabel}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8.5 16a5.5 5.5 0 0 1 7 0" /><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none" /></svg><span>{connected && ping !== null ? `${ping} ms` : connected ? 'Checking…' : 'Reconnecting'}</span></span>;
  if (m.status === 'battle' || m.status === 'ended') return <><div className="online-live-connection">{connection}</div><OnlineBattleScene match={m} user={user} busy={busy} connected={connected} run={run} onMatch={onMatch} /></>;
  return <section className="lg-match lg-match-preparing">
    <div className="lg-match-heading"><a href="#league" className="lg-link">&#8592; Lobby</a><span className="lg-kicker">STANDARD 6V6 / LEVEL 50</span><div className="lg-inline">{connection}<label className="lg-sound"><input type="checkbox" checked={!muted} onChange={sound} />Sound</label><input className="lg-volume" type="range" min="0" max="1" step=".05" value={volume} aria-label="Battle sound volume" onChange={e => { setVolume(Number(e.target.value)); localStorage.setItem('league-volume', e.target.value); }} /></div></div>
    <div className="setup-heading"><div><p className="eyebrow">ONLINE / THE MATCH LOBBY</p><h1>ASSEMBLE YOUR SIX.</h1><p>Your first Pokémon leads. Your lineup stays private until battle.</p></div><span className="lobby-stamp" aria-hidden="true">6 <small>VS</small> 6</span></div>
    {!m.connections[1 - m.side] && !ended && <p className="lg-notice" role="status">Opponent disconnected. They have 60 seconds from their last connection to return.</p>}
    {!connected && <p className="lg-alert" role="status">Reconnecting to the League. Your match is preserved.</p>}
    {m.error && <p className="lg-alert" role="alert">{m.error}</p>}
    {m.status === 'abandoned' ? <div className="lg-empty"><h2>Room closed</h2><p>No battle was recorded.</p><a href="#league" className="lg-primary">Return to lobby</a></div> : ['preparing', 'loading'].includes(m.status) ? <form className="lg-preparation" onSubmit={ready}>
      {pickerError && <p className="lg-muted">{pickerError}</p>}
      <section className="setup-mode" aria-label="Online match setup">
        <div className="mode-label"><p className="eyebrow">MATCH FORMAT</p><h2>Online rival · Level 50</h2></div>
        <div className="online-matchup" aria-label="Trainer matchup">
          <div className="online-trainer"><div className="online-trainer-portrait"><img src={avatar(user.avatar)} alt={`${user.username}'s avatar`} /></div><div><p className="eyebrow">YOU / HOME SIDE</p><strong>{user.username}</strong><span className={`online-trainer-state${connected && m.ready[m.side] ? ' is-ready' : ''}`}>{!connected ? 'Reconnecting' : m.ready[m.side] ? 'Ready for battle' : 'Choosing your team'}</span></div></div>
          <div className="online-versus" aria-hidden="true"><span>THE MATCHUP</span><b>VS</b><small>6 ON 6</small></div>
          <div className="online-trainer online-trainer-rival"><div className="online-trainer-portrait"><img src={avatar(opponent.avatar)} alt={`${opponent.username}'s avatar`} /></div><div><p className="eyebrow">RIVAL / AWAY SIDE</p><strong>{opponent.username}</strong><span className={`online-trainer-state${m.connections[1 - m.side] && m.ready[1 - m.side] ? ' is-ready' : ''}`}>{!m.connections[1 - m.side] ? 'Reconnecting' : m.ready[1 - m.side] ? 'Ready for battle' : 'Choosing their team'}</span></div></div>
        </div>
        <div className="online-ready-status"><p className="eyebrow">TEAM SELECTION CLOSES IN</p><strong>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</strong><small>Lock in your six before time runs out.</small></div>
        <div className="team-presets" role="group" aria-label="Team presets"><p className="eyebrow">TEAM PRESETS</p><div className="team-preset-actions">
        <button type="button" disabled={presetDisabled || viableNames.length < 12} onClick={() => setRoster(createRandomTeams(viableNames)[0])}><strong>Random viable</strong><small>A fresh, battle-ready team</small></button>
        <button type="button" disabled={presetDisabled || !competitiveAvailable} onClick={() => setRoster(createCompetitiveTeams(availableNames)[0])}><strong>Competitive cores</strong><small>Proven competitive contenders</small></button>
        </div></div>
      </section>
      <details className="online-team-library"><summary className="text-button">Saved teams</summary><SavedTeams key={user.id} userId={user.id} roster={roster} disabled={busy || m.ready[m.side] || m.status === 'loading'} onLoad={setRoster} /></details>
      <TeamSelection roster={roster} picker={picker} disabled={busy || m.ready[m.side] || m.status === 'loading'} error={pickerError} onChange={setRoster} />
      <div className="setup-footer online-readybar"><p role="status">{m.status === 'loading' ? 'Preparing battle data...' : m.ready[m.side] ? 'Team locked. Waiting for your rival.' : roster.length !== 6 ? `Choose ${6 - roster.length} more Pokémon to complete your team.` : <><span className="ready-dot" /> Your team is ready. The stage is yours.</>}</p><button className="primary-button" disabled={busy || !connected || roster.length !== 6 || m.ready[m.side] || m.status === 'loading'}>{readyPending ? <span className="lg-loading-label"><span className="tiny-ball lg-ball-spin" aria-hidden="true" /> {m.status === 'loading' ? 'Preparing battle...' : 'Locking in...'}</span> : m.ready[m.side] ? 'Ready' : 'Enter the arena'} <span aria-hidden="true">↗</span></button><button className="back-link" type="button" onClick={() => setConfirmForfeit(true)}>← Leave room</button></div>
    </form> : <>
      {ended && <div className={`lg-outcome ${m.winner === m.side ? 'victory' : ''}`}><span className="lg-kicker">MATCH COMPLETE / {m.reason}</span><h2>{m.winner === 'draw' ? 'An even match.' : m.winner === m.side ? 'Victory is yours.' : 'A rival worth remembering.'}</h2><p>{m.winner === 'draw' ? 'Both trainers share the result.' : `${m.players[m.winner ?? 0].username} wins.`} {m.state?.turn || 0} turns played.</p><div className="lg-inline"><button className="lg-primary" disabled={busy || m.rematch.includes(user.id)} onClick={() => void run(async () => { const result = await request<{ matchId?: string }>('rematch', { id: m.id }); if (result.matchId) window.location.hash = `match/${result.matchId}`; else onNotice('Rematch requested. Waiting for your rival.'); })}>{m.rematch.includes(user.id) ? 'Rematch requested' : m.rematch.length ? 'Accept rematch' : 'Rematch'} &#8594;</button>{!user.guest && !opponent.guest && <button className="lg-secondary" disabled={busy} onClick={() => void run(async () => { await request('friends', { target: opponent.id, action: 'request' }); onNotice('Friend request sent.'); })}>Add friend</button>}<a href="#league" className="lg-link">Return to lobby</a></div></div>}
      {active && rival && <div className="lg-arena-layout"><div><div className="lg-battle-top"><strong>{ended ? 'Final field' : `Turn ${m.state!.turn + 1}`}</strong><span className={seconds < 20 ? 'lg-danger' : ''}>{ended ? 'Complete' : `${seconds}s remaining`}</span></div><div className={`lg-arena ${animate ? 'lg-resolved' : ''}`}><div className="lg-rival-hp"><Health pokemon={rival} /></div><div className="lg-rival-sprite"><PokemonImage name={rival.name} /></div><div className="lg-own-sprite"><PokemonImage name={active.name} back /></div><div className="lg-own-hp"><Health pokemon={active} /></div></div><div className="lg-team-strip" aria-label="Your team">{own!.pokemon.map((p, i) => <span key={i} className={p.hp <= 0 ? 'fainted' : i === own!.active ? 'active' : ''} title={`${label(p.name)}: ${p.hp}/${p.stats.hp} HP`}><PokemonImage name={p.name} /></span>)}</div>{!ended && <div className="lg-commands"><div className="lg-section-title"><h3>{m.submitted ? 'Waiting for your rival' : m.state!.phase === 'switch' ? active.hp <= 0 ? 'Choose your next Pokemon' : 'Waiting for opponent to switch' : `What will ${label(active.name)} do?`}</h3><span role="status">{m.opponentSubmitted ? 'Rival ready' : 'Rival choosing'}</span></div>{m.submitted ? <p className="lg-empty">Waiting for your rival...</p> : <><div className="lg-moves">{m.legal.filter(a => a.kind === 'move').map(a => {
        if (a.kind !== 'move') return null;
        const move = active.moves[a.slot];
        return <button className={`lg-move type-${move?.type || 'normal'}`} key={a.slot} disabled={busy || !connected} onClick={() => void action(a)}><span className="type-chip">{move?.type || 'normal'}</span><strong>{move ? label(move.name) : 'Struggle'}</strong><small>{move ? `${move.pp}/${move.maxPp} PP / ${move.power || '--'} PWR / ${move.accuracy ?? '--'} ACC` : 'Recoil damage'}</small></button>;
      })}</div><details open={m.state!.phase === 'switch' && active.hp === 0}><summary>Switch Pokemon</summary><div className="lg-switches">{m.legal.filter(a => a.kind === 'switch').map(a => a.kind === 'switch' && <button key={a.slot} disabled={busy || !connected} onClick={() => void action(a)}><PokemonImage name={own!.pokemon[a.slot]!.name} /><span>{label(own!.pokemon[a.slot]!.name)}<small>{own!.pokemon[a.slot]!.hp} HP</small></span></button>)}</div></details></>}<button className="lg-link lg-danger" onClick={() => setConfirmForfeit(true)}>Forfeit battle</button></div>}</div><aside className="lg-battle-log"><h3>Battle journal</h3><div ref={log} role="log" aria-live="polite" aria-relevant="additions">{m.events.length === 0 ? <p>The field is set. Make your opening move.</p> : m.events.map((e, i) => <p key={`${e.turn}-${i}`} className={`event-${e.kind}`}><small>T{e.turn}</small>{e.message}</p>)}</div></aside></div>}
    </>}
    {confirmForfeit && <Modal label={m.status === 'battle' ? 'Forfeit battle' : 'Leave room'} close={() => setConfirmForfeit(false)}><h2>{m.status === 'battle' ? 'Concede this battle?' : 'Leave this room?'}</h2><p>{m.status === 'battle' ? 'Your opponent will receive the win.' : 'This room will close for both trainers.'}</p><div className="lg-inline"><button className="lg-secondary" autoFocus onClick={() => setConfirmForfeit(false)}>Keep playing</button><button className="lg-primary" disabled={busy} onClick={() => void action({ kind: 'forfeit' })}>{m.status === 'battle' ? 'Forfeit' : 'Leave room'}</button></div></Modal>}
  </section>;
}
