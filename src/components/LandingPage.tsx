import { useState } from 'react';
import { spriteUrlForId } from '../api/pokeapi';

export const featured = [
  { id: 6, name: 'Charizard', category: 'Flame', types: ['fire', 'flying'], color: '#eeebe5' },
  { id: 9, name: 'Blastoise', category: 'Shellfish', types: ['water'], color: '#e7eff0' },
  { id: 3, name: 'Venusaur', category: 'Seed', types: ['grass', 'poison'], color: '#e8eee7' },
  { id: 25, name: 'Pikachu', category: 'Mouse', types: ['electric'], color: '#f4f1df' },
] as const;

export function PokemonArtwork({ id, name, className = '' }: { id: number; name: string; className?: string }) {
  const [fallback, setFallback] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) return <span className={`artwork-fallback ${className}`}>{name}</span>;
  return <img className={className} alt={name} width="475" height="475"
    src={fallback ? spriteUrlForId(id) : `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`}
    onError={() => fallback ? setFailed(true) : setFallback(true)} />;
}

export function TypeBadge({ type }: { type: string }) {
  return <span className={`type-label type-${type}`}>{type}</span>;
}

export default function LandingPage({ onExplore }: { onExplore: (name: string) => void }) {
  const [search, setSearch] = useState('');
  return <main id="main-content">
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-art" aria-hidden="true">
        <span className="arena-ring" />
        <PokemonArtwork id={6} name="Charizard" className="hero-charizard" />
        <PokemonArtwork id={25} name="Pikachu" className="hero-pikachu" />
        <PokemonArtwork id={9} name="Blastoise" className="hero-blastoise" />
      </div>
      <div className="hero-inner">
        <p className="eyebrow"><span className="red-dash" /> THE ARENA IS CALLING</p>
        <h1 id="hero-title">SMALL BEGINNINGS.<br /><span>LEGENDARY</span><br />BATTLES.</h1>
        <p className="hero-description">Six partners. One great rivalry.<br />Build your team and make your next move count.</p>
        <div className="hero-actions"><a className="primary-button" href="#battle">Start a battle <span aria-hidden="true">&#8599;</span></a><a className="hero-secondary" href="#pokemon/pikachu">Meet the contenders <span aria-hidden="true">→</span></a></div>
        <div className="hero-caption"><span className="tiny-ball" aria-hidden="true" /> YOUR TEAM. YOUR STRATEGY. <span>YOUR MOMENT.</span></div>
      </div>
      <div className="hero-footnote"><span>CONTENDER SPOTLIGHT</span><strong>006 / CHARIZARD</strong><span>FIRE + FLYING</span></div>
    </section>
    <div className="league-ribbon"><span><b>06</b> POKÉMON PER TEAM</span><i>✦</i><span>EVERY MATCH STARTS WITH A CHOICE</span><i>✦</i><span>CPU RIVAL <b>/</b> LOCAL PLAY</span></div>

    <section id="featured" className="featured-section" aria-labelledby="featured-title">
      <div className="section-topline"><p className="eyebrow">SCOUT YOUR NEXT PARTNER</p><span className="section-index">01 — THE ORIGINALS</span></div>
      <div className="section-heading"><h2 id="featured-title">FAMILIAR FACES.<br /><span>FIERCE CONTENDERS.</span></h2>
        <form className="pokemon-search" onSubmit={(event) => {
          event.preventDefault();
          if (search.trim()) onExplore(search.trim().toLowerCase());
        }}>
          <label className="sr-only" htmlFor="home-search">Pokémon name or number</label>
          <input id="home-search" value={search} onChange={(event) => setSearch(event.target.value)}
            placeholder="Find a Pokémon..." required />
          <button type="submit" aria-label="Search Pokémon" title="Search Pokémon">&#8594;</button>
        </form>
      </div>
      <div className="featured-grid">{featured.map((pokemon) => <button className="pokemon-card" key={pokemon.id}
        onClick={() => onExplore(pokemon.name.toLowerCase())} aria-label={`View ${pokemon.name}`}>
        <div className="pokemon-card-art" style={{ backgroundColor: pokemon.color }}>
          <span className="dex-number">#{String(pokemon.id).padStart(3, '0')}</span>
          <PokemonArtwork id={pokemon.id} name={pokemon.name} />
          <span className="card-arrow" aria-hidden="true">&#8599;</span>
        </div>
        <div className="pokemon-card-heading"><h3>{pokemon.name}</h3><div className="type-list">{pokemon.types.map((type) => <TypeBadge key={type} type={type} />)}</div></div>
        <p>{pokemon.category} Pokémon</p>
      </button>)}</div>
      <div className="collection-footer"><span>A little nostalgia. A lot of possibility.</span>
        <button className="text-button" onClick={() => onExplore('pikachu')}>Explore the Pokédex <span aria-hidden="true">&#8594;</span></button></div>
    </section>
    <section className="league-invite"><span className="eyebrow">THE NEXT CHAPTER IS YOURS</span><h2>GOOD TEAMS.<br /><em>GREAT STORIES.</em></h2><div><p>Find your six. Face a rival.<br />There’s only one way to see what you’re made of.</p><a href="#battle" className="primary-button">Build your team <span>↗</span></a></div><span className="invite-ball" aria-hidden="true" /></section>
  </main>;
}
