import { useMemo, useRef, useState } from 'react';
import { TeamSlots } from '../components/BattleSetup';
import { DEFAULT_PLAYER_TEAM, type PickerPokemon } from '../api/battleSetup';
import { sprite } from './client';

export default function TeamSelection({ roster, picker, disabled, error, onChange }: { roster: string[]; picker: PickerPokemon[]; disabled: boolean; error: string; onChange: (roster: string[]) => void }) {
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(36);
  const search = useRef<HTMLInputElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const preview = (name: string) => { if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) setHovered(name); };
  const pokemonByName = useMemo(() => Object.fromEntries([...DEFAULT_PLAYER_TEAM.map(name => ({ name, id: 0, url: '', sprite: sprite(name) })), ...picker].map(p => [p.name, p])), [picker]);
  const normalized = query.trim().toLowerCase();
  const filtered = picker.filter(p => p.name.includes(normalized) || String(p.id).includes(normalized));
  const toggle = (name: string) => {
    if (disabled) return;
    onChange(roster.includes(name) ? roster.filter(n => n !== name) : roster.length < 6 ? [...roster, name] : roster);
  };
  return <div className="lg-team-selection">
    <div className="lobby-layout">
      <aside>
        <TeamSlots roster={roster} label="Your team" active={!disabled} disabled={disabled} onEdit={() => search.current?.focus()} onRemove={toggle} pokemonByName={pokemonByName} />
        <button type="button" className="text-button" disabled={disabled} onClick={() => onChange([...DEFAULT_PLAYER_TEAM])}>Reset team</button>
      </aside>
      <section className="picker-section" aria-labelledby="online-picker-title">
        <div className="picker-heading"><div><p className="eyebrow">THE NATIONAL POKÉDEX</p><h2 id="online-picker-title">PICK YOUR CONTENDERS.</h2></div><span className="section-index">{picker.length} AVAILABLE</span></div>
        <div className="picker-tools"><div className="picker-search"><label className="sr-only" htmlFor="online-picker-search">Search Pokémon</label><span aria-hidden="true">⌕</span><input ref={search} id="online-picker-search" onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }} placeholder="Search name or Pokédex number…" value={query} onChange={e => { setQuery(e.target.value); setVisible(36); }} />{query && <button type="button" aria-label="Clear search" onClick={() => { setQuery(''); setVisible(36); }}>×</button>}</div><span className="editing-label">Adding to <b>your team</b></span></div>
        <p className="picker-guidance" role="status">{disabled ? 'Your team is waiting for battle.' : roster.length === 6 ? 'Lineup complete. Remove a Pokémon to make room for a new contender.' : `${6 - roster.length} open ${roster.length === 5 ? 'slot' : 'slots'}. Select a Pokémon below.`}</p>
        {!picker.length && <p role="status">{error || 'Scouting the contenders…'}</p>}
        <div className="picker-grid">{filtered.slice(0, visible).map(p => <button className={`picker-card ${roster.includes(p.name) ? 'is-selected' : ''}`} type="button" key={p.name} onPointerEnter={() => preview(p.name)} onPointerLeave={() => setHovered(null)} onFocus={() => preview(p.name)} onBlur={() => setHovered(null)} disabled={disabled || (!roster.includes(p.name) && roster.length === 6)} aria-pressed={roster.includes(p.name)} onClick={() => toggle(p.name)}>
          <span className="picker-number">{String(p.id).padStart(3, '0')}</span><img className={hovered === p.name ? 'is-animated' : undefined} loading="lazy" src={hovered === p.name ? sprite(p.name) : p.sprite} alt="" onError={() => { if (hovered === p.name) setHovered(null); }} /><strong>{p.name.replaceAll('-', ' ')}</strong><span className="picker-action">{roster.includes(p.name) ? 'IN YOUR LINEUP ✓' : roster.length === 6 ? 'TEAM FULL' : '+ ADD TO TEAM'}</span>
        </button>)}</div>
        {!!picker.length && !filtered.length && <p className="picker-guidance">No contenders found. Try another name or number.</p>}
        {filtered.length > visible && <button type="button" className="load-more" onClick={() => setVisible(v => v + 36)}>Show more Pokémon ↓</button>}
      </section>
    </div>
  </div>;
}
