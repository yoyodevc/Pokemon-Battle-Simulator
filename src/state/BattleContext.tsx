import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';
import type { BattleState } from '../engine/types';
import type { BattleMode } from '../api/battleSetup';
import type { Pokemon as ApiPokemon } from '../api/types';
import { battleReducer, initialSession, type BattleSession, type SessionAction } from './battleReducer';
import type { CpuDifficulty } from './cpuStrategy';

export interface BattleContextValue {
  session: BattleSession;
  dispatch: Dispatch<SessionAction>;
  initial: BattleState;
  sprites: Record<string, ApiPokemon>;
}

const BattleContext = createContext<BattleContextValue | null>(null);

export function BattleProvider({ initial, sprites, mode, difficulty, children }: {
  initial: BattleState;
  sprites: Record<string, ApiPokemon>;
  mode: BattleMode;
  difficulty: CpuDifficulty;
  children: ReactNode;
}) {
  const [session, dispatch] = useReducer(
    battleReducer,
    { initial, mode, difficulty },
    (config) => initialSession(config.initial, config.mode, config.difficulty),
  );
  return <BattleContext.Provider value={{ session, dispatch, initial, sprites }}>{children}</BattleContext.Provider>;
}

export function useBattle(): BattleContextValue {
  const value = useContext(BattleContext);
  if (!value) throw new Error('BattleProvider is required');
  return value;
}
