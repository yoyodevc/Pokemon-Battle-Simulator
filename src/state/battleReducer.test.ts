import { describe, expect, it } from 'vitest';
import { createBattle } from '../engine/turn';
import { DEMO_CHART, demoTeams } from '../engine/fixtures';
import { battleReducer, initialSession } from './battleReducer';

describe('battle UI reducer', () => {
  it('resolves turns without mutating the session and replays deterministically', () => {
    const session = initialSession(createBattle(demoTeams(), DEMO_CHART, 1));
    const before = structuredClone(session);
    const command = { type: 'act', action: { kind: 'move', slot: 0 } } as const;
    const next = battleReducer(session, command);
    expect(session).toEqual(before);
    expect(next.battle.turn).toBe(1);
    expect(next.events.length).toBeGreaterThan(0);
    expect(battleReducer(session, command)).toEqual(next);
  });
  it('automatically replaces an opponent-only faint', () => {
    const battle = createBattle(demoTeams(), DEMO_CHART);
    battle.teams[1].pokemon[0]!.hp = 1;
    battle.teams[0].pokemon[0]!.moves[0]!.accuracy = null;
    const next = battleReducer(initialSession(battle), { type: 'act', action: { kind: 'move', slot: 0 } });
    expect(next.battle.teams[1].active).toBe(1);
    expect(next.battle.turn).toBe(1);
    expect(next.battle.phase).toBe('turn');
  });
  it('holds for player replacement without charging a turn', () => {
    const battle = createBattle(demoTeams(), DEMO_CHART);
    battle.teams[0].pokemon[0]!.hp = 0;
    battle.phase = 'switch';
    const next = battleReducer(initialSession(battle), { type: 'act', action: { kind: 'switch', slot: 1 } });
    expect(next.battle.turn).toBe(0);
    expect(next.battle.teams[0].active).toBe(1);
    expect(next.events.map((event) => event.kind)).toEqual(['switch']);
  });
  it('ends on forfeit and restarts with cleared events and restored HP', () => {
    const battle = createBattle(demoTeams(), DEMO_CHART);
    const ended = battleReducer(initialSession(battle), { type: 'act', action: { kind: 'forfeit' } });
    expect(ended.battle.winner).toBe(1);
    expect(battleReducer(ended, { type: 'restart', battle })).toEqual(initialSession(battle));
  });
  it('holds Player 1 choice until Player 2 submits the second choice', () => {
    const battle = createBattle(demoTeams(), DEMO_CHART, 1);
    const session = initialSession(battle, 'local');
    const first = battleReducer(session, { type: 'act', action: { kind: 'move', slot: 0 } });
    expect(first.pendingPlayerAction).toEqual({ kind: 'move', slot: 0 });
    expect(first.battle.turn).toBe(0);
    const second = battleReducer(first, { type: 'act', action: { kind: 'move', slot: 0 } });
    expect(second.pendingPlayerAction).toBeNull();
    expect(second.battle.turn).toBe(1);
    expect(second.events.length).toBeGreaterThan(0);
  });
});
