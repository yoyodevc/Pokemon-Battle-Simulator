import { useEffect, useRef, useState, type FormEvent } from 'react';
import { loadPokemonPicker, DEFAULT_PLAYER_TEAM, type PickerPokemon } from '../api/battleSetup';
import { label, type Action, type Pokemon } from '../engine/types';
import { avatar, request, sprite, type Match, type Trainer } from './client';
import OnlineBattleScene from './OnlineBattleScene';
import Modal from './Modal';
import SavedTeams from './SavedTeams';

interface Props {
  match: Match; user: Trainer; busy: boolean; connected: boolean;
  run: (fn: () => Promise<void>) => Promise<void>; onNotice: (text: string) => void;
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

export default function OnlineBattle({ match: m, user, busy, connected, run, onNotice }: Props) {
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
  async function action(choice: Action) { await run(async () => { await request('action', { id: m.id, action: choice, version: m.version }); setConfirmForfeit(false); }); }
  const ready = (e: FormEvent) => { e.preventDefault(); void run(async () => { await request('ready', { id: m.id, roster }); }); };
  const own = m.state?.teams[m.side], enemy = m.state?.teams[1 - m.side];
  const active = own?.pokemon[own.active], rival = enemy?.pokemon[enemy.active];
  const ended = m.status === 'ended';

  if (m.status === 'battle' || m.status === 'ended') return <OnlineBattleScene match={m} user={user} busy={busy} connected={connected} run={run} />;
  return <section className="lg-match">
    <div className="lg-match-heading"><a href="#league" className="lg-link">&#8592; Lobby</a><span className="lg-kicker">STANDARD 6V6 / LEVEL 50</span><div className="lg-inline"><label className="lg-sound"><input type="checkbox" checked={!muted} onChange={sound} />Sound</label><input className="lg-volume" type="range" min="0" max="1" step=".05" value={volume} aria-label="Battle sound volume" onChange={e => { setVolume(Number(e.target.value)); localStorage.setItem('league-volume', e.target.value); }} /></div></div>
    <div className="lg-versus"><div><img src={avatar(user.avatar)} alt="" /><strong>{user.username}</strong><small>You</small></div><span>VS</span><div><img src={avatar(opponent.avatar)} alt="" /><strong>{opponent.username}</strong><small>{m.connections[1 - m.side] ? 'Connected' : 'Reconnecting'}</small></div></div>
    {!m.connections[1 - m.side] && !ended && <p className="lg-notice" role="status">Opponent disconnected. They have 60 seconds from their last connection to return.</p>}
    {!connected && <p className="lg-alert" role="status">Reconnecting to the League. Your match is preserved.</p>}
    {m.error && <p className="lg-alert" role="alert">{m.error}</p>}
    {m.status === 'abandoned' ? <div className="lg-empty"><h2>Room closed</h2><p>No battle was recorded.</p><a href="#league" className="lg-primary">Return to lobby</a></div> : ['preparing', 'loading'].includes(m.status) ? <form className="lg-preparation" onSubmit={ready}>
      <div className="lg-section-title"><div><span className="lg-kicker">TEAM PREVIEW</span><h2>Choose your six.</h2></div><span>{m.ready[1 - m.side] ? 'Opponent ready' : 'Opponent choosing'} / {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span></div>
      {pickerError && <p className="lg-muted">{pickerError}</p>}
      <SavedTeams key={user.id} userId={user.id} roster={roster} disabled={busy || m.ready[m.side] || m.status === 'loading'} onLoad={setRoster} />
      <div className="lg-roster">{roster.map((name, index) => <label className="lg-roster-slot" key={index}><span>0{index + 1}{index === 0 ? ' / LEAD' : ''}</span><div><PokemonImage name={name} /></div><select aria-label={`Team slot ${index + 1}`} value={name} disabled={busy || m.ready[m.side] || m.status === 'loading'} onChange={e => setRoster(r => r.map((n, i) => i === index ? e.target.value : n))}>{(picker.length ? picker : DEFAULT_PLAYER_TEAM.map(n => ({ name: n }))).map(p => <option key={p.name} value={p.name} disabled={roster.includes(p.name) && name !== p.name}>{label(p.name)}</option>)}</select></label>)}</div>
      <div className="lg-readybar"><span>{m.status === 'loading' ? 'Preparing battle data...' : m.ready[m.side] ? 'Team locked. Waiting for your rival.' : 'Your selections stay private until battle.'}</span><button className="lg-primary" disabled={busy || !connected || m.ready[m.side] || m.status === 'loading'}>{m.ready[m.side] ? 'Ready' : 'Lock team & ready up'} &#8594;</button><button className="lg-link" type="button" onClick={() => setConfirmForfeit(true)}>Leave room</button></div>
    </form> : <>
      {ended && <div className={`lg-outcome ${m.winner === m.side ? 'victory' : ''}`}><span className="lg-kicker">MATCH COMPLETE / {m.reason}</span><h2>{m.winner === 'draw' ? 'An even match.' : m.winner === m.side ? 'Victory is yours.' : 'A rival worth remembering.'}</h2><p>{m.winner === 'draw' ? 'Both trainers share the result.' : `${m.players[m.winner ?? 0].username} wins.`} {m.state?.turn || 0} turns played.</p><div className="lg-inline"><button className="lg-primary" disabled={busy || m.rematch.includes(user.id)} onClick={() => void run(async () => { const result = await request<{ matchId?: string }>('rematch', { id: m.id }); if (result.matchId) window.location.hash = `match/${result.matchId}`; else onNotice('Rematch requested. Waiting for your rival.'); })}>{m.rematch.includes(user.id) ? 'Rematch requested' : m.rematch.length ? 'Accept rematch' : 'Rematch'} &#8594;</button>{!user.guest && !opponent.guest && <button className="lg-secondary" disabled={busy} onClick={() => void run(async () => { await request('friends', { target: opponent.id, action: 'request' }); onNotice('Friend request sent.'); })}>Add friend</button>}<a href="#league" className="lg-link">Return to lobby</a></div></div>}
      {active && rival && <div className="lg-arena-layout"><div><div className="lg-battle-top"><strong>{ended ? 'Final field' : `Turn ${m.state!.turn + 1}`}</strong><span className={seconds < 20 ? 'lg-danger' : ''}>{ended ? 'Complete' : `${seconds}s remaining`}</span></div><div className={`lg-arena ${animate ? 'lg-resolved' : ''}`}><div className="lg-rival-hp"><Health pokemon={rival} /></div><div className="lg-rival-sprite"><PokemonImage name={rival.name} /></div><div className="lg-own-sprite"><PokemonImage name={active.name} back /></div><div className="lg-own-hp"><Health pokemon={active} /></div></div><div className="lg-team-strip" aria-label="Your team">{own!.pokemon.map((p, i) => <span key={i} className={p.hp <= 0 ? 'fainted' : i === own!.active ? 'active' : ''} title={`${label(p.name)}: ${p.hp}/${p.stats.hp} HP`}><PokemonImage name={p.name} /></span>)}</div>{!ended && <div className="lg-commands"><div className="lg-section-title"><h3>{m.submitted ? 'Choice locked' : m.state!.phase === 'switch' ? active.hp <= 0 ? 'Choose your next Pokemon' : 'Waiting for opponent to switch' : `What will ${label(active.name)} do?`}</h3><span role="status">{m.opponentSubmitted ? 'Rival ready' : 'Rival choosing'}</span></div>{m.submitted ? <p className="lg-empty">Waiting for your rival...</p> : <><div className="lg-moves">{m.legal.filter(a => a.kind === 'move').map(a => {
        if (a.kind !== 'move') return null;
        const move = active.moves[a.slot];
        return <button className={`lg-move type-${move?.type || 'normal'}`} key={a.slot} disabled={busy || !connected} onClick={() => void action(a)}><span className="type-chip">{move?.type || 'normal'}</span><strong>{move ? label(move.name) : 'Struggle'}</strong><small>{move ? `${move.pp}/${move.maxPp} PP / ${move.power || '--'} PWR / ${move.accuracy ?? '--'} ACC` : 'Recoil damage'}</small></button>;
      })}</div><details open={m.state!.phase === 'switch' && active.hp === 0}><summary>Switch Pokemon</summary><div className="lg-switches">{m.legal.filter(a => a.kind === 'switch').map(a => a.kind === 'switch' && <button key={a.slot} disabled={busy || !connected} onClick={() => void action(a)}><PokemonImage name={own!.pokemon[a.slot]!.name} /><span>{label(own!.pokemon[a.slot]!.name)}<small>{own!.pokemon[a.slot]!.hp} HP</small></span></button>)}</div></details></>}<button className="lg-link lg-danger" onClick={() => setConfirmForfeit(true)}>Forfeit battle</button></div>}</div><aside className="lg-battle-log"><h3>Battle journal</h3><div ref={log} role="log" aria-live="polite" aria-relevant="additions">{m.events.length === 0 ? <p>The field is set. Make your opening move.</p> : m.events.map((e, i) => <p key={`${e.turn}-${i}`} className={`event-${e.kind}`}><small>T{e.turn}</small>{e.message}</p>)}</div></aside></div>}
    </>}
    {confirmForfeit && <Modal label={m.status === 'battle' ? 'Forfeit battle' : 'Leave room'} close={() => setConfirmForfeit(false)}><h2>{m.status === 'battle' ? 'Concede this battle?' : 'Leave this room?'}</h2><p>{m.status === 'battle' ? 'Your opponent will receive the win.' : 'This room will close for both trainers.'}</p><div className="lg-inline"><button className="lg-secondary" autoFocus onClick={() => setConfirmForfeit(false)}>Keep playing</button><button className="lg-primary" disabled={busy} onClick={() => void action({ kind: 'forfeit' })}>{m.status === 'battle' ? 'Forfeit' : 'Leave room'}</button></div></Modal>}
  </section>;
}
