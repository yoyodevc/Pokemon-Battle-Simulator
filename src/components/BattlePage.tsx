import { useEffect, useState } from 'react';
import { loadBattle, type BattleMode } from '../api/battleSetup';
import { pokeApi } from '../api/client';
import { seedFromQuery } from '../engine/rng';
import { BattleProvider } from '../state/BattleContext';
import BattleScene from './BattleScene';
import BattleSetup from './BattleSetup';
import type { CpuDifficulty } from '../state/cpuStrategy';

type Roster = string[];
type SetupConfig = { playerRoster: Roster; enemyRoster: Roster; mode: BattleMode; difficulty: CpuDifficulty };

export default function BattlePage() {
  const [setup, setSetup] = useState(true);
  const [config, setConfig] = useState<SetupConfig | null>(null);
  const [loaded, setLoaded] = useState<Awaited<ReturnType<typeof loadBattle>> | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [progress, setProgress] = useState(() => pokeApi.snapshot());
  useEffect(() => pokeApi.onProgress(setProgress), []);
  useEffect(() => {
    if (!config) return;
    let current = true;
    setError(false);
    setLoaded(null);
    pokeApi.resetProgress();
    void loadBattle(config.playerRoster, config.enemyRoster, config.mode, seedFromQuery(window.location.search)).then((result) => { if (current) setLoaded(result); })
      .catch(() => { if (current) setError(true); });
    return () => { current = false; };
  }, [config, attempt]);
  if (setup) return <BattleSetup onCancel={() => { window.location.hash = 'home'; }} onStart={(next) => { setConfig(next); setSetup(false); }} />;
  if (loaded && config) return <BattleProvider {...loaded} difficulty={config.difficulty}><BattleScene /></BattleProvider>;
  return <main id="main-content" className="battle-boot" role={error ? 'alert' : 'status'}>
    {!error && <span className="loading-ball" aria-hidden="true" />}
    <p className="eyebrow">LEAGUE MATCH / PREPARATION</p><h1>{error ? 'A FALSE START.' : 'TAKE YOUR POSITIONS.'}</h1>
    {error
      ? <>
        <p>Check your connection, then try again.</p>
        <div className="battle-boot-actions">
          <button className="primary-button" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
          <button className="text-button" onClick={() => setSetup(true)}>Back to team select</button>
        </div>
      </>
      : <>
        <progress value={progress.ratio} max={1} aria-label="Battle loading progress" />
        <small>Preparing your teams and moves · {Math.round(progress.ratio * 100)}%</small>
        <button className="text-button" onClick={() => setSetup(true)}>Back to team select</button>
      </>}
  </main>;
}
