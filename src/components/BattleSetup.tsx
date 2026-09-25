import { useEffect, useMemo, useState } from 'react';
import { COMPETITIVE_CORE_POOL, createCompetitiveTeams, createRandomTeams, DEFAULT_ENEMY_TEAM, DEFAULT_PLAYER_TEAM, loadPokemonPicker, type BattleMode, type PickerPokemon } from '../api/battleSetup';
import { CPU_DIFFICULTIES, type CpuDifficulty } from '../state/cpuStrategy';
import { sprite } from '../league/client';

export interface BattleConfig { playerRoster: string[]; enemyRoster: string[]; mode: BattleMode; difficulty: CpuDifficulty }

export function TeamSlots({ roster, label, active, onEdit, onRemove, onReplace, replacing, pokemonByName, disabled = false }: { roster: string[]; label: string; active: boolean; onEdit: () => void; onRemove: (name: string) => void; onReplace?: (name: string) => void; replacing?: string | null; pokemonByName: Record<string, PickerPokemon>; disabled?: boolean }) {
  return <section className={`roster-panel ${active ? 'is-editing' : ''}`} aria-label={label}>
    <button type="button" className="roster-heading" disabled={disabled} onClick={onEdit} aria-pressed={active}><span><small>{disabled ? 'YOUR LINEUP' : active ? 'EDITING LINEUP' : 'CLICK TO EDIT'}</small><strong>{label}</strong></span><b>{roster.length}<i>/6</i></b></button>
    <div className="team-slots" aria-label={`${label}, ${roster.length} of 6 selected`}>
      {Array.from({ length: 6 }, (_, slot) => {
        const name = roster[slot];
        return <div className={`team-slot ${name ? 'filled' : 'empty'} ${name && replacing === name ? 'is-replacing' : ''}`} key={name ?? slot}>
          <span className="team-slot-number">{String(slot + 1).padStart(2, '0')}</span>
          {name ? <>{pokemonByName[name]?.sprite && <img src={pokemonByName[name].sprite} alt="" />}{onReplace ? <button type="button" className="replace-slot" disabled={disabled} aria-pressed={replacing === name} aria-label={`Replace ${name} in ${label}`} onClick={() => onReplace(name)}><strong>{name.replaceAll('-', ' ')}</strong><span>{replacing === name ? 'Replacing…' : 'Replace'}</span></button> : <strong>{name.replaceAll('-', ' ')}</strong>}<button type="button" disabled={disabled} aria-label={`Remove ${name} from ${label}`} onClick={() => onRemove(name)}>×</button></>
            : <button type="button" className="open-slot" disabled={disabled} onClick={onEdit} aria-label={`Edit ${label}, open slot ${slot + 1}`}><span>+</span> Open slot</button>}
        </div>;
      })}
    </div>
  </section>;
}

export default function BattleSetup({ onStart, onCancel }: { onStart: (config: BattleConfig) => void; onCancel: () => void }) {
  const [picker, setPicker] = useState<PickerPokemon[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const preview = (name: string) => { if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) setHovered(name); };
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(36);
  const [teamSide, setTeamSide] = useState<0 | 1>(0);
  const [replacing, setReplacing] = useState<string | null>(null);
  const editTeam = (side: 0 | 1, name: string | null = null) => {
    setTeamSide(side); setReplacing(name); setQuery(''); setVisible(36);
    document.getElementById('battle-picker-search')?.focus();
  };
  const [mode, setMode] = useState<BattleMode>('cpu');
  const [difficulty, setDifficulty] = useState<CpuDifficulty>('trainer');
  const [playerRoster, setPlayerRoster] = useState(DEFAULT_PLAYER_TEAM);
  const [enemyRoster, setEnemyRoster] = useState(DEFAULT_ENEMY_TEAM);
  const reload = () => {
    setLoading(true); setError(false);
    void loadPokemonPicker().then(setPicker).catch(() => setError(true)).finally(() => setLoading(false));
  };
  useEffect(reload, []);
  const selected = teamSide === 0 ? playerRoster : enemyRoster;
  const pokemonByName = useMemo(() => Object.fromEntries(picker.map((pokemon) => [pokemon.name, pokemon])), [picker]);
  const setSelected = (next: string[]) => teamSide === 0 ? setPlayerRoster(next) : setEnemyRoster(next);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return picker.filter((pokemon) => (replacing || selected.length < 6) && !selected.includes(pokemon.name) && (!normalized || pokemon.name.includes(normalized) || String(pokemon.id).includes(normalized)));
  }, [picker, query, replacing, selected]);
  const toggle = (name: string) => {
    if (replacing) {
      if (!selected.includes(name)) { setSelected(selected.map((item) => item === replacing ? name : item)); setReplacing(null); }
    } else setSelected(selected.includes(name) ? selected.filter((item) => item !== name) : selected.length < 6 ? [...selected, name] : selected);
  };
  const canStart = playerRoster.length === 6 && enemyRoster.length === 6;
  const enemyLabel = mode === 'cpu' ? 'Rival team' : 'Player 2 team';
  const missing = [playerRoster.length < 6 ? `${6 - playerRoster.length} more for your team` : '', enemyRoster.length < 6 ? `${6 - enemyRoster.length} more for ${enemyLabel.toLowerCase()}` : ''].filter(Boolean).join(' and ');
  const availableNames = useMemo(() => picker.map((pokemon) => pokemon.name), [picker]);
  const competitiveAvailable = COMPETITIVE_CORE_POOL.filter((name) => availableNames.includes(name)).length >= 12;
  const applyCompetitive = () => {
    try {
      const [player, enemy] = createCompetitiveTeams(availableNames);
      setPlayerRoster(player); setEnemyRoster(enemy); setTeamSide(0); setReplacing(null);
    } catch {
      // The button stays disabled until enough competitive entries are loaded.
    }
  };
  const applyRandom = () => {
    try {
      const [player, enemy] = createRandomTeams(availableNames);
      setPlayerRoster(player); setEnemyRoster(enemy); setTeamSide(0); setReplacing(null);
    } catch {
      // The button stays disabled until the Pokédex has enough entries, but keep
      // this guard for slow or partial data responses.
    }
  };

  return <main id="main-content" className="setup-page">
    <div className="setup-heading"><div><button className="back-link" onClick={onCancel}>← Back to home</button><p className="eyebrow">03 / THE MATCH LOBBY</p><h1>ASSEMBLE YOUR SIX.</h1><p>Every great rivalry starts with the right team.</p></div><span className="lobby-stamp" aria-hidden="true">6 <small>VS</small> 6</span></div>
    <section className="setup-mode" aria-label="Battle mode">
      <div className="mode-label"><p className="eyebrow">MATCH FORMAT</p><h2>Choose your challenge</h2></div>
      <div className="mode-switch" role="group" aria-label="Choose battle mode"><button aria-pressed={mode === 'cpu'} onClick={() => setMode('cpu')}><strong>CPU RIVAL</strong><small>You vs. the computer</small></button><button aria-pressed={mode === 'local'} onClick={() => setMode('local')}><strong>LOCAL PLAYER</strong><small>Pass the device & play</small></button></div>
      {mode === 'cpu' && <div className="difficulty-picker"><p className="eyebrow">RIVAL DIFFICULTY</p><div role="group" aria-label="Choose CPU difficulty">{CPU_DIFFICULTIES.map((option) => <button key={option.id} title={option.description} aria-pressed={difficulty === option.id} onClick={() => setDifficulty(option.id)}>{option.label}</button>)}</div><small>{CPU_DIFFICULTIES.find((option) => option.id === difficulty)?.description}</small></div>}
      <div className="team-presets" role="group" aria-label="Team presets">
        <p className="eyebrow">TEAM PRESETS</p>
        <div className="team-preset-actions">
          <button type="button" onClick={applyRandom} disabled={loading || picker.length < 12}>
            <strong>Random viable</strong><small>Two fresh, battle-ready teams</small>
          </button>
          <button type="button" onClick={applyCompetitive} disabled={loading || !competitiveAvailable}>
            <strong>Competitive cores</strong><small>Balanced roles and coverage</small>
          </button>
        </div>
      </div>
    </section>
    <div className="lobby-layout">
      <aside className="setup-teams" aria-label="Selected teams">
        <TeamSlots roster={playerRoster} label="Your team" active={teamSide === 0} replacing={teamSide === 0 ? replacing : null} onEdit={() => editTeam(0)} onReplace={(name) => editTeam(0, name)} pokemonByName={pokemonByName} onRemove={(name) => { editTeam(0); setPlayerRoster(playerRoster.filter((item) => item !== name)); }} />
        <div className="setup-divider"><span>THE MATCHUP</span><b>VS</b><span>MAKE IT COUNT</span></div>
        <TeamSlots roster={enemyRoster} label={enemyLabel} active={teamSide === 1} replacing={teamSide === 1 ? replacing : null} onEdit={() => editTeam(1)} onReplace={(name) => editTeam(1, name)} pokemonByName={pokemonByName} onRemove={(name) => { editTeam(1); setEnemyRoster(enemyRoster.filter((item) => item !== name)); }} />
      </aside>
      <section className="picker-section" aria-labelledby="picker-title">
        <div className="picker-heading"><div><p className="eyebrow">THE NATIONAL POKÉDEX</p><h2 id="picker-title">PICK YOUR CONTENDERS.</h2></div><span className="section-index">{picker.length ? `${picker.length} AVAILABLE` : 'SCOUTING…'}</span></div>
        <div className="picker-tools"><form className="picker-search" onSubmit={(event) => event.preventDefault()}><label className="sr-only" htmlFor="battle-picker-search">Search Pokémon</label><span aria-hidden="true">⌕</span><input id="battle-picker-search" value={query} onChange={(event) => { setQuery(event.target.value); setVisible(36); }} placeholder="Search name or Pokédex number…" />{query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>×</button>}</form><span className="editing-label">Adding to <b>{teamSide === 0 ? 'your team' : enemyLabel.toLowerCase()}</b></span></div>
        <p className="picker-guidance" role="status">{replacing ? `Choose a replacement for ${replacing.replaceAll('-', ' ')}. Your current lineup stays until you choose.` : selected.length === 6 ? 'Lineup complete. Choose Replace on a team slot to pick a new contender.' : `${6 - selected.length} open ${6 - selected.length === 1 ? 'slot' : 'slots'}. Select a Pokémon below to add it.`}</p>
        {replacing && <button type="button" className="text-button" onClick={() => setReplacing(null)}>Cancel replacement</button>}
        {loading && <div className="picker-state" role="status"><span className="loading-ball" /><h3>Scouting the contenders…</h3><p>Your Pokédex is on its way.</p></div>}
        {error && <div className="picker-state" role="alert"><h3>The Pokédex is taking a break.</h3><p>Check your connection and try again.</p><button className="primary-button" onClick={reload}>Retry connection ↻</button></div>}
        {!loading && !error && <div className="picker-grid">{filtered.slice(0, visible).map((pokemon) => <button className="picker-card" type="button" key={pokemon.name} onPointerEnter={() => preview(pokemon.name)} onPointerLeave={() => setHovered(null)} onFocus={() => preview(pokemon.name)} onBlur={() => setHovered(null)} onClick={() => toggle(pokemon.name)}>
          <span className="picker-number">{String(pokemon.id).padStart(3, '0')}</span><img className={hovered === pokemon.name ? 'is-animated' : undefined} loading="lazy" src={hovered === pokemon.name ? sprite(pokemon.name) : pokemon.sprite} alt="" onError={() => { if (hovered === pokemon.name) setHovered(null); }} /><strong>{pokemon.name.replaceAll('-', ' ')}</strong><span className="picker-action">{replacing ? 'CHOOSE REPLACEMENT' : '+ ADD TO TEAM'}</span>
        </button>)}</div>}
        {!loading && !error && (replacing || selected.length < 6) && filtered.length === 0 && <div className="picker-state"><h3>No contenders found.</h3><p>Try another name or Pokédex number.</p><button className="text-button" onClick={() => setQuery('')}>Clear search →</button></div>}
        {!loading && !error && filtered.length > visible && <button className="load-more" onClick={() => setVisible((count) => count + 36)}>Show more Pokémon <span>↓</span></button>}
      </section>
    </div>
    <div className="setup-footer"><button className="text-button" onClick={() => { setPlayerRoster(DEFAULT_PLAYER_TEAM); setEnemyRoster(DEFAULT_ENEMY_TEAM); setDifficulty('trainer'); setReplacing(null); }}>↻ Reset teams</button><p role="status">{canStart ? <><span className="ready-dot" /> Both teams ready.</> : `Select ${missing}.`}</p><button className="primary-button" disabled={!canStart} onClick={() => onStart({ playerRoster, enemyRoster, mode, difficulty })}>Enter the arena <span aria-hidden="true">↗</span></button></div>
  </main>;
}
