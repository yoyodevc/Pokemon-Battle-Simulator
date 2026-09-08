/**
 * Design sandbox entry. Not part of the production bundle: `vite build` only
 * emits `index.html`. Renders the battle screen against offline fixtures so the
 * HUD can be iterated on without PokéAPI.
 */
// Must stay first: installs the offline PokéAPI shim as an import side effect,
// before src/api/client binds globalThis.fetch.
import './apiMock';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BattleProvider } from '../src/state/BattleContext';
import BattleScene from '../src/components/BattleScene';
import LandingPage from '../src/components/LandingPage';
import BattleSetup from '../src/components/BattleSetup';
import PokemonExplorer from '../src/components/PokemonExplorer';
import App from '../src/App';
import SiteHeader from '../src/components/SiteHeader';
import { previewBattle, previewSprites } from './fixtures';
import '../src/index.css';

const sprites = previewSprites();

/** Extra sandbox routes for HUD states that are otherwise hard to reach. */
function stagedBattle(route: string) {
  const state = previewBattle();
  if (route === 'battle-low') {
    state.teams[0].pokemon[0]!.hp = 18;
    state.teams[0].pokemon[0]!.status = 'burn';
    state.teams[0].pokemon[3]!.hp = 0;
    state.teams[1].pokemon[0]!.hp = 74;
    state.teams[1].pokemon[0]!.status = 'paralysis';
    state.teams[1].pokemon[1]!.hp = 0;
    state.teams[1].pokemon[2]!.hp = 0;
  }
  if (route === 'battle-end') {
    for (const member of state.teams[1].pokemon) member.hp = 0;
    state.teams[0].pokemon[0]!.hp = 44;
    state.phase = 'ended';
    state.winner = 0;
    state.turn = 9;
  }
  if (route === 'battle-defeat' || route === 'battle-draw') {
    state.teams[0].pokemon.forEach((member) => { member.hp = 0; });
    if (route === 'battle-draw') state.teams[1].pokemon.forEach((member) => { member.hp = 0; });
    state.phase = 'ended'; state.winner = route === 'battle-draw' ? 'draw' : 1; state.turn = 12;
  }
  if (route === 'battle-switch') { state.teams[0].pokemon[0]!.hp = 0; state.phase = 'switch'; }
  if (route === 'battle-local') { state.teams[0].name = 'Player 1'; state.teams[1].name = 'Player 2'; }
  return state;
}

function Screen({ route }: { route: string }) {
  if (route === 'landing') return <LandingPage onExplore={() => undefined} />;
  if (route === 'setup') return <BattleSetup onStart={() => undefined} onCancel={() => undefined} />;
  if (route === 'dex') return <PokemonExplorer name="charizard" onExplore={() => undefined} />;
  return <BattleProvider key={route} initial={stagedBattle(route)} sprites={sprites} mode={route === 'battle-local' ? 'local' : 'cpu'} difficulty="trainer"><BattleScene /></BattleProvider>;
}

function Preview() {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || 'battle');
  useEffect(() => {
    const change = () => setRoute(window.location.hash.slice(1) || 'battle');
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return <div className={`site-shell ${route.startsWith('battle') ? 'battle-shell' : ''}`}><SiteHeader page={route === 'landing' ? 'home' : route === 'dex' ? 'dex' : 'battle'} /><Screen route={route} /></div>;
}

const container = document.getElementById('root');
if (!container) throw new Error('missing #root');
createRoot(container).render(<React.StrictMode>{new URLSearchParams(window.location.search).has('flow') ? <App /> : <Preview />}</React.StrictMode>);
