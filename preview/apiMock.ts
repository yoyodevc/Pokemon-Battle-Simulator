/**
 * Offline PokéAPI stand-in for the design sandbox. The cloud environment used to
 * iterate on this UI cannot reach pokeapi.co, so `preview.html` installs this
 * shim to render the Pokédex and team-select screens with plausible data.
 * Nothing here ships: `vite build` only reads index.html.
 */
import { PREVIEW_CHART, SPECS } from './fixtures';

const BASE = 'https://pokeapi.co/api/v2/';
const SPRITES = import.meta.glob('./sprites/**/*.gif', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const sprite = (path: string): string | null => SPRITES[`./sprites/${path}`] ?? null;

const TYPES = Object.keys(PREVIEW_CHART);
const typeUrl = (name: string) => `${BASE}type/${TYPES.indexOf(name) + 1}/`;
const moveUrl = (name: string) => `${BASE}move/${name.replaceAll(' ', '-')}/`;
const named = (name: string, url: string) => ({ name, url });

const STAT_KEYS = [
  ['hp', 'hp'], ['attack', 'attack'], ['defense', 'defense'],
  ['special-attack', 'specialAttack'], ['special-defense', 'specialDefense'], ['speed', 'speed'],
] as const;

function pokemonPayload(spec: (typeof SPECS)[number]) {
  return {
    id: spec.id,
    name: spec.name,
    height: 17,
    weight: 905,
    stats: STAT_KEYS.map(([apiName, key]) => ({
      base_stat: spec.base[key], effort: 0, stat: named(apiName, `${BASE}stat/1/`),
    })),
    types: spec.types.map((type, index) => ({ slot: index + 1, type: named(type, typeUrl(type)) })),
    moves: spec.moves.map((move, index) => ({
      move: named(move.name.replaceAll(' ', '-'), moveUrl(move.name)),
      version_group_details: [{
        level_learned_at: 12 + index * 6,
        move_learn_method: named('level-up', `${BASE}move-learn-method/1/`),
        version_group: named('scarlet-violet', `${BASE}version-group/25/`),
      }],
    })),
    sprites: {
      front_default: sprite(`${spec.id}.gif`),
      back_default: sprite(`back/${spec.id}.gif`),
      front_shiny: null,
      back_shiny: null,
      other: {
        'official-artwork': { front_default: sprite(`${spec.id}.gif`) },
        showdown: { front_default: sprite(`${spec.id}.gif`), back_default: sprite(`back/${spec.id}.gif`) },
      },
    },
    cries: { latest: null, legacy: null },
  };
}

function movePayload(slug: string) {
  const spec = SPECS.flatMap((entry) => entry.moves).find((move) => move.name.replaceAll(' ', '-') === slug);
  const move = spec ?? { name: slug.replaceAll('-', ' '), type: 'normal' as const };
  const damageClass = ('damageClass' in move ? move.damageClass : 'physical') ?? 'physical';
  const power = 'power' in move ? move.power ?? null : 60;
  return {
    id: 1,
    name: slug,
    accuracy: ('accuracy' in move ? move.accuracy : 100) ?? 100,
    power,
    pp: ('pp' in move ? move.pp : 20) ?? 20,
    priority: ('priority' in move ? move.priority : 0) ?? 0,
    damage_class: named(damageClass, `${BASE}move-damage-class/2/`),
    type: named(move.type, typeUrl(move.type)),
    effect_chance: null,
    target: named(('target' in move && move.target === 'self') ? 'user' : 'selected-pokemon', `${BASE}move-target/10/`),
    meta: {
      ailment: named(('ailment' in move && move.ailment) ? move.ailment : 'none', `${BASE}move-ailment/0/`),
      ailment_chance: ('ailmentChance' in move ? move.ailmentChance : 0) ?? 0,
      category: named('damage', `${BASE}move-category/0/`),
      crit_rate: ('critRate' in move ? move.critRate : 0) ?? 0,
      drain: ('drain' in move ? move.drain : 0) ?? 0,
      flinch_chance: ('flinchChance' in move ? move.flinchChance : 0) ?? 0,
      healing: ('healing' in move ? move.healing : 0) ?? 0,
      max_hits: null, max_turns: null, min_hits: null, min_turns: null, stat_chance: 0,
    },
    stat_changes: [],
    effect_entries: [{
      effect: 'Inflicts regular damage.',
      short_effect: ('shortEffect' in move ? move.shortEffect : '') || 'Inflicts regular damage.',
      language: named('en', `${BASE}language/9/`),
    }],
  };
}

function typePayload(name: string) {
  const row = PREVIEW_CHART[name] ?? {};
  const pick = (value: number) => TYPES.filter((other) => (row[other] ?? 1) === value).map((other) => named(other, typeUrl(other)));
  return {
    id: TYPES.indexOf(name) + 1,
    name,
    damage_relations: {
      double_damage_to: pick(2), half_damage_to: pick(0.5), no_damage_to: pick(0),
      double_damage_from: [], half_damage_from: [], no_damage_from: [],
    },
  };
}

function respond(path: string): unknown | null {
  const [route, query] = path.split('?');
  if (route === 'pokemon') {
    const limit = Number(new URLSearchParams(query ?? '').get('limit') ?? 60);
    // The real index has 1025 entries; repeat the fixtures so the picker grid fills.
    const results = Array.from({ length: Math.min(limit, 120) }, (_value, index) => {
      const spec = SPECS[index % SPECS.length]!;
      return named(spec.name, `${BASE}pokemon/${spec.id}/`);
    }).filter((entry, index, all) => all.findIndex((other) => other.name === entry.name) === index);
    return { count: results.length, next: null, previous: null, results };
  }
  if (route === 'type') {
    const results = TYPES.map((name) => named(name, typeUrl(name)));
    return { count: results.length, next: null, previous: null, results };
  }
  const [collection, id] = (route ?? '').split('/');
  if (collection === 'pokemon' && id) {
    const spec = SPECS.find((entry) => entry.name === id || String(entry.id) === id) ?? SPECS[0]!;
    return pokemonPayload(spec);
  }
  if (collection === 'move' && id) return movePayload(id);
  if (collection === 'type' && id) {
    const name = /^\d+$/.test(id) ? TYPES[Number(id) - 1] ?? 'normal' : id;
    return typePayload(name);
  }
  return null;
}

function installApiMock(): void {
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(BASE)) return original(input as RequestInfo, init);
    const scenario = new URLSearchParams(window.location.search).get('scenario');
    if (scenario === 'error' || (scenario === 'battle-error' && !url.includes('pokemon?'))) return new Response('Preview: unavailable', { status: 404 });
    if (scenario === 'loading') await new Promise((resolve) => setTimeout(resolve, 8000));
    const payload = respond(url.slice(BASE.length).replace(/\/$/, ''));
    if (payload === null) return new Response('Not Found', { status: 404 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

// Installed as an import side effect: PokeApiClient binds globalThis.fetch when
// its module body runs, so this must execute before src/api/client is imported.
installApiMock();
