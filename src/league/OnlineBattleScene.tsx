import { useMemo, useState, useEffect } from 'react';
import BattleScene from '../components/BattleScene';
import { BattleViewProvider, type BattleContextValue } from '../state/BattleContext';
import type { Pokemon } from '../api/types';
import type { BattleState, Side } from '../engine/types';
import { request, sprite, type Match, type Trainer } from './client';

export default function OnlineBattleScene({ match: m, user, busy, connected, run, replayIndex }: { match: Match; user: Trainer; busy: boolean; connected: boolean; run: (fn: () => Promise<void>) => Promise<void>; replayIndex?: number }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const tick = () => setSeconds(Math.max(0, Math.ceil((m.deadline - Date.now()) / 1000)));
    tick(); const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [m.deadline]);
  const battle = useMemo(() => {
    if (!m.state) return null;
    const teams = (m.side === 0 ? m.state.teams : [m.state.teams[1], m.state.teams[0]]) as BattleState['teams'];
    return { ...m.state, rng: 0, teams, winner: m.winner === 0 || m.winner === 1 ? (m.winner === m.side ? 0 : 1) as Side : m.winner } as BattleState;
  }, [m.state, m.side, m.winner]);
  const events = useMemo(() => m.events.map(event => ({ ...event, side: (event.side === m.side ? 0 : 1) as Side, teams: event.teams && (m.side === 0 ? event.teams : [event.teams[1], event.teams[0]]) as BattleState['teams'] })), [m.events, m.side]);
  const sprites = useMemo(() => Object.fromEntries((battle?.teams.flatMap(team => team.pokemon) ?? []).filter(p => p.name !== 'unknown').map(p => [p.name, {
    name: p.name, cries: { latest: '', legacy: '' }, sprites: { front_default: sprite(p.name), back_default: sprite(p.name, true) },
  } as Pokemon])), [battle]);
  if (!battle) return <main id="main-content" className="battle-page"><p role="status">Battle data is unavailable. <a href="#league">Return to lobby</a></p></main>;
  const value: BattleContextValue = {
    initial: battle, sprites,
    session: { battle, events: replayIndex === undefined ? events : [], cpuSeed: 0, mode: 'cpu', difficulty: 'trainer', pendingPlayerAction: null },
    dispatch: command => { void run(async () => {
      if (command.type === 'restart') {
        const result = await request<{ matchId?: string }>('rematch', { id: m.id });
        if (result.matchId) window.location.hash = `match/${result.matchId}`;
      } else if (!busy && connected && !m.submitted) {
        await request('action', { id: m.id, action: command.action, version: m.version });
      }
    }); },
  };
  return <BattleViewProvider value={value}><BattleScene online={{
    replayEvent: replayIndex === undefined ? undefined : events[0], replayIndex,
    waiting: m.submitted || (battle.phase === 'switch' && !m.legal.length), disabled: busy || !connected,
    opponent: m.players[1 - m.side]!.username, seconds, connected, rematchPending: m.rematch.includes(user.id),
  }} /></BattleViewProvider>;
}
