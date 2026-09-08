import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBattle } from '../state/BattleContext';
import { effectiveness } from '../engine/damage';
import { STRUGGLE } from '../engine/turn';
import { activePokemon, label, type Action, type BattleEvent, type BattleState, type Move, type Side, type Status, type TypeChart } from '../engine/types';
import type { Pokemon as ApiPokemon } from '../api/types';
import HealthBar from './HealthBar';
import MovePanel, { type MoveHint } from './MovePanel';
import SwitchMenu from './SwitchMenu';
import BattleLog from './BattleLog';
import ForfeitDialog from './ForfeitDialog';
import { BattleAudio } from './battleAudio';

const STATUS_LABELS: Record<Status, string> = {
  burn: 'BRN', poison: 'PSN', toxic: 'TOX', paralysis: 'PAR', sleep: 'SLP', freeze: 'FRZ',
};

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return;
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

/** Honest elapsed clock. The previous build showed a countdown that enforced nothing. */
function useElapsedClock(running: boolean, match: number): string {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => setSeconds(0), [match]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function useBattleCries(playerName: string, opponentName: string, sprites: Record<string, ApiPokemon>, enabled: boolean): void {
  const clips = useMemo(() => Object.fromEntries(Object.entries(sprites).flatMap(([name, pokemon]) => {
    const url = pokemon.cries.latest || pokemon.cries.legacy;
    if (!url) return [];
    const clip = new Audio(url);
    clip.preload = 'auto';
    clip.volume = 0.22;
    return [[name, clip]];
  })), [sprites]);
  useEffect(() => {
    Object.values(clips).forEach((clip) => clip.load());
    return () => Object.values(clips).forEach((clip) => { clip.pause(); clip.removeAttribute('src'); clip.load(); });
  }, [clips]);
  const previous = useRef({ player: '', opponent: '' });
  useEffect(() => {
    const entering = previous.current.player === '' && previous.current.opponent === ''
      ? [opponentName, playerName]
      : [playerName !== previous.current.player ? playerName : '', opponentName !== previous.current.opponent ? opponentName : ''].filter(Boolean);
    previous.current = { player: playerName, opponent: opponentName };
    if (!enabled) return;
    // Do not let an unloaded cry start seconds after its entrance animation.
    for (const name of entering) {
      const clip = clips[name];
      if (clip && clip.readyState >= 3) { clip.currentTime = 0; void clip.play().catch(() => undefined); }
    }
    return () => Object.values(clips).forEach((clip) => clip.pause());
  }, [enabled, opponentName, playerName, clips]);
}

function eventVisualDelay(event: BattleEvent | undefined, reducedMotion: boolean): number {
  if (reducedMotion) return 100;
  switch (event?.kind) {
    case 'move': return 1100;
    case 'damage': return 650;
    case 'critical': return 700;
    case 'faint': return 900;
    case 'switch': return 820;
    default: return 420;
  }
}

function eventDelay(event: BattleEvent | undefined, reducedMotion: boolean): number {
  if (reducedMotion) return 700;
  switch (event?.kind) {
    case 'move': return 1800;
    case 'damage': return 1050;
    case 'effectiveness': return 1250;
    case 'critical': return 1100;
    case 'faint': return 1450;
    case 'switch': return 1350;
    case 'end': return 1700;
    case 'status':
    case 'stage':
    case 'heal':
    case 'hits':
    case 'miss':
    case 'unable': return 1650;
    default: return 1500;
  }
}

function useEventPresentation(events: BattleEvent[], reducedMotion: boolean) {
  const previousLength = useRef(events.length);
  const timer = useRef<number | null>(null);
  const visualTimer = useRef<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(events.length);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [visualReady, setVisualReady] = useState(true);
  const revealNext = useCallback(() => {
    setActiveIndex((current) => {
      if (current < 0) return current;
      if (current + 1 < events.length) {
        setVisibleCount(current + 2);
        return current + 1;
      }
      setVisibleCount(events.length);
      return -1;
    });
  }, [events.length]);
  const advance = useCallback(() => {
    if (visualReady) revealNext();
  }, [revealNext, visualReady]);

  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (visualTimer.current !== null) window.clearTimeout(visualTimer.current);
    const previous = previousLength.current;
    previousLength.current = events.length;
    if (events.length === 0) {
      setVisibleCount(0);
      setActiveIndex(-1);
      setVisualReady(true);
      return;
    }
    if (events.length <= previous) return;
    setVisibleCount(previous + 1);
    setActiveIndex(previous);
    setVisualReady(false);
    return () => { if (timer.current !== null) window.clearTimeout(timer.current); };
  }, [events.length]);

  useEffect(() => {
    if (activeIndex < 0) {
      setVisualReady(true);
      return;
    }
    setVisualReady(false);
    visualTimer.current = window.setTimeout(() => setVisualReady(true), eventVisualDelay(events[activeIndex], reducedMotion));
    timer.current = window.setTimeout(() => {
      setVisualReady(true);
      revealNext();
    }, eventDelay(events[activeIndex], reducedMotion));
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      if (visualTimer.current !== null) window.clearTimeout(visualTimer.current);
    };
  }, [activeIndex, events, reducedMotion, revealNext]);

  return { visibleCount, activeIndex, busy: activeIndex >= 0, visualReady, advance };
}

/**
 * Type advantage is printed on the move button itself instead of behind a
 * confirmation dialog, so the readout also works on touch, where there is no
 * hover to reveal it. Neutral matchups stay unlabelled to avoid noise.
 */
function moveHint(chart: TypeChart, move: Move, defenderTypes: readonly string[]): MoveHint {
  if (move.target === 'self' || move.damageClass === 'status' || move.power === null) return null;
  const multiplier = effectiveness(chart, move.type, defenderTypes);
  if (multiplier === 0) return { tone: 'immune', label: 'No effect' };
  if (multiplier >= 4) return { tone: 'strong', label: 'Super effective ×4' };
  if (multiplier > 1) return { tone: 'strong', label: 'Super effective' };
  if (multiplier <= 0.25) return { tone: 'weak', label: 'Barely effective' };
  if (multiplier < 1) return { tone: 'weak', label: 'Not very effective' };
  return null;
}

function StatusCapsule({ side, battle, displayHp }: { side: Side; battle: BattleState; displayHp?: number }) {
  const team = battle.teams[side];
  const pokemon = activePokemon(battle, side);
  const hp = displayHp ?? pokemon.hp;
  const ratio = hp / pokemon.stats.hp;
  const tone = hp === 0 ? 'is-out' : ratio <= 0.2 ? 'is-critical' : ratio <= 0.5 ? 'is-low' : '';
  return <div className={`status-capsule capsule-${side === 0 ? 'ally' : 'foe'} ${tone}`}>
    <div className="capsule-party" aria-label={`${team.name} party status`}>
      {team.pokemon.map((member, slot) => <i
        key={slot}
        className={`${member.hp === 0 ? 'pip-fainted' : ''} ${slot === team.active ? 'pip-active' : ''}`}
        title={`${label(member.name)}: ${member.hp === 0 ? 'fainted' : slot === team.active ? 'in battle' : 'ready'}`} />)}
    </div>
    <div className="capsule-body">
      <div className="capsule-identity">
        <h2>{label(pokemon.name)}</h2>
        {pokemon.status && <b className={`status-badge status-${pokemon.status}`}>{STATUS_LABELS[pokemon.status]}</b>}
        <span className="capsule-level">Lv{pokemon.level}</span>
      </div>
      <div className="capsule-meter">
        <span className="capsule-hp-label" aria-hidden="true">HP</span>
        <HealthBar hp={hp} maxHp={pokemon.stats.hp} name={label(pokemon.name)} />
        <span className="capsule-numbers">{side === 0 ? `${hp}/${pokemon.stats.hp}` : `${Math.max(0, Math.round(ratio * 100))}%`}</span>
      </div>
      <div className="capsule-types">{pokemon.types.map((type) => <b key={type} className={`type-chip type-${type}`}>{type}</b>)}</div>
    </div>
  </div>;
}

function Combatant({ side, battle, pulse, switchingOut = false, fainted = false }: {
  side: Side;
  battle: BattleState;
  pulse?: 'attack' | 'hit';
  switchingOut?: boolean;
  fainted?: boolean;
}) {
  const { sprites } = useBattle();
  const pokemon = activePokemon(battle, side);
  const data = sprites[pokemon.name];
  const [failed, setFailed] = useState(false);
  const previousName = useRef(pokemon.name);
  const [switchingIn, setSwitchingIn] = useState(false);
  useEffect(() => setFailed(false), [pokemon.name]);
  useEffect(() => {
    if (previousName.current === pokemon.name) return;
    previousName.current = pokemon.name;
    setSwitchingIn(true);
    const timer = window.setTimeout(() => setSwitchingIn(false), 720);
    return () => window.clearTimeout(timer);
  }, [pokemon.name]);
  const sprite = side === 0
    ? data?.sprites.other?.showdown?.back_default ?? data?.sprites.back_default
    : data?.sprites.other?.showdown?.front_default ?? data?.sprites.front_default;
  return <div className={`combatant combatant-${side} ${fainted ? 'is-fainted' : ''} ${pulse ? `is-${pulse}` : ''} ${switchingOut ? 'is-withdrawing' : ''} ${switchingIn ? 'is-switching-in' : ''}`}>
    <span className="combatant-shadow" aria-hidden="true" />
    {sprite && !failed
      ? <img key={pokemon.name} src={sprite} width={192} height={192} alt={label(pokemon.name)} onError={() => setFailed(true)} />
      : <span className="battle-sprite-fallback">{label(pokemon.name)}</span>}
  </div>;
}

const MOVE_GLYPHS: Record<string, string> = {
  normal: '✦', fire: '✹', water: '≈', electric: '⚡', grass: '✽', ice: '❄',
  fighting: '✹', poison: '✣', ground: '◒', flying: '↗', psychic: '◈', bug: '⊹',
  rock: '◆', ghost: '☾', dragon: '◇', dark: '●', steel: '✚', fairy: '✧',
};

type MoveEffectVariant =
  | 'slash' | 'bite' | 'flame' | 'beam' | 'electric' | 'water'
  | 'wind' | 'earth' | 'ice' | 'nature' | 'poison' | 'impact'
  | 'ghost' | 'dark' | 'aura' | 'type';

function moveEffectVariant(move: Move): MoveEffectVariant {
  const name = move.name.toLowerCase().replaceAll(' ', '-');
  const has = (...terms: string[]) => terms.some((term) => name.includes(term));

  // Status moves get a readable field effect rather than a pretend projectile.
  if (move.damageClass === 'status' || move.power === null) return 'aura';
  if (has('scratch', 'slash', 'cut', 'claw', 'swipe', 'scissor', 'blade', 'fury-attack', 'metal-claw')) return 'slash';
  if (has('bite', 'fang', 'jaw', 'crunch')) return 'bite';
  if (has('flame', 'flare', 'fire', 'ember', 'heat', 'blaze', 'lava', 'overheat', 'eruption', 'inferno', 'scorch')) return 'flame';
  if (has('beam', 'pulse', 'ball', 'cannon', 'bomb', 'meteor', 'comet', 'ray', 'laser')) return 'beam';
  if (has('thunder', 'electric', 'spark', 'volt', 'shock', 'zap', 'discharge', 'wild-charge')) return 'electric';
  if (has('water', 'hydro', 'surf', 'aqua', 'scald', 'whirlpool', 'wave', 'liquidation')) return 'water';
  if (has('gust', 'air', 'wind', 'wing', 'hurricane', 'tornado', 'whirlwind', 'aerial', 'fly', 'acrobatics')) return 'wind';
  if (has('earth', 'quake', 'ground', 'mud', 'sand', 'bulldoze', 'drill', 'rock', 'stone', 'meteor')) return 'earth';
  if (has('ice', 'frost', 'freeze', 'blizzard', 'powder', 'icy')) return 'ice';
  if (has('leaf', 'grass', 'vine', 'seed', 'petal', 'pollen', 'spore', 'giga-drain', 'wood-hammer', 'power-whip')) return 'nature';
  if (has('poison', 'toxic', 'sludge', 'venom', 'acid', 'gunk', 'smog')) return 'poison';
  if (move.type === 'fire') return 'flame';
  if (move.type === 'water') return 'water';
  if (move.type === 'electric') return 'electric';
  if (move.type === 'flying') return 'wind';
  if (move.type === 'ground' || move.type === 'rock') return 'earth';
  if (move.type === 'ice') return 'ice';
  if (move.type === 'grass' || move.type === 'bug') return 'nature';
  if (move.type === 'poison') return 'poison';
  if (move.type === 'ghost') return 'ghost';
  if (move.type === 'dark') return 'dark';
  if (move.type === 'fighting' || has('punch', 'kick', 'tackle', 'strike', 'impact', 'slam', 'smash')) return 'impact';
  if (move.type === 'psychic' || move.type === 'fairy') return 'aura';
  if (move.type === 'dragon' || move.type === 'steel') return 'beam';
  // The type fallback is still animated: it gets the shared trail/core/spark
  // treatment so newly-added API moves never render without feedback.
  return 'type';
}

function moveForEvent(event: BattleEvent | undefined, battle: BattleState): Move | null {
  if (!event || event.kind !== 'move') return null;
  if (event.move) return event.move;
  const message = event.message.toLowerCase();
  return battle.teams[event.side].pokemon
    .flatMap((pokemon) => pokemon.moves)
    .find((move) => message.includes(label(move.name).toLowerCase())) ?? null;
}

function MoveEffect({ move, side }: { move: Move; side: Side }) {
  const variant = moveEffectVariant(move);
  return <div className={`move-effect move-effect-${move.type} move-effect-variant-${variant} move-effect-side-${side}`} aria-hidden="true">
    <span className="move-effect-trail" />
    <span className="move-effect-core">{MOVE_GLYPHS[move.type] ?? '✦'}</span>
    {variant === 'slash' && <span className="move-effect-slashes"><i /><i /><i /></span>}
    {variant === 'bite' && <span className="move-effect-jaws" />}
    {variant === 'flame' && <span className="move-effect-flames"><i /><i /><i /></span>}
    {variant === 'beam' && <span className="move-effect-rings"><i /><i /><i /></span>}
    {variant === 'electric' && <span className="move-effect-lightning"><i /><i /><i /></span>}
    {variant === 'water' && <span className="move-effect-ripples"><i /><i /><i /></span>}
    {variant === 'wind' && <span className="move-effect-wind"><i /><i /><i /></span>}
    {variant === 'earth' && <span className="move-effect-shards"><i /><i /><i /><i /></span>}
    {variant === 'ice' && <span className="move-effect-crystals"><i /><i /><i /></span>}
    {variant === 'nature' && <span className="move-effect-vines"><i /><i /><i /></span>}
    {variant === 'poison' && <span className="move-effect-bubbles"><i /><i /><i /><i /></span>}
    {variant === 'impact' && <span className="move-effect-impact"><i /><i /><i /><i /></span>}
    {variant === 'ghost' && <span className="move-effect-wisps"><i /><i /><i /></span>}
    {variant === 'dark' && <span className="move-effect-dark-orbit"><i /><i /><i /></span>}
    {variant === 'aura' && <span className="move-effect-aura"><i /><i /><i /></span>}
    <span className="move-effect-spark move-effect-spark-one" />
    <span className="move-effect-spark move-effect-spark-two" />
  </div>;
}

export default function BattleScene() {
  const { session, dispatch, initial, sprites } = useBattle();
  const { battle, events, mode, pendingPlayerAction } = session;
  const player = activePokemon(battle, 0);
  const opponent = activePokemon(battle, 1);
  const [switching, setSwitching] = useState(false);
  const [showOpponent, setShowOpponent] = useState(false);
  const [confirmForfeit, setConfirmForfeit] = useState(false);
  const [criesEnabled, setCriesEnabled] = useState(true);
  const audio = useMemo(() => new BattleAudio(), []);
  const [logOpen, setLogOpen] = useState(false);
  const [preview, setPreview] = useState<Move | null>(null);
  const [match, setMatch] = useState(0);
  const dialogueRef = useRef<HTMLElement>(null);
  const forced = battle.phase === 'switch';
  const ended = battle.phase === 'ended';
  const winnerName = battle.winner === 0 || battle.winner === 1 ? battle.teams[battle.winner].name : '';
  const localWaiting = mode === 'local' && pendingPlayerAction !== null;
  const reducedMotion = useReducedMotion();
  const elapsed = useElapsedClock(!ended, match);
  const presentation = useEventPresentation(events, reducedMotion);
  const activeEvent = presentation.activeIndex >= 0 ? events[presentation.activeIndex] : undefined;
  // Keep the last presented frame while React starts a newly appended batch.
  const frame = useRef(battle);
  const displayBattle = activeEvent?.teams ? { ...battle, teams: activeEvent.teams, turn: activeEvent.turn }
    : presentation.visibleCount < events.length ? frame.current : battle;
  useEffect(() => { frame.current = displayBattle; }, [displayBattle]);
  const displayPlayer = activePokemon(displayBattle, 0);
  const displayOpponent = activePokemon(displayBattle, 1);
  useBattleCries(displayPlayer.name, displayOpponent.name, sprites, criesEnabled);
  useEffect(() => {
    if (criesEnabled && activeEvent && ['move', 'damage', 'faint', 'switch'].includes(activeEvent.kind)) {
      audio.play(activeEvent.kind, activeEvent.move?.type);
    }
    return () => audio.stop();
  }, [activeEvent, audio, criesEnabled]);
  useEffect(() => () => audio.close(), [audio]);
  const activeMove = moveForEvent(activeEvent, battle);
  const playerDisplayHp = displayPlayer.hp;
  const opponentDisplayHp = displayOpponent.hp;
  const playerFainted = displayPlayer.hp === 0 && !(activeEvent?.kind === 'damage' && activeEvent.side === 0);
  const opponentFainted = displayOpponent.hp === 0 && !(activeEvent?.kind === 'damage' && activeEvent.side === 1);

  useEffect(() => {
    if (presentation.busy) dialogueRef.current?.focus({ preventScroll: true });
  }, [presentation.activeIndex, presentation.busy]);

  useEffect(() => { if (!localWaiting) setShowOpponent(false); }, [localWaiting]);
  useEffect(() => { setPreview(null); }, [battle.turn, battle.phase]);

  // In pass-and-play the second half of a turn is driven by the same panels.
  const controllingSide: Side = mode === 'local' && localWaiting ? 1 : 0;
  const actor = controllingSide === 0 ? player : opponent;
  const target = controllingSide === 0 ? opponent : player;

  const act = useCallback((action: Action) => {
    audio.unlock();
    dispatch({ type: 'act', action });
    setSwitching(false);
    setShowOpponent(false);
    setPreview(null);
  }, [audio, dispatch]);

  const hints = useMemo(
    () => actor.moves.map((move) => moveHint(battle.chart, move, target.types)),
    [actor.moves, battle.chart, target.types],
  );

  const pulse = (side: Side): 'attack' | 'hit' | undefined => {
    if (!activeEvent) return undefined;
    if (activeEvent.kind === 'move' && activeEvent.side === side) return 'attack';
    if (activeEvent.kind === 'damage' && activeEvent.side === side) return 'hit';
    return undefined;
  };

  const controlledTeam = battle.teams[controllingSide];
  const canSwitch = controlledTeam.pokemon.some((member, slot) => slot !== controlledTeam.active && member.hp > 0);
  const waitingForHandover = localWaiting && !showOpponent;
  const inputReady = !presentation.busy && !ended && !waitingForHandover;

  const dialogue = (() => {
    if (presentation.busy) return { eyebrow: 'TURN RESOLUTION', text: activeEvent?.message ?? 'Resolving the turn…', tone: 'is-resolving' };
    if (ended) return {
      eyebrow: 'BATTLE COMPLETE',
      text: battle.winner === 'draw' ? 'The battle ended in a draw.'
        : `${winnerName} ${winnerName === 'You' ? 'win' : 'wins'} the battle!`,
      tone: 'is-result',
    };
    if (waitingForHandover) return { eyebrow: 'PASS & PLAY', text: 'Player 1 has locked in. Pass the device to Player 2.', tone: '' };
    if (forced) return { eyebrow: 'POKÉMON FAINTED', text: 'Choose the next Pokémon to send out.', tone: '' };
    if (switching) return { eyebrow: 'PARTY', text: 'Choose a Pokémon to send out.', tone: '' };
    if (preview) return {
      eyebrow: `${preview.type.toUpperCase()} · ${preview.damageClass.toUpperCase()} · POWER ${preview.power ?? '—'} · ACC ${preview.accuracy ?? '—'}`,
      text: preview.shortEffect || 'A reliable move used in Pokémon battles.',
      tone: 'is-preview',
    };
    return {
      eyebrow: controllingSide === 0 ? 'YOUR TURN' : 'PLAYER 2 · YOUR TURN',
      text: `What will ${label(actor.name)} do?`,
      tone: '',
    };
  })();

  return <main id="main-content" className="battle-page">
    <h1 className="sr-only">Battle arena</h1>
    <div className={`battle-arena ${presentation.busy ? 'is-busy' : ''}`}>
      <div className="arena-scenery" aria-hidden="true">
        <span className="arena-sky" /><span className="stadium-roof" /><span className="stadium-lights lights-left" /><span className="stadium-lights lights-right" /><span className="stadium-stands" />
        <span className="stadium-banner">POKÉMON BATTLE LEAGUE <b>✦</b> THE STAGE IS YOURS <b>✦</b> POKÉMON BATTLE LEAGUE</span>
        <span className="arena-field" /><span className="field-markings" /><span className="arena-haze" /><span className="arena-vignette" />
      </div>

      <div className="arena-stage" aria-hidden={waitingForHandover}>
        {activeMove && activeEvent && <MoveEffect key={presentation.activeIndex} move={activeMove} side={activeEvent.side} />}
        <Combatant battle={displayBattle} side={1} pulse={pulse(1)} fainted={opponentFainted} />
        <Combatant battle={displayBattle} side={0} pulse={pulse(0)} fainted={playerFainted} />
      </div>

      <div className="arena-hud">
        <div className="hud-bar">
          <span className="hud-match">{mode === 'cpu' ? `SINGLE BATTLE · ${session.difficulty.toUpperCase()} CPU` : 'SINGLE BATTLE · PASS & PLAY'}</span>
          <span className="hud-turn">TURN <strong>{String(battle.turn).padStart(2, '0')}</strong></span>
          <span className="hud-clock"><small>ELAPSED</small><strong>{elapsed}</strong></span>
          <button type="button" className={`hud-toggle ${logOpen ? 'is-on' : ''}`} aria-pressed={logOpen} onClick={() => setLogOpen((value) => !value)}>
            <span aria-hidden="true">▤</span> Log
          </button>
          <button
            type="button"
            className={`hud-toggle ${criesEnabled ? 'is-on' : ''}`}
            aria-pressed={criesEnabled}
            aria-label={`${criesEnabled ? 'Mute' : 'Enable'} battle audio`}
            onClick={() => {
              audio.unlock();
              setCriesEnabled((value) => !value);
            }}><span aria-hidden="true">{criesEnabled ? '◉' : '◌'}</span> Audio</button>
          <a className="hud-toggle hud-exit" href="#home">Exit</a>
        </div>

        <StatusCapsule battle={displayBattle} side={1} displayHp={opponentDisplayHp} />
        <StatusCapsule battle={displayBattle} side={0} displayHp={playerDisplayHp} />

        {ended && !presentation.busy && <div className={`result-banner ${battle.winner === 0 || mode === 'local' ? 'is-victory' : ''}`} role="status"><span className="eyebrow">MATCH COMPLETE / {battle.turn} TURNS</span><strong>{battle.winner === 'draw' ? 'HONORS EVEN.' : mode === 'local' ? `${winnerName} WINS.` : battle.winner === 0 ? 'VICTORY.' : 'WELL FOUGHT.'}</strong><p>{battle.winner === 'draw' ? 'Two worthy rivals. One unforgettable match.' : battle.winner === 0 || mode === 'local' ? 'A great team. A greater performance.' : 'Every rival teaches you something. Come back stronger.'}</p></div>}

        {logOpen && <BattleLog events={events.slice(0, presentation.visibleCount)} activeIndex={presentation.activeIndex} onClose={() => setLogOpen(false)} />}

        <section
          ref={dialogueRef}
          className={`battle-dialogue ${dialogue.tone} ${presentation.busy && presentation.visualReady ? 'is-advanceable' : ''}`}
          aria-live="polite"
          aria-label={presentation.busy
            ? presentation.visualReady
              ? 'Battle message. Press Enter, Space, or click to continue.'
              : 'Battle message. Please wait for the animation to finish.'
            : undefined}
          tabIndex={presentation.busy ? 0 : undefined}
          onClick={() => { if (presentation.busy) presentation.advance(); }}
          onKeyDown={(event) => {
            if (presentation.busy && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault();
              presentation.advance();
            }
          }}>
          <p className="eyebrow">{dialogue.eyebrow}</p>
          <p className="dialogue-text">{dialogue.text}</p>
          {presentation.busy && <p className="dialogue-advance" aria-hidden="true">
            {presentation.visualReady ? 'CLICK / ENTER / SPACE TO CONTINUE' : 'PLAYING OUT…'}
          </p>}
        </section>

        <div className="battle-command">
          {ended && !presentation.busy ? <div className="command-endcard">
            <button className="cmd-button cmd-fight" onClick={() => { dispatch({ type: 'restart', battle: initial, mode, difficulty: session.difficulty }); setMatch((value) => value + 1); setSwitching(false); setConfirmForfeit(false); }}>
              <span aria-hidden="true">↻</span> Rematch
            </button>
            <a className="cmd-button cmd-run" href="#home"><span aria-hidden="true">⌂</span> Home</a>
          </div>
          : waitingForHandover ? <div className="command-endcard">
            <button className="cmd-button cmd-fight" onClick={() => setShowOpponent(true)}><span aria-hidden="true">▶</span> Player 2 ready</button>
          </div>
          : switching || forced ? <SwitchMenu
              team={controlledTeam}
              disabled={!inputReady}
              forced={forced}
              onBack={() => setSwitching(false)}
              onSwitch={(slot) => act({ kind: 'switch', slot })} />
          : <div className="command-fight">
            <MovePanel
              moves={actor.moves}
              hints={hints}
              disabled={!inputReady}
              struggle={STRUGGLE}
              onPreview={setPreview}
              onMove={(slot) => act({ kind: 'move', slot })} />
            <div className="command-side">
              <button type="button" className="cmd-button cmd-party" disabled={!canSwitch || !inputReady} onClick={() => setSwitching(true)}>
                <span aria-hidden="true">⇄</span> Pokémon
              </button>
              <button type="button" className="cmd-button cmd-run" disabled={!inputReady} onClick={() => setConfirmForfeit(true)}>
                <span aria-hidden="true">↩</span> Run
              </button>
            </div>
          </div>}
        </div>
      </div>

      {confirmForfeit && !ended && <ForfeitDialog onCancel={() => setConfirmForfeit(false)} onConfirm={() => { act({ kind: 'forfeit' }); setConfirmForfeit(false); }} />}
    </div>
  </main>;
}
