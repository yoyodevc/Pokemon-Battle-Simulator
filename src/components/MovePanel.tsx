import { useEffect, useRef } from 'react';
import { label, type Move } from '../engine/types';

export type MoveHint = { tone: 'strong' | 'weak' | 'immune'; label: string } | null;

const CATEGORY_GLYPH: Record<Move['damageClass'], string> = { physical: '✦', special: '◉', status: '◍' };

/**
 * Scarlet/Violet lays the four moves out as a 2x2 grid of type-coloured cards.
 * Arrow keys walk that grid; the effectiveness hint is printed on the card so a
 * player never has to open a dialog to learn the matchup.
 */
export default function MovePanel({ moves, hints, onMove, onPreview, disabled, struggle }: {
  moves: Move[];
  hints: MoveHint[];
  onMove: (slot: number) => void;
  onPreview: (move: Move | null) => void;
  disabled: boolean;
  struggle: Move;
}) {
  const root = useRef<HTMLDivElement>(null);
  const exhausted = moves.every((move) => move.pp === 0);
  useEffect(() => {
    if (!disabled) root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [moves, exhausted, disabled]);

  const cards: Array<{ slot: number; move: Move; hint: MoveHint }> = exhausted
    ? [{ slot: -1, move: struggle, hint: null }]
    : moves.map((move, slot) => ({ slot, move, hint: hints[slot] ?? null }));

  return <div
    className={`battle-moves ${exhausted ? 'is-struggle' : ''}`}
    ref={root}
    role="group"
    aria-label="Choose a move"
    onMouseLeave={() => onPreview(null)}
    onKeyDown={(event) => {
      const offset = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 2, ArrowUp: -2 }[event.key];
      const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      if (offset !== undefined && buttons.length > 0) {
        event.preventDefault();
        const index = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
        buttons[(index + offset + buttons.length) % buttons.length]?.focus();
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        (event.key === 'Home' ? buttons[0] : buttons.at(-1))?.focus();
      }
    }}>
    {cards.map(({ slot, move, hint }) => <button
      key={slot}
      type="button"
      className={`battle-move type-${move.type} ${hint ? `has-${hint.tone}` : ''} ${slot !== -1 && move.pp === 0 ? 'is-empty' : ''}`}
      disabled={disabled || (slot !== -1 && move.pp === 0)}
      onFocus={() => onPreview(move)}
      onBlur={() => onPreview(null)}
      onMouseEnter={() => onPreview(move)}
      onClick={() => onMove(slot)}>
      <span className="move-head"><strong>{label(move.name)}</strong><span className="move-slot" aria-hidden="true">{slot < 0 ? '—' : String(slot + 1).padStart(2, '0')}</span></span>
      <span className="move-foot">
        <span className="move-category" title={move.damageClass} aria-label={move.damageClass}>{CATEGORY_GLYPH[move.damageClass]}</span>
        <span className="move-type-name">{move.type}</span>
        <span className="move-pp">{move.pp}<i>/{move.maxPp}</i></span>
      </span>
      {hint
        ? <span className={`move-hint hint-${hint.tone}`}>{hint.label}</span>
        : <span className="move-hint hint-power">{move.power === null ? 'Status move' : `Power ${move.power}`}</span>}
    </button>)}
  </div>;
}
