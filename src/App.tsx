import { useEffect, useState } from 'react';
import LandingPage from './components/LandingPage';
import PokemonExplorer from './components/PokemonExplorer';
import BattlePage from './components/BattlePage';
import SiteHeader from './components/SiteHeader';
import LeaguePage from './league/LeaguePage';

export default function App() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const change = () => {
      setHash(window.location.hash);
      if (window.location.hash === '#home' || window.location.hash === '#battle' || window.location.hash.startsWith('#pokemon/')) window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  let name: string | null = null;
  if (hash.startsWith('#pokemon/')) {
    try { name = decodeURIComponent(hash.slice(9)) || 'pikachu'; }
    catch { name = 'pikachu'; }
  }
  const explore = (value: string) => { window.location.hash = `pokemon/${encodeURIComponent(value)}`; };
  const league = hash === '#league' || hash.startsWith('#invite/') || hash.startsWith('#match/');
  return <div className={`site-shell ${hash === '#battle' ? 'battle-shell' : ''}`}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <SiteHeader page={league ? 'league' : hash === '#battle' ? 'battle' : name ? 'dex' : 'home'} />
    {league ? <LeaguePage route={hash} /> : hash === '#battle' ? <BattlePage /> : name ? <PokemonExplorer name={name} onExplore={explore} /> : <LandingPage onExplore={explore} />}
    <footer className="site-footer"><span>POKÉMON <strong>BATTLE SIMULATOR</strong></span><p>Unofficial fan project. Pokémon belongs to its respective owners.</p><a href="https://pokeapi.co/" target="_blank" rel="noreferrer">Data by PokéAPI &#8599;</a></footer>
  </div>;
}
