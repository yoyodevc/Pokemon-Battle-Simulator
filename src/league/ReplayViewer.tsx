import { useEffect, useMemo, useRef, useState } from 'react';
import OnlineBattleScene from './OnlineBattleScene';
import type { Match, Trainer } from './client';

export default function ReplayViewer({ match, user, onClose }: { match: Match; user: Trainer; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const activeDetail = useRef<HTMLButtonElement>(null);
  const frames = useMemo(() => {
    let teams: (typeof match.events)[number]['teams'];
    return match.events.map(event => { teams = event.teams ?? teams; return { ...event, teams }; });
  }, [match.events]);
  const turns = [...new Set(frames.map(event => event.turn))];
  const frame = frames[index];
  const seek = (position: number) => { setPlaying(false); setIndex(position); };
  useEffect(() => {
    const item = activeDetail.current, feed = item?.closest('.lg-turn-feed');
    if (!item || !feed) return;
    const row = item.getBoundingClientRect(), bounds = feed.getBoundingClientRect();
    if (row.top < bounds.top) feed.scrollTop -= bounds.top - row.top;
    else if (row.bottom > bounds.bottom) feed.scrollTop += row.bottom - bounds.bottom;
  }, [index]);
  useEffect(() => {
    if (!playing) return;
    if (index >= frames.length - 1) { setPlaying(false); return; }
    const timer = setTimeout(() => setIndex(i => i + 1), 1500 / speed);
    return () => clearTimeout(timer);
  }, [playing, index, frames.length, speed]);
  const shown: Match = { ...match, status: 'battle', winner: undefined, events: frame ? [frame] : [], submitted: true, legal: [], state: match.state && { ...match.state, teams: frame?.teams || match.state.teams, turn: frame?.turn ?? match.state.turn, phase: 'turn', winner: null } };
  return <div className="lg-replay">
    <div className="lg-replay-toolbar"><button onClick={onClose} title="Back to history" aria-label="Back to history">&#8592;</button><strong>Battle replay</strong><button disabled={!frames.length} onClick={() => { setIndex(0); setPlaying(false); }} title="Restart replay" aria-label="Restart replay">&#8634;</button><button disabled={!frames.length} onClick={() => { if (index === frames.length - 1) setIndex(0); setPlaying(p => !p); }} title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause replay' : 'Play replay'}>{playing ? 'Ⅱ' : '▶'}</button><input aria-label="Replay position" type="range" min={0} max={Math.max(0, frames.length - 1)} value={index} disabled={!frames.length} onChange={e => { setPlaying(false); setIndex(Number(e.target.value)); }} /><span>{frames.length ? index + 1 : 0}/{frames.length}</span><select aria-label="Replay speed" value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={.5}>0.5x</option><option value={1}>1x</option><option value={2}>2x</option></select></div>
    {!frame?.teams && <p className="lg-replay-message">Historical field state unavailable; showing the final field.</p>}
    <OnlineBattleScene match={shown} user={user} busy connected replayIndex={index} run={async () => {}} />
    <section className="lg-replay-log" aria-label="Turn details">
      <div className="lg-turn-navigation"><h2>Turn details</h2></div>
      <div className="lg-turn-feed">{turns.map(turn => <section key={turn}><h3>Turn {turn}</h3>{frames.map((event, i) => event.turn !== turn ? null : <button key={i} ref={i === index ? activeDetail : undefined} className="lg-turn-event" aria-current={i === index ? 'step' : undefined} onClick={() => seek(i)}><span>{match.players[event.side].username} / {event.kind}</span><strong>{event.message}</strong>{event.amount !== undefined && <small>{event.kind === 'damage' ? 'HP lost' : event.kind === 'heal' ? 'HP restored' : 'Amount'}: {event.amount}</small>}{event.move && <small>{event.move.type} / {event.move.damageClass} / Power {event.move.power ?? '-'} / Accuracy {event.move.accuracy ?? '-'}</small>}</button>)}</section>)}</div>
    </section>
  </div>;
}
