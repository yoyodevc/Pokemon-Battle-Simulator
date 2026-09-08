import { describe, expect, it } from 'vitest';
import { accuracyChance, calculateDamage, criticalChance, effectiveness, hitCount, rollDamage } from './damage.ts';
import { DEMO_CHART, makeMove, makePokemon } from './fixtures.ts';
import { random, randInt, seedFromQuery } from './rng.ts';
import { calculateStat, changeStage, effectiveSpeed, stageMultiplier } from './stats.ts';
import { applyAilment, canAct, residualDamage, resetOnSwitch } from './status.ts';
import { createBattle } from './turn.ts';
import type { Ailment, BattleEvent, Status } from './types.ts';

function battle() {
  return createBattle([
    { name: 'A', active: 0, pokemon: [makePokemon('A')] },
    { name: 'B', active: 0, pokemon: [makePokemon('B')] },
  ], DEMO_CHART, 1);
}

describe('stats and stages', () => {
  it('matches level 50 Pikachu stats', () => {
    expect(calculateStat(35, true)).toBe(110);
    expect(calculateStat(55, false)).toBe(75);
    expect(calculateStat(90, false)).toBe(110);
  });
  it('supports configurable level, IV, EV and nature with flooring', () => {
    expect(calculateStat(55, false, { level: 73, iv: 30, ev: 251, nature: 1.1 })).toBe(167);
    expect(calculateStat(35, true, { level: 100, iv: 0, ev: 0 })).toBe(180);
  });
  it('uses different combat and accuracy stage ratios', () => {
    expect(stageMultiplier(2)).toBe(2);
    expect(stageMultiplier(-2)).toBe(0.5);
    expect(stageMultiplier(3, true)).toBe(2);
    expect(stageMultiplier(-3, true)).toBe(0.5);
    expect(stageMultiplier(9)).toBe(4);
    expect(stageMultiplier(-9)).toBe(0.25);
  });
  it('clamps accumulated stages and applies paralysis after speed stages', () => {
    const pokemon = makePokemon('A');
    changeStage(pokemon, 'speed', 9);
    expect(pokemon.stages.speed).toBe(6);
    pokemon.status = 'paralysis';
    expect(effectiveSpeed(pokemon)).toBe(200);
    expect(changeStage(pokemon, 'speed', -20)).toBe(-12);
  });
});

describe('damage and accuracy', () => {
  it('matches known damage and seed 1 rolls', () => {
    const attacker = makePokemon('A');
    const defender = makePokemon('B');
    const move = makeMove({ power: 100 });
    expect(calculateDamage(attacker, defender, move, DEMO_CHART).damage).toBe(69);
    expect(rollDamage(attacker, defender, move, DEMO_CHART, { rng: 1 })).toEqual({
      damage: 58, critical: false, effectiveness: 1,
    });
  });
  it('ignores only unfavorable offensive and defensive stages on critical hits', () => {
    const attacker = makePokemon('A');
    const defender = makePokemon('B');
    attacker.stages.attack = -6;
    defender.stages.defense = 6;
    expect(calculateDamage(attacker, defender, makeMove({ power: 100 }), {}, true).damage).toBe(103);
    attacker.stages.attack = 2;
    defender.stages.defense = -2;
    expect(calculateDamage(attacker, defender, makeMove({ power: 100 }), {}, true).damage).toBe(400);
  });
  it('uses special stats independently and halves only physical burned damage', () => {
    const attacker = makePokemon('A');
    const defender = makePokemon('B');
    attacker.status = 'burn';
    attacker.stages.attack = -6;
    const special = makeMove({ power: 100, damageClass: 'special' });
    expect(calculateDamage(attacker, defender, special, {}).damage).toBe(69);
    attacker.stages.attack = 0;
    expect(calculateDamage(attacker, defender, makeMove({ power: 100 }), {}).damage).toBe(34);
  });
  it('returns zero for immunities and at least one for nonimmune hits', () => {
    const attacker = makePokemon('A', ['water']);
    const defender = makePokemon('B', ['ground']);
    expect(calculateDamage(attacker, defender, makeMove({ type: 'electric' }), DEMO_CHART).damage).toBe(0);
    attacker.stages.attack = -6;
    defender.stages.defense = 6;
    expect(calculateDamage(attacker, defender, makeMove({ power: 1 }), {}).damage).toBe(2);
    attacker.status = 'burn';
    expect(calculateDamage(attacker, defender, makeMove({ power: 1 }), {}, false, 85).damage).toBe(1);
  });
  it('multiplies dual types including immunity', () => {
    expect(effectiveness({ rock: { fire: 2, flying: 2 } }, 'rock', ['fire', 'flying'])).toBe(4);
    expect(effectiveness({ ground: { steel: 2, flying: 0 } }, 'ground', ['steel', 'flying'])).toBe(0);
    expect(effectiveness(DEMO_CHART, 'water', ['fire'])).toBe(2);
    expect(effectiveness(DEMO_CHART, 'ghost', ['normal'])).toBe(0);
    expect(effectiveness(DEMO_CHART, 'fighting', ['steel'])).toBe(2);
  });
  it('applies accuracy/evasion stages, with null accuracy always hitting', () => {
    const attacker = makePokemon('A');
    const defender = makePokemon('B');
    attacker.stages.accuracy = -3;
    defender.stages.evasion = 3;
    expect(accuracyChance(attacker, defender, makeMove({ accuracy: 80 }))).toBe(0.2);
    expect(accuracyChance(attacker, defender, makeMove({ accuracy: null }))).toBe(1);
  });
  it('implements all critical-rate stages', () => {
    expect([0, 1, 2, 3].map(criticalChance)).toEqual([1 / 24, 1 / 8, 0.5, 1]);
  });
  it('uses the 35/35/15/15 multi-hit distribution', () => {
    const counts = [0, 0, 0, 0];
    const rng = { rng: 42 };
    for (let i = 0; i < 10000; i += 1) {
      const index = hitCount(makeMove({ minHits: 2, maxHits: 5 }), rng) - 2;
      counts[index] = (counts[index] ?? 0) + 1;
    }
    expect(counts[0]).toBeGreaterThan(3300);
    expect(counts[0]).toBeLessThan(3700);
    expect(counts[1]).toBeGreaterThan(3300);
    expect(counts[1]).toBeLessThan(3700);
    expect(counts[2]).toBeGreaterThan(1300);
    expect(counts[2]).toBeLessThan(1700);
    expect(counts[3]).toBeGreaterThan(1300);
    expect(counts[3]).toBeLessThan(1700);
  });
});

describe('statuses', () => {
  it.each<[Status, number]>([['burn', 9], ['poison', 19], ['toxic', 9]])(
    '%s deals floored residual damage', (status, expected) => {
      const state = battle();
      const pokemon = state.teams[0].pokemon[0]!;
      pokemon.status = status;
      const events: BattleEvent[] = [];
      residualDamage(state, events, 0);
      expect(pokemon.hp).toBe(pokemon.stats.hp - expected);
    });
  it('increments toxic damage and resets its counter but preserves status on switching', () => {
    const state = battle();
    const pokemon = state.teams[0].pokemon[0]!;
    pokemon.status = 'toxic';
    residualDamage(state, [], 0);
    residualDamage(state, [], 0);
    expect(pokemon.hp).toBe(127);
    pokemon.confusionTurns = 4;
    pokemon.stages.attack = 4;
    pokemon.flinched = true;
    resetOnSwitch(pokemon);
    expect(pokemon).toMatchObject({ status: 'toxic', toxicCounter: 1, confusionTurns: 0, flinched: false });
    expect(pokemon.stages.attack).toBe(0);
  });
  it.each<[Ailment, string]>([['burn', 'fire'], ['poison', 'poison'], ['toxic', 'steel'],
    ['paralysis', 'electric'], ['freeze', 'ice']])('%s respects %s immunity', (ailment, type) => {
    const state = battle();
    state.teams[0].pokemon[0]!.types = [type];
    expect(applyAilment(state, [], 0, ailment)).toBe(false);
  });
  it('permits only one major status but allows confusion alongside it', () => {
    const state = battle();
    expect(applyAilment(state, [], 0, 'burn')).toBe(true);
    expect(applyAilment(state, [], 0, 'poison')).toBe(false);
    expect(applyAilment(state, [], 0, 'confusion')).toBe(true);
  });
  it('sleep prevents exactly the rolled number of actions', () => {
    const state = battle();
    applyAilment(state, [], 0, 'sleep');
    const turns = state.teams[0].pokemon[0]!.sleepTurns;
    expect(turns).toBeGreaterThanOrEqual(1);
    expect(turns).toBeLessThanOrEqual(3);
    for (let i = 0; i < turns; i += 1) expect(canAct(state, [], 0)).toBe(false);
    expect(canAct(state, [], 0)).toBe(true);
    expect(state.teams[0].pokemon[0]!.status).toBeNull();
  });
  it('freeze can block then thaw with deterministic rolls', () => {
    const state = battle();
    state.teams[0].pokemon[0]!.status = 'freeze';
    expect(canAct(state, [], 0)).toBe(false);
    expect(canAct(state, [], 0)).toBe(true);
  });
  it('paralysis blocks a low roll and confusion expires without persisting', () => {
    const state = battle();
    const pokemon = state.teams[0].pokemon[0]!;
    pokemon.status = 'paralysis';
    random(state);
    expect(canAct(state, [], 0)).toBe(false);
    pokemon.status = null;
    pokemon.confusionTurns = 1;
    state.rng = 1;
    random(state);
    expect(canAct(state, [], 0)).toBe(false);
    expect(pokemon.hp).toBeLessThan(pokemon.stats.hp);
    expect(pokemon.confusionTurns).toBe(0);
    expect(canAct(state, [], 0)).toBe(true);
  });
});

describe('RNG', () => {
  it('matches mulberry32 reference output and replays independently', () => {
    expect(random({ rng: 1 })).toBe(0.6270739405881613);
    const a = { rng: 100 };
    const b = { rng: 100 };
    expect(Array.from({ length: 20 }, () => randInt(a, 85, 100)))
      .toEqual(Array.from({ length: 20 }, () => randInt(b, 85, 100)));
  });
  it('reads seed query parameters without browser state', () => {
    expect(seedFromQuery('?seed=42')).toBe(42);
    expect(seedFromQuery('?seed=0')).toBe(0);
    expect(seedFromQuery('?seed=bad', 9)).toBe(9);
    expect(seedFromQuery('', 9)).toBe(9);
  });
});
