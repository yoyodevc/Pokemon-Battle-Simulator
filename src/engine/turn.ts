import { accuracyChance, effectiveness, hitCount, rollDamage } from './damage.ts';
import { chance } from './rng.ts';
import { changeStage, effectiveSpeed } from './stats.ts';
import { applyAilment, canAct, damageHp, healHp, resetOnSwitch, residualDamage } from './status.ts';
import { activePokemon, emit, label, otherSide, type Action, type BattleEvent, type BattleState,
  type Move, type Side, type Team, type TurnResult, type TypeChart } from './types.ts';

const SIDES: readonly Side[] = [0, 1];

export const STRUGGLE: Move = {
  name: 'Struggle', type: 'typeless', damageClass: 'physical', power: 50,
  accuracy: null, pp: 1, maxPp: 1, priority: 0,
};

export function createBattle(teams: [Team, Team], chart: TypeChart, seed = 1): BattleState {
  for (const team of teams) {
    if (team.pokemon.length === 0 || team.pokemon.length > 6 || !team.pokemon[team.active]) {
      throw new Error('Teams require 1-6 Pokemon and a valid active slot');
    }
  }
  const state: BattleState = structuredClone({ teams, chart, rng: seed >>> 0,
    turn: 0, phase: 'turn', winner: null });
  updatePhase(state, []);
  return state;
}

export function legalActions(state: BattleState, side: Side): Action[] {
  if (state.phase === 'ended') return [];
  const team = state.teams[side];
  const pokemon = activePokemon(state, side);
  if (state.phase === 'switch' && pokemon.hp > 0) return [];
  const actions: Action[] = team.pokemon.flatMap((member, slot) =>
    member.hp > 0 && slot !== team.active ? [{ kind: 'switch' as const, slot }] : []);
  if (state.phase === 'turn' && pokemon.hp > 0) {
    const moves: Action[] = pokemon.moves.flatMap((move, slot) =>
      move.pp > 0 ? [{ kind: 'move' as const, slot }] : []);
    actions.unshift(...(moves.length ? moves : [{ kind: 'move' as const, slot: -1 }]));
  }
  actions.push({ kind: 'forfeit' });
  return actions;
}

function validate(state: BattleState, side: Side, action: Action | null): void {
  const legal = legalActions(state, side);
  if (action === null && legal.length === 0) return;
  if (action && legal.some((candidate) => candidate.kind === action.kind
    && (candidate.kind === 'forfeit' || (action.kind !== 'forfeit' && candidate.slot === action.slot)))) return;
  throw new Error(`Illegal action for side ${side}`);
}

function selectedMove(state: BattleState, side: Side, slot: number): Move {
  if (slot === -1) return STRUGGLE;
  const move = activePokemon(state, side).moves[slot];
  if (!move) throw new Error('Invalid move slot');
  return move;
}

function updatePhase(state: BattleState, events: BattleEvent[]): void {
  const alive = SIDES.map((side) => state.teams[side].pokemon.some((pokemon) => pokemon.hp > 0));
  if (!alive[0] || !alive[1]) {
    state.phase = 'ended';
    state.winner = !alive[0] && !alive[1] ? 'draw' : alive[0] ? 0 : 1;
    emit(state, events, 'end', state.winner === 'draw' ? 0 : state.winner,
      state.winner === 'draw' ? 'Battle ended in a draw.' : `${state.teams[state.winner].name} won!`);
    return;
  }
  state.phase = SIDES.some((side) => activePokemon(state, side).hp === 0) ? 'switch' : 'turn';
}

function switchPokemon(state: BattleState, events: BattleEvent[], side: Side, slot: number): void {
  resetOnSwitch(activePokemon(state, side));
  state.teams[side].active = slot;
  emit(state, events, 'switch', side, `${state.teams[side].name} sent out ${label(activePokemon(state, side).name)}!`);
}

function executeMove(state: BattleState, events: BattleEvent[], side: Side, slot: number,
  opponentStillQueued: boolean): void {
  const attacker = activePokemon(state, side);
  if (attacker.hp === 0 || !canAct(state, events, side)) return;
  const move = selectedMove(state, side, slot);
  if (slot !== -1) move.pp -= 1;
  emit(state, events, 'move', side, `${label(attacker.name)} used ${label(move.name)}!`);
  const targetSide = move.target === 'self' ? side : otherSide(side);
  const defender = activePokemon(state, targetSide);
  if (defender.hp === 0 || !chance(state, accuracyChance(attacker, defender, move))) {
    emit(state, events, 'miss', side, `${label(attacker.name)}'s ${label(move.name)} missed!`);
    return;
  }
  // Self-targeting moves do not interact with the user's type immunities.
  const typeMod = move.target === 'self' ? 1 : effectiveness(state.chart, move.type, defender.types);
  if (typeMod === 0) {
    emit(state, events, 'effectiveness', targetSide, `It doesn't affect ${label(defender.name)}...`);
    return;
  }
  if (move.type === 'fire' && defender.status === 'freeze') {
    defender.status = null;
    emit(state, events, 'status', targetSide, `${label(defender.name)} thawed out!`);
  }

  let dealt = 0;
  if (move.power !== null && move.damageClass !== 'status') {
    const count = hitCount(move, state);
    let hits = 0;
    for (; hits < count && defender.hp > 0; hits += 1) {
      const result = rollDamage(attacker, defender, move, state.chart, state);
      if (result.critical) emit(state, events, 'critical', side, 'A critical hit!');
      dealt += damageHp(state, events, targetSide, result.damage);
    }
    if (count > 1) emit(state, events, 'hits', side, `Hit ${hits} times!`, hits);
    if (typeMod !== 1) emit(state, events, 'effectiveness', targetSide,
      typeMod > 1 ? "It's super effective!" : "It's not very effective...");
  }
  if (move.healing && attacker.hp > 0) {
    healHp(state, events, side, Math.max(1, Math.floor(attacker.stats.hp * move.healing / 100)));
  }
  if (dealt > 0 && move.drain) {
    const amount = Math.max(1, Math.floor(dealt * Math.abs(move.drain) / 100));
    if (move.drain > 0) healHp(state, events, side, amount);
    else damageHp(state, events, side, amount);
  }
  if (slot === -1 && dealt > 0) damageHp(state, events, side, Math.max(1, Math.floor(attacker.stats.hp / 4)));
  if (defender.hp > 0) {
    if (move.ailment && chance(state, (move.ailmentChance ?? (move.damageClass === 'status' ? 100 : 0)) / 100)) {
      applyAilment(state, events, targetSide, move.ailment);
    }
    if (targetSide !== side && opponentStillQueued && chance(state, (move.flinchChance ?? 0) / 100)) {
      defender.flinched = true;
    }
  }
  const statSide = (move.statTarget ?? move.target) === 'self' ? side : targetSide;
  const statRecipient = activePokemon(state, statSide);
  if (statRecipient.hp > 0 && move.statChanges
    && chance(state, (move.statChance ?? (move.damageClass === 'status' ? 100 : 0)) / 100)) {
    for (const change of move.statChanges) {
      const actual = changeStage(statRecipient, change.stat, change.change);
      emit(state, events, 'stage', statSide, actual === 0
        ? `${label(statRecipient.name)}'s ${label(change.stat)} cannot change further!`
        : `${label(statRecipient.name)}'s ${label(change.stat)} ${actual > 0 ? 'rose' : 'fell'}!`, actual);
    }
  }
}

/** Resolves simultaneous choices without mutating the input or retaining hidden RNG state. */
export function resolveTurn(input: BattleState, actions: readonly [Action | null, Action | null]): TurnResult {
  if (input.phase === 'ended') throw new Error('Battle has ended');
  SIDES.forEach((side) => validate(input, side, actions[side]));
  const state = structuredClone(input);
  const events: BattleEvent[] = [];
  const forfeits = SIDES.filter((side) => actions[side]?.kind === 'forfeit');
  if (forfeits.length > 0) {
    state.phase = 'ended';
    state.winner = forfeits.length === 2 ? 'draw' : otherSide(forfeits[0]!);
    emit(state, events, 'end', state.winner === 'draw' ? 0 : state.winner,
      state.winner === 'draw' ? 'Both players forfeited.' : `${state.teams[state.winner].name} won by forfeit!`);
    return { state, events };
  }

  const freeSwitch = state.phase === 'switch';
  if (!freeSwitch) state.turn += 1;
  const ordered = [...SIDES].filter((side) => actions[side] !== null);
  if (ordered.length === 2) {
    const rank = (side: Side): number => {
      const action = actions[side];
      return action?.kind === 'switch' ? 1000 : action?.kind === 'move'
        ? selectedMove(state, side, action.slot).priority : -1000;
    };
    const difference = rank(0) - rank(1)
      || effectiveSpeed(activePokemon(state, 0)) - effectiveSpeed(activePokemon(state, 1));
    if (difference < 0 || (difference === 0 && chance(state, 0.5))) ordered.reverse();
  }
  for (const [index, side] of ordered.entries()) {
    const action = actions[side];
    if (action?.kind === 'switch') switchPokemon(state, events, side, action.slot);
    if (action?.kind === 'move') executeMove(state, events, side, action.slot,
      index === 0 && actions[otherSide(side)]?.kind === 'move');
  }
  if (!freeSwitch) {
    for (const side of SIDES) residualDamage(state, events, side);
    for (const side of SIDES) activePokemon(state, side).flinched = false;
  }
  updatePhase(state, events);
  return { state, events };
}
