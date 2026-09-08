import { useEffect, useState } from 'react';
import { pokeApi } from '../api/client';
import { moveShortEffect, selectMoveset } from '../api/moveSelect';
import { getPokemon } from '../api/pokeapi';
import type { Move, Pokemon } from '../api/types';
import { PokemonArtwork, TypeBadge } from './LandingPage';

type LoadState = { status: 'loading' } | { status: 'error'; message: string }
  | { status: 'ready'; pokemon: Pokemon; moves: Move[] };

export default function PokemonExplorer({ name, onExplore }: { name: string; onExplore: (name: string) => void }) {
  const [query, setQuery] = useState(name);
  const [retry, setRetry] = useState(0);
  const [progress, setProgress] = useState(() => pokeApi.snapshot());
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  useEffect(() => pokeApi.onProgress(setProgress), []);
  useEffect(() => {
    let current = true;
    setState({ status: 'loading' });
    setQuery(name);
    pokeApi.resetProgress();
    void (async () => {
      try {
        const pokemon = await getPokemon(pokeApi, name);
        const moves = await selectMoveset(pokemon, pokeApi);
        if (current) setState({ status: 'ready', pokemon, moves });
      } catch {
        if (current) setState({ status: 'error', message: `Couldn't load "${name}". Check the name or number and try again.` });
      }
    })();
    return () => { current = false; };
  }, [name, retry]);

  return <main id="main-content" className="explorer">
    <a className="back-link" href="#home">&#8592; Back to home</a>
    <div className="explorer-heading"><div><p className="eyebrow">02 / NATIONAL POKÉDEX</p><h1>THE SCOUTING REPORT.</h1></div>
      <form className="pokemon-search" onSubmit={(event) => {
        event.preventDefault();
        if (query.trim()) { onExplore(query.trim().toLowerCase()); setRetry((value) => value + 1); }
      }}><label className="sr-only" htmlFor="dex-search">Pokémon name or number</label>
        <input id="dex-search" value={query} onChange={(event) => setQuery(event.target.value)} required />
        <button type="submit" aria-label="Search Pokémon" title="Search Pokémon">&#8594;</button>
      </form>
    </div>
    {state.status === 'loading' && <div className="profile-loading" role="status"><span className="loading-ball" aria-hidden="true" />Loading {name}...
      <progress aria-label="Pokémon loading progress" value={progress.ratio} max={1} />
      <span className="loading-count">Gathering stats and moves · {Math.round(progress.ratio * 100)}%</span>
    </div>}
    {state.status === 'error' && <div className="profile-error" role="alert"><h2>Pokémon not available</h2><p>{state.message}</p>
      <button className="primary-button" onClick={() => setRetry((value) => value + 1)}>Try again <span aria-hidden="true">&#8635;</span></button></div>}
    {state.status === 'ready' && <>
      <section className="pokemon-profile" aria-labelledby="pokemon-name">
        <div className={`profile-art type-${state.pokemon.types[0]?.type.name ?? 'normal'}`}><span className="profile-number">#{String(state.pokemon.id).padStart(3, '0')}</span>
          <PokemonArtwork key={state.pokemon.id} id={state.pokemon.id} name={state.pokemon.name} /></div>
        <div className="profile-details"><p className="eyebrow">CONTENDER / {String(state.pokemon.id).padStart(3, '0')}</p><h2 id="pokemon-name">{state.pokemon.name.replaceAll('-', ' ')}</h2>
          <div className="type-list">{state.pokemon.types.map(({ type }) => <TypeBadge type={type.name} key={type.name} />)}</div>
          <p className="profile-summary">A {state.pokemon.types.map(({ type }) => type.name).join(' / ')} contender. Its strongest base stat is {[...state.pokemon.stats].sort((a, b) => b.base_stat - a.base_stat)[0]?.stat.name.replace('special-', 'special ').replaceAll('-', ' ')}. Explore its moves and find its place in your lineup.</p>
          <div className="measurements"><span>Height<strong>{state.pokemon.height / 10} <small>m</small></strong></span><span>Weight<strong>{state.pokemon.weight / 10} <small>kg</small></strong></span><span>Base total<strong>{state.pokemon.stats.reduce((sum, stat) => sum + stat.base_stat, 0)}</strong></span></div>
          <h3>Base stats</h3><dl className="stat-list">{state.pokemon.stats.map((stat) => <div key={stat.stat.name}>
            <dt>{stat.stat.name === 'hp' ? 'HP' : stat.stat.name.replace('special-', 'Sp. ')}</dt><dd>{stat.base_stat}</dd><span className="stat-track" aria-hidden="true"><span style={{ width: `${Math.min(100, stat.base_stat / 255 * 100)}%` }} /></span>
          </div>)}</dl>
        </div>
      </section>
      <div className="dex-navigation"><button className="text-button" disabled={state.pokemon.id <= 1} onClick={() => onExplore(String(state.pokemon.id - 1))}>← Previous Pokémon</button><a className="primary-button" href="#battle">Build a team ↗</a><button className="text-button" onClick={() => onExplore(String(state.pokemon.id + 1))}>Next Pokémon →</button></div>
      <section className="moves-section" aria-labelledby="moves-title"><div className="section-topline"><h2 id="moves-title">THE MOVESET.</h2><span className="section-index">{state.moves.length} SELECTED MOVES</span></div>
        {state.moves.length === 0 && <p>No level-up moves available.</p>}
        <div className="move-list">{state.moves.map((move) => <article className="move-row" key={move.name}>
          <div><h3>{move.name.replaceAll('-', ' ')}</h3><TypeBadge type={move.type.name} /></div>
          <p>{moveShortEffect(move) || move.damage_class.name}</p>
          <dl><div><dt>Power</dt><dd>{move.power ?? '-'}</dd></div><div><dt>Accuracy</dt><dd>{move.accuracy === null ? '-' : `${move.accuracy}%`}</dd></div><div><dt>PP</dt><dd>{move.pp ?? '-'}</dd></div></dl>
        </article>)}</div>
      </section>
    </>}
  </main>;
}
