import { resolveTurn } from '../engine/turn';
import { activePokemon, type Action, type BattleEvent, type BattleState } from '../engine/types';
import type { BattleMode } from '../api/battleSetup';
import { chooseCpuAction, type CpuDifficulty } from './cpuStrategy';

export interface BattleSession { battle: BattleState; events: BattleEvent[]; cpuSeed: number; mode: BattleMode; difficulty: CpuDifficulty; pendingPlayerAction: Action | null }
export type SessionAction = { type: 'act'; action: Action } | { type: 'restart'; battle: BattleState; mode?: BattleMode; difficulty?: CpuDifficulty };

export function initialSession(battle: BattleState, mode: BattleMode = 'cpu', difficulty: CpuDifficulty = 'trainer'): BattleSession {
  return { battle, events: [], cpuSeed: battle.rng ^ 0x12345678, mode, difficulty, pendingPlayerAction: null };
}

/** CPU reads the previous state only; the player's submitted action is never inspected. */
export function battleReducer(session: BattleSession, command: SessionAction): BattleSession {
  if (command.type === 'restart') return initialSession(command.battle, command.mode ?? session.mode, command.difficulty ?? session.difficulty);
  if (session.battle.phase === 'ended') return session;
  if (session.mode === 'local' && session.pendingPlayerAction === null) {
    return { ...session, pendingPlayerAction: command.action };
  }
  const rng = { rng: session.cpuSeed };
  const cpu = chooseCpuAction(session.battle, session.difficulty, rng);
  const playerAction = session.mode === 'local' ? session.pendingPlayerAction : command.action;
  const opponentAction = session.mode === 'local' ? command.action : cpu;
  if (playerAction === null) return session;
  const result = resolveTurn(session.battle, [playerAction, opponentAction]);
  let battle = result.state;
  const events = [...session.events, ...result.events];
  // Resolve an opponent-only replacement without asking the player for a fake turn.
  if (session.mode === 'cpu' && battle.phase === 'switch' && activePokemon(battle, 0).hp > 0) {
    const replacement = chooseCpuAction(battle, session.difficulty, rng);
    if (replacement) {
      const next = resolveTurn(battle, [null, replacement]);
      battle = next.state;
      events.push(...next.events);
    }
  }
  return { battle, events, cpuSeed: rng.rng, mode: session.mode, difficulty: session.difficulty, pendingPlayerAction: null };
}
