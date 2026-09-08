import { afterEach, expect, it, vi } from 'vitest';
import { BattleAudio } from './battleAudio';
import { makeMove } from '../engine/fixtures';

afterEach(() => vi.unstubAllGlobals());

it('preloads recordings and schedules Flamethrower cues without fetching during playback', async () => {
  const sources: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
  const oscillator = vi.fn();
  const ramp = () => ({ setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() });
  const context = {
    state: 'running', currentTime: 10, destination: {},
    decodeAudioData: vi.fn(async () => ({ duration: 2 })),
    createBufferSource: () => {
      const source = { playbackRate: { value: 1 }, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      source.connect.mockReturnValue({ connect: vi.fn() });
      sources.push(source);
      return source;
    },
    createGain: () => ({ gain: ramp(), disconnect: vi.fn() }),
    createOscillator: oscillator,
  };
  vi.stubGlobal('AudioContext', class { constructor() { return context; } });
  const fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  vi.stubGlobal('fetch', fetchMock);
  const audio = new BattleAudio();
  const move = makeMove({ name: 'flamethrower', type: 'fire' });
  await audio.prepare([move]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  audio.play('move', move);
  expect(oscillator).not.toHaveBeenCalled();
  expect(sources).toHaveLength(3);
  expect(sources[0]!.start).toHaveBeenCalledWith(10);
  expect(sources[1]!.start).toHaveBeenCalledWith(10.1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  audio.stop();
  for (const source of sources) expect(source.stop).toHaveBeenCalledTimes(2);
});
