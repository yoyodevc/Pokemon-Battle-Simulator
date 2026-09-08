import { pokeApi } from './client';
import { getPokemon, getPokemonIndex, resourceId, spriteUrlForId } from './pokeapi';
import { selectMoveset } from './moveSelect';
import { toBattlePokemon } from './battleData';
import { loadTypeChart } from './typeChart';
import { createBattle } from '../engine/turn';
import type { Team } from '../engine/types';
import type { Pokemon } from './types';

export type BattleMode = 'cpu' | 'local';

export const DEFAULT_PLAYER_TEAM = ['charizard', 'pikachu', 'venusaur', 'blastoise', 'gengar', 'arcanine'];
export const DEFAULT_ENEMY_TEAM = ['blastoise', 'gengar', 'arcanine', 'venusaur', 'dragonite', 'snorlax'];

/** Presets use fully evolved, broad-role Pokémon so the simulator feels good without items or abilities. */
export const COMPETITIVE_PLAYER_TEAM = ['garchomp', 'starmie', 'corviknight', 'volcarona', 'dragapult', 'ferrothorn'];
export const COMPETITIVE_ENEMY_TEAM = ['gliscor', 'heatran', 'toxapex', 'excadrill', 'clefable', 'tyranitar'];

/** Curated viable pool for random battles; it intentionally excludes unevolved filler. */
export const VIABLE_RANDOM_POOL = [
  'charizard', 'venusaur', 'blastoise', 'gengar', 'arcanine', 'dragonite', 'tyranitar',
  'metagross', 'garchomp', 'lucario', 'salamence', 'milotic', 'scizor', 'excadrill',
  'volcarona', 'hydreigon', 'aegislash', 'goodra', 'corviknight', 'dragapult', 'toxapex',
  'ferrothorn', 'gliscor', 'greninja', 'mimikyu', 'kingambit', 'gardevoir', 'swampert',
  'gallade', 'weavile', 'magnezone', 'conkeldurr', 'azumarill', 'breloom', 'infernape',
  'chandelure', 'rotom-wash', 'rotom-heat', 'alakazam', 'umbreon', 'ninetales',
];

function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap]!, result[index]!];
  }
  return result;
}

/** Creates two distinct random teams from the curated viable pool and the loaded dex. */
export function createRandomTeams(availableNames: readonly string[], random: () => number = Math.random): [string[], string[]] {
  const available = new Set(availableNames);
  const preferred = VIABLE_RANDOM_POOL.filter((name) => available.has(name));
  const fallback = availableNames.filter((name) => !preferred.includes(name));
  const pool = [...preferred, ...fallback];
  if (pool.length < 12) throw new Error('At least twelve Pokémon are required to randomize both teams.');
  const selected = shuffle(pool, random).slice(0, 12);
  return [selected.slice(0, 6), selected.slice(6, 12)];
}

export interface PickerPokemon { id: number; name: string; url: string; sprite: string }

export async function loadPokemonPicker(): Promise<PickerPokemon[]> {
  const index = await getPokemonIndex(pokeApi);
  return index.results.map((entry) => {
    const id = resourceId(entry.url);
    return { id, name: entry.name, url: entry.url, sprite: spriteUrlForId(id) };
  });
}

export async function loadBattle(
  playerRoster: readonly string[] = DEFAULT_PLAYER_TEAM,
  enemyRoster: readonly string[] = DEFAULT_ENEMY_TEAM,
  mode: BattleMode = 'cpu',
  seed = 1,
) {
  if (playerRoster.length !== 6 || enemyRoster.length !== 6) {
    throw new Error('Each team must contain exactly six Pokémon.');
  }
  const sprites: Record<string, Pokemon> = {};
  const [chart, teams] = await Promise.all([
    loadTypeChart(pokeApi),
    Promise.all([playerRoster, enemyRoster].map(async (roster, side): Promise<Team> => ({
      name: mode === 'cpu' ? (side === 0 ? 'You' : 'CPU Rival') : `Player ${side + 1}`,
      active: 0,
      pokemon: await Promise.all(roster.map(async (name) => {
        const pokemon = await getPokemon(pokeApi, name);
        // Give the selector enough of the learnset to compare reliable STAB,
        // coverage, and utility instead of accepting the first late-level moves.
        const details = await selectMoveset(pokemon, pokeApi, { candidatePoolSize: 24 });
        if (details.length === 0) throw new Error(`No battle moves found for ${name}.`);
        sprites[name] = pokemon;
        return toBattlePokemon(pokemon, details);
      })),
    }))),
  ]);
  return { initial: createBattle([teams[0]!, teams[1]!], chart, seed), sprites, mode };
}
