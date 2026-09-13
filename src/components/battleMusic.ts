import { useEffect, useRef } from 'react';

export class BattleMusic {
  private audio: HTMLAudioElement | null = null;
  private volume = .25;
  private readonly loopStart = 4;

  setVolume(volume: number) {
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : .25;
    if (this.audio) this.audio.volume = this.volume;
  }

  start() {
    try {
      if (!this.audio) {
        this.audio = new Audio(`${import.meta.env.BASE_URL}audio/battle-source.mp3`);
        this.audio.loop = false;
        this.audio.addEventListener('loadedmetadata', () => { if (this.audio) this.audio.currentTime = this.loopStart; }, { once: true });
        this.audio.addEventListener('ended', () => {
          if (!this.audio) return;
          this.audio.currentTime = this.loopStart;
          void this.audio.play().catch(() => undefined);
        });
        this.audio.volume = this.volume;
      }
      if (this.audio.readyState >= 1 && this.audio.currentTime < this.loopStart) this.audio.currentTime = this.loopStart;
      if (this.audio.paused) void this.audio.play().catch(() => undefined);
    } catch { this.close(); }
  }

  close() {
    if (this.audio) {
      this.audio.pause();
        this.audio.removeAttribute('src');
      this.audio.load();
      this.audio = null;
    }
  }
}

export function useBattleMusic(enabled: boolean, volume: number) {
  const music = useRef<BattleMusic | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const track = new BattleMusic();
    music.current = track;
    const start = () => { if (!document.hidden) track.start(); };
    const visibility = () => { if (document.hidden) track.close(); else start(); };
    start();
    document.addEventListener('pointerdown', start);
    document.addEventListener('keydown', start);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('pointerdown', start);
      document.removeEventListener('keydown', start);
      document.removeEventListener('visibilitychange', visibility);
      track.close(); music.current = null;
    };
  }, [enabled]);
  useEffect(() => { music.current?.setVolume(volume); }, [enabled, volume]);
}
