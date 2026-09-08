import { useEffect, useRef } from 'react';
import { label, type Team } from '../engine/types';
import HealthBar from './HealthBar';
import { useBattle } from '../state/BattleContext';

export default function SwitchMenu({ team, forced, disabled = false, onSwitch, onBack }: {
  team: Team; forced: boolean; disabled?: boolean; onSwitch: (slot: number) => void; onBack: () => void;
}) {
  const { sprites } = useBattle();
  const root = useRef<HTMLElement>(null);
  useEffect(() => { if (!disabled) root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }, [team.active, forced, disabled]);
  return <section className="party-menu" ref={root} aria-label="Choose a Pokémon" onKeyDown={(event) => {
    if (event.key === 'Escape' && !forced) { event.preventDefault(); onBack(); return; }
    const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
      buttons[(Math.max(0, index) + delta + buttons.length) % buttons.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      (event.key === 'Home' ? buttons[0] : buttons.at(-1))?.focus();
    }
  }}>
    <div className="party-header">
      <h2>{forced ? 'Send out next' : 'Switch Pokémon'}</h2>
      {!forced && <button type="button" className="party-back" onClick={onBack}>Back</button>}
    </div>
    <div className="party-list">
      {team.pokemon.map((pokemon, slot) => {
        const out = pokemon.hp === 0;
        const active = slot === team.active;
        return <button
          className={`party-card ${out ? 'is-out' : ''} ${active ? 'is-active' : ''}`}
          key={slot}
          type="button"
          disabled={out || active || disabled}
          onClick={() => onSwitch(slot)}>
          {sprites[pokemon.name]?.sprites.front_default && <img className="party-sprite" src={sprites[pokemon.name]?.sprites.front_default ?? undefined} alt="" />}
          <span className="party-name">
            <strong>{label(pokemon.name)}</strong>
            <small>{out ? 'Fainted' : active ? 'In battle' : pokemon.status ?? 'Ready'}</small>
          </span>
          <span className="party-meter">
            <HealthBar hp={pokemon.hp} maxHp={pokemon.stats.hp} name={label(pokemon.name)} />
            <small>{pokemon.hp}/{pokemon.stats.hp}</small>
          </span>
        </button>;
      })}
    </div>
  </section>;
}
