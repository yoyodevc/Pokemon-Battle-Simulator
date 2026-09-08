import { confusionDamage } from './damage.ts';
import { chance, randInt } from './rng.ts';
import { emptyStages } from './stats.ts';
import { activePokemon, emit, label, type Ailment, type BattleEvent, type BattleState, type Pokemon, type Side } from './types.ts';

export function damageHp(state: BattleState, events: BattleEvent[], side: Side, amount: number): number {
  const pokemon = activePokemon(state, side);
  const actual = Math.min(pokemon.hp, Math.max(0, Math.floor(amount)));
  if (actual === 0) return 0;
  pokemon.hp -= actual;
  emit(state, events, 'damage', side, `${label(pokemon.name)} lost ${actual} HP.`, actual);
  if (pokemon.hp === 0) emit(state, events, 'faint', side, `${label(pokemon.name)} fainted!`);
  return actual;
}

export function healHp(state: BattleState, events: BattleEvent[], side: Side, amount: number): void {
  const pokemon = activePokemon(state, side);
  if (pokemon.hp === 0) return;
  const actual = Math.min(pokemon.stats.hp - pokemon.hp, Math.max(0, Math.floor(amount)));
  if (actual === 0) return;
  pokemon.hp += actual;
  emit(state, events, 'heal', side, `${label(pokemon.name)} restored ${actual} HP.`, actual);
}

export function applyAilment(state: BattleState, events: BattleEvent[], side: Side, ailment: Ailment): boolean {
  const pokemon = activePokemon(state, side);
  if (pokemon.hp === 0) return false;
  if (ailment === 'confusion') {
    if (pokemon.confusionTurns > 0) return false;
    pokemon.confusionTurns = randInt(state, 2, 5);
  } else {
    if (pokemon.status !== null) return false;
    const immune = ailment === 'burn' ? ['fire'] : ailment === 'paralysis' ? ['electric']
      : ailment === 'freeze' ? ['ice'] : ailment === 'poison' || ailment === 'toxic' ? ['poison', 'steel'] : [];
    if (pokemon.types.some((type) => immune.includes(type))) return false;
    pokemon.status = ailment;
    if (ailment === 'sleep') pokemon.sleepTurns = randInt(state, 1, 3);
    if (ailment === 'toxic') pokemon.toxicCounter = 1;
  }
  emit(state, events, 'status', side, `${label(pokemon.name)} gained ${ailment}.`);
  return true;
}

export function canAct(state: BattleState, events: BattleEvent[], side: Side): boolean {
  const pokemon = activePokemon(state, side);
  const blocked = (message: string): false => {
    emit(state, events, 'unable', side, `${label(pokemon.name)} ${message}`);
    return false;
  };
  if (pokemon.flinched) return blocked('flinched!');
  if (pokemon.status === 'freeze') {
    if (!chance(state, 0.2)) return blocked('is frozen solid!');
    pokemon.status = null;
    emit(state, events, 'status', side, `${label(pokemon.name)} thawed out!`);
  }
  if (pokemon.status === 'sleep') {
    if (pokemon.sleepTurns > 0) {
      pokemon.sleepTurns -= 1;
      return blocked('is fast asleep!');
    }
    pokemon.status = null;
    emit(state, events, 'status', side, `${label(pokemon.name)} woke up!`);
  }
  if (pokemon.status === 'paralysis' && chance(state, 0.25)) return blocked('is fully paralyzed!');
  if (pokemon.confusionTurns > 0) {
    pokemon.confusionTurns -= 1;
    if (chance(state, 1 / 3)) {
      blocked('hurt itself in confusion!');
      damageHp(state, events, side, confusionDamage(pokemon, state));
      return false;
    }
  }
  return true;
}

export function residualDamage(state: BattleState, events: BattleEvent[], side: Side): void {
  const pokemon = activePokemon(state, side);
  if (pokemon.hp === 0) return;
  const fraction = pokemon.status === 'burn' ? 1 / 16 : pokemon.status === 'poison' ? 1 / 8
    : pokemon.status === 'toxic' ? pokemon.toxicCounter / 16 : 0;
  if (fraction === 0) return;
  emit(state, events, 'status', side, `${label(pokemon.name)} is hurt by ${pokemon.status}!`);
  damageHp(state, events, side, Math.max(1, Math.floor(pokemon.stats.hp * fraction)));
  if (pokemon.status === 'toxic') pokemon.toxicCounter += 1;
}

export function resetOnSwitch(pokemon: Pokemon): void {
  pokemon.stages = emptyStages();
  pokemon.confusionTurns = 0;
  pokemon.flinched = false;
  pokemon.toxicCounter = 1;
}
