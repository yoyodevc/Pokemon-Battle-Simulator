import { afterEach, expect, it, vi } from 'vitest';
import { BattleMusic } from './battleMusic';

afterEach(() => { vi.unstubAllGlobals(); });

it('loops music once, changes volume, and releases audio on exit', () => {
  const audio = {
    paused: true, loop: false, volume: 1, currentTime: 0, readyState: 0,
    addEventListener: vi.fn(),
    play: vi.fn(() => { audio.paused = false; return Promise.resolve(); }),
    pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn(),
  };
  const sources: string[] = [];
  vi.stubGlobal('Audio', class { constructor(src: string) { sources.push(src); return audio; } });
  const music = new BattleMusic();
  music.start(); music.start();
  expect(sources).toEqual(['/audio/battle-source.mp3']);
  expect(audio.loop).toBe(false);
  expect(audio.play).toHaveBeenCalledTimes(1);
  music.setVolume(0);
  expect(audio.volume).toBe(0);
  music.close();
  expect(audio.pause).toHaveBeenCalledTimes(1);
  expect(audio.removeAttribute).toHaveBeenCalledWith('src');
  expect(audio.load).toHaveBeenCalledTimes(1);
});

it('retries blocked autoplay on the next interaction without creating a second player', async () => {
  const audio = { paused: true, loop: false, volume: 1, currentTime: 0, readyState: 0, addEventListener: vi.fn(), play: vi.fn().mockRejectedValueOnce(new Error('NotAllowedError')).mockResolvedValue(undefined) };
  let players = 0;
  vi.stubGlobal('Audio', class { constructor() { players++; return audio; } });
  const music = new BattleMusic();
  music.start();
  await Promise.resolve();
  music.start();
  expect(players).toBe(1);
  expect(audio.play).toHaveBeenCalledTimes(2);
});
