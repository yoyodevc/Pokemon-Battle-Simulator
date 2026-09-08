import { demoTeams, DEMO_CHART } from '../src/engine/fixtures.ts';
import { randInt, seedFromQuery } from '../src/engine/rng.ts';
import { createBattle, legalActions, resolveTurn } from '../src/engine/turn.ts';

const seed = seedFromQuery(`?seed=${process.argv[2] ?? '1'}`);
const choices = { rng: seed };
let state = createBattle(demoTeams(), DEMO_CHART, seed);
console.log(`Offline demonstration battle (seed ${seed})`);
for (let step = 0; step < 500 && state.phase !== 'ended'; step += 1) {
  // Both choices read the same state, never the opponent's pending action.
  const actions = [0, 1].map((side) => {
    const legal = legalActions(state, side).filter((action) => action.kind !== 'forfeit');
    const moves = legal.filter((action) => action.kind === 'move');
    const pool = moves.length ? moves : legal;
    return pool.length ? pool[randInt(choices, 0, pool.length - 1)] : null;
  });
  const result = resolveTurn(state, actions);
  state = result.state;
  for (const event of result.events) console.log(`[${event.turn}] ${event.message}`);
}
if (state.phase !== 'ended') {
  console.error('Simulation exceeded 500 steps.');
  process.exitCode = 1;
}
