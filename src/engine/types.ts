export type Side = 0 | 1;
export type Stat = 'hp' | 'attack' | 'defense' | 'specialAttack' | 'specialDefense' | 'speed';
export type StageStat = Exclude<Stat, 'hp'> | 'accuracy' | 'evasion';
export type Stats = Record<Stat, number>;
export type Stages = Record<StageStat, number>;
export type Status = 'burn' | 'poison' | 'toxic' | 'paralysis' | 'sleep' | 'freeze';
export type Ailment = Status | 'confusion';
export type TypeChart = Record<string, Record<string, 0 | 0.5 | 1 | 2>>;

export interface Move {
  name: string;
  type: string;
  damageClass: 'physical' | 'special' | 'status';
  power: number | null;
  accuracy: number | null;
  pp: number;
  maxPp: number;
  priority: number;
  target?: 'self' | 'opponent';
  shortEffect?: string;
  critRate?: number;
  minHits?: number;
  maxHits?: number;
  ailment?: Ailment;
  ailmentChance?: number;
  flinchChance?: number;
  statChanges?: Array<{ stat: StageStat; change: number }>;
  statTarget?: 'self' | 'opponent';
  statChance?: number;
  drain?: number;
  healing?: number;
}

export interface Pokemon {
  name: string;
  types: string[];
  level: number;
  stats: Stats;
  hp: number;
  stages: Stages;
  moves: Move[];
  status: Status | null;
  sleepTurns: number;
  toxicCounter: number;
  confusionTurns: number;
  flinched: boolean;
}

export interface Team {
  name: string;
  pokemon: Pokemon[];
  active: number;
}

export type Action =
  | { kind: 'move'; slot: number }
  | { kind: 'switch'; slot: number }
  | { kind: 'forfeit' };

export type EventKind = 'move' | 'damage' | 'heal' | 'miss' | 'critical' | 'effectiveness'
  | 'status' | 'stage' | 'faint' | 'switch' | 'unable' | 'end' | 'hits';

export interface BattleEvent {
  turn: number;
  kind: EventKind;
  side: Side;
  message: string;
  amount?: number;
  teams?: [Team, Team];
  move?: Move;
}

export interface BattleState {
  teams: [Team, Team];
  chart: TypeChart;
  rng: number;
  turn: number;
  phase: 'turn' | 'switch' | 'ended';
  winner: Side | 'draw' | null;
}

export interface TurnResult {
  state: BattleState;
  events: BattleEvent[];
}

export const otherSide = (side: Side): Side => side === 0 ? 1 : 0;

/**
 * Display form of a PokéAPI identifier: "mr-mime" -> "Mr Mime". Names stay in
 * their API form on the state so sprite lookups remain keyed correctly; this is
 * only for text a player reads.
 */
export const label = (value: string): string => value
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/[-_]/g, ' ')
  .replace(/(^|\s)(\p{Ll})/gu, (_match, lead: string, letter: string) => lead + letter.toUpperCase());

export function activePokemon(state: BattleState, side: Side): Pokemon {
  const team = state.teams[side];
  const pokemon = team.pokemon[team.active];
  if (!pokemon) throw new Error(`Invalid active slot for side ${side}`);
  return pokemon;
}

export function emit(state: BattleState, events: BattleEvent[], kind: EventKind, side: Side,
  message: string, amount?: number): void {
  events.push({ turn: state.turn, kind, side, message, amount, teams: structuredClone(state.teams) });
}
