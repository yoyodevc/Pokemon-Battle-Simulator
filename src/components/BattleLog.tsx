import { useEffect, useRef } from 'react';
import type { BattleEvent } from '../engine/types';

export default function BattleLog({ events, activeIndex = -1, onClose }: {
  events: BattleEvent[]; activeIndex?: number; onClose?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (root.current) root.current.scrollTop = root.current.scrollHeight; }, [events.length]);
  let lastTurn = -1;
  return <aside className="battle-log" aria-label="Battle log">
    <div className="log-header">
      <h2>Battle log</h2>
      <span>{events.length} {events.length === 1 ? 'event' : 'events'}</span>
      {onClose && <button type="button" className="log-close" onClick={onClose} aria-label="Hide battle log">×</button>}
    </div>
    <div className="log-feed" ref={root} role="log" aria-label="Battle events" aria-live="polite" aria-relevant="additions" tabIndex={0}>
      {events.length === 0 && <p className="log-empty">Both trainers are ready.</p>}
      {events.map((event, index) => {
        const showTurn = event.turn !== lastTurn;
        lastTurn = event.turn;
        return <p className={`log-line log-${event.kind} ${activeIndex === index ? 'is-active' : ''}`} key={index}>
          {showTurn && <span className="log-turn">Turn {event.turn}</span>}
          <span className="log-message">{event.message}</span>
        </p>;
      })}
    </div>
  </aside>;
}
