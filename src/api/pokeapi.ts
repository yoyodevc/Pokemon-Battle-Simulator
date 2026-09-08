import type { PokeApiClient } from './client';
import type { Move, NamedAPIResourceList, Pokemon, TypeInfo } from './types';

/** Highest national dex number covered by the picker. */
export const NATIONAL_DEX_LIMIT = 1025;

export function getPokemon(client: PokeApiClient, idOrName: string | number): Promise<Pokemon> {
  return client.get<Pokemon>(`pokemon/${idOrName}`);
}

export function getMove(client: PokeApiClient, idOrNameOrUrl: string | number): Promise<Move> {
  const path =
    typeof idOrNameOrUrl === 'string' && idOrNameOrUrl.startsWith('http')
      ? idOrNameOrUrl
      : `move/${idOrNameOrUrl}`;
  return client.get<Move>(path);
}

export function getType(client: PokeApiClient, idOrName: string | number): Promise<TypeInfo> {
  return client.get<TypeInfo>(`type/${idOrName}`);
}

/** National dex listing used to populate the team-builder picker. */
export function getPokemonIndex(
  client: PokeApiClient,
  limit: number = NATIONAL_DEX_LIMIT,
  offset = 0,
): Promise<NamedAPIResourceList> {
  return client.get<NamedAPIResourceList>(`pokemon?limit=${limit}&offset=${offset}`);
}

export function getTypeIndex(client: PokeApiClient): Promise<NamedAPIResourceList> {
  return client.get<NamedAPIResourceList>('type?limit=100');
}

/**
 * Extracts the trailing numeric id from a PokéAPI resource URL.
 * Example: "https://pokeapi.co/api/v2/pokemon/25/" -> 25
 */
export function resourceId(url: string): number {
  const match = /\/(\d+)\/?$/.exec(url);
  if (match?.[1] === undefined) {
    throw new Error(`Cannot extract resource id from URL: ${url}`);
  }
  return Number.parseInt(match[1], 10);
}

/**
 * Thumbnail URL built directly from a dex id. Used by the picker so that listing 1025
 * Pokémon costs one request rather than 1025.
 */
export function spriteUrlForId(id: number): string {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
}

/** Prefers the animated Showdown sprite, falling back to the static game sprite. */
export function battleSprite(pokemon: Pokemon, facing: 'front' | 'back'): string | null {
  const showdown = pokemon.sprites.other?.showdown;
  const animated = facing === 'front' ? showdown?.front_default : showdown?.back_default;
  if (animated) return animated;
  return facing === 'front' ? pokemon.sprites.front_default : pokemon.sprites.back_default;
}

/** Large artwork used in the team builder. */
export function artworkSprite(pokemon: Pokemon): string | null {
  return pokemon.sprites.other?.['official-artwork']?.front_default ?? pokemon.sprites.front_default;
}
