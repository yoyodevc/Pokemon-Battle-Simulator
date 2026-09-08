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
  play(kind: string, type = 'normal') {
    const context = this.context;
    if (!context || context.state !== 'running') return;
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
