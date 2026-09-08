import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pokeApi, type ProgressSnapshot } from '../api/client';
import { artworkSprite, battleSprite, getPokemon } from '../api/pokeapi';
import { levelUpPool, moveShortEffect, selectMoveset } from '../api/moveSelect';
import { loadTypeChart, lookupEffectiveness, type TypeChart } from '../api/typeChart';
import type { Move, Pokemon } from '../api/types';

/**
 * Temporary Phase 1 harness. It exists to prove the cache, the request queue, the type
 * chart loader and the auto-moveset picker all work against the live API before any
 * battle code is written. Deleted once the real UI lands.
 */

const TYPE_COLORS: Record<string, string> = {
  normal: '#9fa19f', fire: '#e8703a', water: '#4a90d9', electric: '#e5c531',
  grass: '#63bc5a', ice: '#74cec0', fighting: '#ce4069', poison: '#a864c8',
  ground: '#d97845', flying: '#8fa8dd', psychic: '#f66f88', bug: '#90c12c',
  rock: '#c7b78b', ghost: '#5269ac', dragon: '#0a6dc4', dark: '#5a5366',
  steel: '#5a8ea1', fairy: '#ec8fe6',
};

const SANITY_CHECKS: Array<[attacker: string, defender: string, expected: number]> = [
  ['water', 'fire', 2],
  ['electric', 'ground', 0],
  ['ghost', 'normal', 0],
  ['fighting', 'steel', 2],
];

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; pokemon: Pokemon; moves: Move[]; versionGroup: string };

export default function DebugPage() {
  const [query, setQuery] = useState('pikachu');
  const latestRequest = useRef(0);
  const [state, setState] = useState<LoadState>({ status: 'idle' });
  const [chart, setChart] = useState<TypeChart | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressSnapshot>(() => pokeApi.snapshot());

  useEffect(() => pokeApi.onProgress(setProgress), []);

  const loadChart = useCallback(() => {
    setChartError(null);
    loadTypeChart(pokeApi)
      .then(setChart)
      .catch((error: unknown) => setChartError(String(error)));
  }, []);

  useEffect(loadChart, [loadChart]);

  const load = useCallback(async (name: string) => {
    const request = ++latestRequest.current;
    setState({ status: 'loading' });
    pokeApi.resetProgress();
    try {
      const pokemon = await getPokemon(pokeApi, name.trim().toLowerCase());
      const { versionGroup } = levelUpPool(pokemon);
      const moves = await selectMoveset(pokemon, pokeApi);
      if (request !== latestRequest.current) return;
      setState({ status: 'ready', pokemon, moves, versionGroup });
    } catch (error) {
      if (request !== latestRequest.current) return;
      setState({ status: 'error', message: String(error) });
    }
  }, []);

  useEffect(() => {
    void load('pikachu');
  }, [load]);

  const percent = Math.round(progress.ratio * 100);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-5 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="font-mono text-xl tracking-tight text-slate-100">
          Data layer check
        </h1>
        <p className="max-w-prose text-sm text-slate-400">
          Fetches one Pokémon through the cached, deduplicated, concurrency-limited client
          and auto-selects a four-move set. Reload to confirm the second load is served
          from {pokeApi.cacheBackendKind}.
        </p>
      </header>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void load(query);
        }}
      >
        <input
          aria-label="Pokémon name or dex number"
          className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-100 outline-none focus-visible:border-sky-400"
          onChange={(event) => setQuery(event.target.value)}
          value={query}
        />
        <button
          className="rounded bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300"
          type="submit"
        >
          Fetch
        </button>
      </form>

      <section aria-label="Request progress" className="flex flex-col gap-2">
        <div className="h-1.5 w-full overflow-hidden rounded bg-slate-800">
          <div
            className="h-full bg-sky-400 transition-[width] duration-200 motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="font-mono text-xs text-slate-500">
          {progress.completed}/{progress.total} requests · {progress.active} in flight ·{' '}
          {progress.pending} queued · cache: {pokeApi.cacheBackendKind}
        </p>
      </section>

      {state.status === 'loading' && <p className="text-sm text-slate-400">Loading…</p>}

      {state.status === 'error' && (
        <div className="rounded border border-rose-500/40 bg-rose-500/10 p-4">
          <p className="text-sm text-rose-200">{state.message}</p>
          <button
            className="mt-3 rounded border border-rose-400/60 px-3 py-1.5 text-sm text-rose-100 hover:bg-rose-500/20"
            onClick={() => void load(query)}
            type="button"
          >
            Try again
          </button>
        </div>
      )}

      {state.status === 'ready' && (
        <PokemonReadout
          moves={state.moves}
          pokemon={state.pokemon}
          versionGroup={state.versionGroup}
        />
      )}

      <TypeChartReadout chart={chart} error={chartError} onRetry={loadChart} />
    </main>
  );
}

function PokemonReadout({
  pokemon,
  moves,
  versionGroup,
}: {
  pokemon: Pokemon;
  moves: Move[];
  versionGroup: string;
}) {
  const artwork = artworkSprite(pokemon);
  const sprite = battleSprite(pokemon, 'front');
  const types = useMemo(
    () => [...pokemon.types].sort((a, b) => a.slot - b.slot).map((entry) => entry.type.name),
    [pokemon],
  );

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        {artwork !== null && (
          <img alt="" className="h-24 w-24 object-contain" src={artwork} />
        )}
        <div className="flex flex-col gap-2">
          <h2 className="font-mono text-lg capitalize text-slate-100">
            #{pokemon.id} {pokemon.name}
          </h2>
          <div className="flex gap-2">
            {types.map((type) => (
              <span
                className="rounded px-2 py-0.5 text-xs font-medium text-slate-950"
                key={type}
                style={{ backgroundColor: TYPE_COLORS[type] ?? '#94a3b8' }}
              >
                {type}
              </span>
            ))}
          </div>
          {sprite !== null && <img alt="" className="h-12 object-contain" src={sprite} />}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm text-slate-300">Base stats</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm sm:grid-cols-3">
          {pokemon.stats.map((entry) => (
            <div className="flex justify-between gap-3" key={entry.stat.name}>
              <dt className="text-slate-500">{entry.stat.name}</dt>
              <dd className="text-slate-100">{entry.base_stat}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div>
        <h3 className="mb-2 text-sm text-slate-300">
          Auto-selected moves <span className="text-slate-500">({versionGroup})</span>
        </h3>
        <ul className="flex flex-col gap-2">
          {moves.map((move) => (
            <li className="rounded border border-slate-800 bg-slate-900/60 p-3" key={move.name}>
              <div className="flex flex-wrap items-center gap-2 font-mono text-sm">
                <span className="capitalize text-slate-100">{move.name.replaceAll('-', ' ')}</span>
                <span
                  className="rounded px-1.5 py-0.5 text-xs text-slate-950"
                  style={{ backgroundColor: TYPE_COLORS[move.type.name] ?? '#94a3b8' }}
                >
                  {move.type.name}
                </span>
                <span className="text-xs text-slate-500">
                  {move.damage_class.name} · pow {move.power ?? '—'} · acc{' '}
                  {move.accuracy ?? '—'} · pp {move.pp ?? '—'} · pri {move.priority}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">{moveShortEffect(move)}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function TypeChartReadout({
  chart,
  error,
  onRetry,
}: {
  chart: TypeChart | null;
  error: string | null;
  onRetry: () => void;
}) {
  if (error !== null) {
    return (
      <section className="rounded border border-rose-500/40 bg-rose-500/10 p-4">
        <p className="text-sm text-rose-200">Type chart failed to load. {error}</p>
        <button
          className="mt-3 rounded border border-rose-400/60 px-3 py-1.5 text-sm text-rose-100 hover:bg-rose-500/20"
          onClick={onRetry}
          type="button"
        >
          Try again
        </button>
      </section>
    );
  }

  if (chart === null) {
    return <p className="text-sm text-slate-400">Building type chart…</p>;
  }

  return (
    <section>
      <h3 className="mb-2 text-sm text-slate-300">
        Type chart <span className="text-slate-500">({Object.keys(chart).length} types)</span>
      </h3>
      <ul className="flex flex-col gap-1 font-mono text-xs">
        {SANITY_CHECKS.map(([attacker, defender, expected]) => {
          const actual = lookupEffectiveness(chart, attacker, defender);
          return (
            <li className="flex gap-2" key={`${attacker}-${defender}`}>
              <span className="text-slate-400">
                {attacker} → {defender} = {actual}×
              </span>
              <span className={actual === expected ? 'text-emerald-400' : 'text-rose-400'}>
                {actual === expected ? 'ok' : `expected ${expected}×`}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
