import { accuracyChance, calculateDamage, effectiveness } from '../engine/damage';
import { randInt, type RandomState } from '../engine/rng';
import { activePokemon, type Action, type BattleState, type Move, type Pokemon } from '../engine/types';
import { legalActions } from '../engine/turn';

export type CpuDifficulty = 'rookie' | 'trainer' | 'ace';

export const CPU_DIFFICULTIES: readonly { id: CpuDifficulty; label: string; description: string }[] = [
  { id: 'rookie', label: 'Rookie', description: 'Random choices, no matchup planning' },
  { id: 'trainer', label: 'Trainer', description: 'Spots type edges, but plays imperfectly' },
  { id: 'ace', label: 'Ace', description: 'Calculates KOs, risk, and smart switches' },
];

function moveForAction(pokemon: Pokemon, action: Action): Move | null {
  return action.kind === 'move' ? action.slot === -1 ? null : pokemon.moves[action.slot] ?? null : null;
}

function matchupMultiplier(state: BattleState, pokemon: Pokemon, target: Pokemon): number {
  return pokemon.moves.reduce((best, move) => {
    if (move.power === null || move.damageClass === 'status' || move.target === 'self') return best;
    return Math.max(best, effectiveness(state.chart, move.type, target.types));
  }, 0);
}

function averageHitCount(move: Move): number {
  const min = move.minHits ?? 1;
  const max = move.maxHits ?? min;
  return (min + max) / 2;
}

function expectedDamage(state: BattleState, attacker: Pokemon, defender: Pokemon, move: Move): number {
  if (move.power === null || move.damageClass === 'status' || move.target === 'self') return 0;
  const accuracy = accuracyChance(attacker, defender, move);
  return calculateDamage(attacker, defender, move, state.chart, false, 92).damage
    * averageHitCount(move) * accuracy;
}

/**
 * Trainer uses a readable battlefield heuristic: power, STAB, and type advantage.
 * Ace uses expected damage plus explicit KO, accuracy, survival, and utility logic.
 * Keeping these as different models makes the difficulty choice perceptible in play.
 */
function scoreMove(state: BattleState, action: Action, difficulty: CpuDifficulty): number {
  if (action.kind !== 'move') return -Infinity;
  const attacker = activePokemon(state, 1);
  const defender = activePokemon(state, 0);
  const move = moveForAction(attacker, action);
  if (!move) return attacker.moves.every((candidate) => candidate.pp === 0) ? 25 : -40;

  const multiplier = move.target === 'self' || move.power === null
    ? 1 : effectiveness(state.chart, move.type, defender.types);
  if (multiplier === 0) return -1000;
  const accuracy = move.accuracy === null ? 1 : move.accuracy / 100;
  const stab = attacker.types.includes(move.type) ? 1 : 0;
  const damage = expectedDamage(state, attacker, defender, move);
  const highRoll = move.power === null ? 0
    : calculateDamage(attacker, defender, move, state.chart, false, 100).damage * averageHitCount(move);

  if (difficulty === 'trainer') {
    let score = move.power === null ? 20 : (move.power ?? 0) * accuracy;
    score += stab * 12;
    if (multiplier > 1) score += 34 * multiplier;
    if (multiplier < 1) score -= 18;
    if (move.priority > 0) score += 5;
    if (move.ailment) score += 10 + (move.ailmentChance ?? 0) * 0.05;
    if (move.statChanges?.some((change) => change.change > 0 && (move.statTarget ?? move.target) === 'self')) score += 8;
    return score;
  }

  let score = move.power === null ? 22 : damage;
  score += stab * 14;
  if (multiplier > 1) score += 32 * multiplier;
  if (multiplier < 1) score -= 28;
  if (move.accuracy !== null && move.accuracy < 90) score -= (90 - move.accuracy) * 0.35;
  if (move.priority > 0 && attacker.hp <= defender.hp) score += 12;
  if (move.ailment) score += 10 + (move.ailmentChance ?? 0) * 0.08;
  if (move.statChanges?.some((change) => change.change > 0 && (move.statTarget ?? move.target) === 'self')) score += 12;
  if (move.healing && attacker.hp < attacker.stats.hp * 0.55) {
    score += 40 + (1 - attacker.hp / attacker.stats.hp) * 70;
  }
  if (move.power !== null && damage >= defender.hp) score += 280;
  else if (move.power !== null && highRoll >= defender.hp) score += 110;
  return score;
}

function scoreSwitch(state: BattleState, action: Action): number {
  if (action.kind !== 'switch') return -Infinity;
  const replacement = state.teams[1].pokemon[action.slot];
  if (!replacement) return -Infinity;
  const target = activePokemon(state, 0);
  const current = activePokemon(state, 1);
  const replacementMatchup = matchupMultiplier(state, replacement, target);
  const currentMatchup = matchupMultiplier(state, current, target);
  const health = replacement.hp / Math.max(1, replacement.stats.hp);
  const speedEdge = replacement.stats.speed >= target.stats.speed ? 8 : 0;
  return replacementMatchup * 48 + health * 24 + speedEdge - currentMatchup * 30;
}

function rankedSwitches(state: BattleState, actions: readonly Action[]) {
  return actions
    .filter((action): action is Extract<Action, { kind: 'switch' }> => action.kind === 'switch')
    .map((action) => ({ action, score: scoreSwitch(state, action) }))
    .sort((left, right) => right.score - left.score);
}

/** Chooses a CPU action without changing the battle state. RNG is owned by the reducer. */
export function chooseCpuAction(state: BattleState, difficulty: CpuDifficulty, rng: RandomState): Action | null {
  const actions = legalActions(state, 1).filter((action) => action.kind !== 'forfeit');
  if (actions.length === 0) return null;

  const switches = rankedSwitches(state, actions);
  if (state.phase === 'switch') {
    if (difficulty === 'rookie') return actions[randInt(rng, 0, actions.length - 1)] ?? null;
    if (difficulty === 'trainer') {
      const shortlist = switches.slice(0, Math.min(2, switches.length));
      return shortlist[randInt(rng, 0, Math.max(0, shortlist.length - 1))]?.action ?? actions[0] ?? null;
    }
    return switches[0]?.action ?? actions[0] ?? null;
  }

  const moves = actions.filter((action): action is Extract<Action, { kind: 'move' }> => action.kind === 'move');
  if (moves.length === 0) return switches[0]?.action ?? actions[0] ?? null;
  if (difficulty === 'rookie') return actions[randInt(rng, 0, actions.length - 1)] ?? null;

  const rankedMoves = moves
    .map((action) => ({ action, score: scoreMove(state, action, difficulty) }))
    .sort((left, right) => right.score - left.score);
  const bestMove = rankedMoves[0];
  const target = activePokemon(state, 0);
  const current = activePokemon(state, 1);
  const currentMatchup = matchupMultiplier(state, current, target);
  const bestReplacement = switches[0];
  const replacement = bestReplacement ? state.teams[1].pokemon[bestReplacement.action.slot] : undefined;
  const replacementMatchup = replacement ? matchupMultiplier(state, replacement, target) : 0;
  const healthRatio = current.hp / Math.max(1, current.stats.hp);

  if (bestReplacement && replacement && difficulty === 'trainer') {
    const badMatchup = currentMatchup > 0 && currentMatchup <= 0.5 && replacementMatchup >= 1.5;
    const desperate = healthRatio <= 0.2 && replacementMatchup > currentMatchup;
    if ((badMatchup || desperate) && randInt(rng, 0, 99) < 45) return bestReplacement.action;
  }

  if (bestReplacement && replacement && difficulty === 'ace') {
    const badMatchup = currentMatchup === 0 || (currentMatchup <= 0.5 && replacementMatchup >= 1.5);
    const lowHealth = healthRatio <= 0.25 && replacement.hp / Math.max(1, replacement.stats.hp) >= 0.45;
    const moveIsUnlikelyToFinish = (bestMove?.score ?? 0) < target.hp * 0.72;
    if ((badMatchup && moveIsUnlikelyToFinish) || (lowHealth && replacementMatchup > currentMatchup)) {
      return bestReplacement.action;
    }
  }

  if (difficulty === 'trainer') {
    // Trainers recognize the right neighborhood, but they do not always take the
    // mathematically best button. The wider shortlist makes this visible.
    const bestScore = bestMove?.score ?? 0;
    const shortlist = rankedMoves
      .filter((candidate) => candidate.score >= bestScore - Math.max(10, Math.abs(bestScore) * 0.2))
      .slice(0, 3);
    return shortlist[randInt(rng, 0, Math.max(0, shortlist.length - 1))]?.action ?? moves[0] ?? null;
  }

  return bestMove?.action ?? moves[0] ?? null;
}
