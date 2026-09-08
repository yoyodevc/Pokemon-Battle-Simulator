import type { Move } from '../engine/types';

/** Stable move-specific voices, scheduled on the audio clock without downloads. */
export function moveSound(move: Move) {
  const name = move.name.toLowerCase().replaceAll(' ', '-');
  let seed = 2166136261;
  for (const character of name) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
  const style = move.damageClass === 'status' ? 'chime'
    : /slash|claw|cut|blade|scratch/.test(name) ? 'slash'
    : /punch|kick|slam|tackle|bite|crunch/.test(name) ? 'impact'
    : /beam|ray|cannon|pulse/.test(name) ? 'beam'
    : /flame|fire|burn|ember/.test(name) ? 'flame'
    : /thunder|spark|volt|shock/.test(name) ? 'electric'
    : /water|surf|hydro|bubble/.test(name) ? 'water' : 'burst';
  const base: Record<string, number> = { fire: 130, water: 380, electric: 880, grass: 520, ice: 1100, psychic: 660, ghost: 170, dark: 95, steel: 740, fairy: 990 };
  return { style, seed, frequency: (base[move.type] ?? 240) * (0.7 + (seed % 101) / 100),
    pulses: style === 'beam' ? 1 : 2 + seed % 4,
    duration: 0.5 + ((seed >>> 8) % 35) / 100 };
}

/** Short synthesized effects: no network request on the attack path. */
export class BattleAudio {
  private context: AudioContext | null = null;
  private voices = new Set<OscillatorNode>();
  unlock() {
    try {
      this.context ??= new AudioContext({ latencyHint: 'interactive' });
      if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined);
    } catch { /* Audio is optional on unsupported browsers. */ }
  }
  play(kind: string, move?: Move) {
    const context = this.context;
    if (!context || context.state !== 'running') return;
    if (kind === 'move' && move) {
      const profile = moveSound(move);
      const start = context.currentTime;
      for (let index = 0; index < profile.pulses; index += 1) {
        const at = start + index * profile.duration / profile.pulses;
        const duration = profile.duration / profile.pulses * 0.85;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const filter = context.createBiquadFilter();
        oscillator.type = profile.style === 'chime' || profile.style === 'water' ? 'sine'
          : profile.style === 'electric' ? 'square'
          : ['slash', 'flame', 'beam'].includes(profile.style) ? 'sawtooth' : 'triangle';
        const frequency = profile.frequency * (1 + ((profile.seed >>> (index * 4)) & 15) / 20);
        oscillator.frequency.setValueAtTime(frequency, at);
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(35, frequency *
          (profile.style === 'chime' ? 1.5 : profile.style === 'beam' ? 0.8 : 0.15 + index * 0.12)), at + duration);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(profile.style === 'impact' ? 650 : 3200, at);
        filter.frequency.exponentialRampToValueAtTime(180, at + duration);
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.09, at + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
        oscillator.connect(filter).connect(gain).connect(context.destination);
        this.voices.add(oscillator);
        oscillator.onended = () => { this.voices.delete(oscillator); oscillator.disconnect(); filter.disconnect(); gain.disconnect(); };
        oscillator.start(at);
        oscillator.stop(at + duration);
      }
      return;
    }
    const type = move?.type ?? 'normal';
    const frequencies: Record<string, number> = { fire: 130, water: 380, electric: 880, grass: 520, ice: 1100, psychic: 660, ghost: 170, dark: 95, steel: 740, fairy: 990 };
    const start = context.currentTime;
    const duration = kind === 'move' ? 0.48 : 0.3;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type === 'electric' || kind === 'damage' ? 'sawtooth' : 'triangle';
    const frequency = kind === 'faint' ? 300 : kind === 'switch' ? 400 : kind === 'damage' ? 100 : frequencies[type] ?? 240;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(kind === 'switch' ? 1000 : Math.max(35, frequency / 3), start + duration);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.07, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain).connect(context.destination);
    this.voices.add(oscillator);
    oscillator.onended = () => { this.voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(start);
    oscillator.stop(start + duration);
  }
  stop() { for (const voice of this.voices) { voice.stop(); } this.voices.clear(); }
  close() { this.stop(); void this.context?.close(); this.context = null; }
}
