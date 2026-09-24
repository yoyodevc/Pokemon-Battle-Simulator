# Pokémon Battle Simulator

A browser-based Pokémon battle simulator built on live [PokéAPI](https://pokeapi.co/) data.
React 18 + Vite + TypeScript + Tailwind CSS. The online League uses Firebase Auth and
Firestore; local battles use `useReducer` and Context.

## Requirements

- Node.js 20.19+ or 22.12+ (Vite 8 requirement)
- npm 10+

## Setup

```bash
npm install
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check, then produce a production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run typecheck` | Type-check without emitting |
| `npm run simulate -- 42` | Run an offline console battle with seed 42 (Node.js 22.18+ or 24+) |

## Architecture

```
src/
  api/          PokéAPI client, response cache, type-chart loader, moveset selection
  engine/       Pure battle logic (Phase 2)
  state/        Reducer and Context wiring the engine to React (Phase 3)
  components/   UI
  App.tsx
server/         Online League API and Firestore access
netlify/        League function for production
preview/        Dev-only design sandbox (see below) — not part of the build
```

### Online League loading

Locally, the League API runs in the Node server. On Netlify, the same API runs in a
function and reads Firebase Auth and Firestore over the network. Initial session loading
now runs the independent lobby reads alongside the core session work, reducing one
serial wait. Actual load time still depends on network and Firebase response times.

### Battle UI

The battle screen is a full-viewport game view modelled on Pokémon Scarlet/Violet:
white HP capsules with party pips, a 2x2 grid of type-coloured move cards, a
dialogue box that doubles as the move-info readout, and a scenic field with a
tunable horizon (`--horizon` on `.battle-arena`).

Effectiveness is printed on each move card rather than hidden behind a
confirmation dialog, so one click commits a move and the matchup is legible on
touch devices where there is no hover.

`src/index.css` is the single stylesheet, organised as: tokens → primitives →
site chrome → landing → Pokédex → team select → battle → animation → responsive.
Type colours live in one place (`--t-*`) and are shared by the dex badges, the
picker and the battle HUD.

### Design sandbox

PokéAPI is not always reachable from a development environment, and iterating on
the HUD by playing to a specific battle state is slow. `preview.html` renders the
battle, landing, Pokédex and team-select screens against local fixtures:

```bash
npm run dev          # then open /preview.html
```

Routes: `#battle`, `#battle-low` (low HP + status), `#battle-end` (victory),
`#landing`, `#dex`, `#setup`. Everything it needs lives in `preview/` —
fixtures, a small PokéAPI shim, and a handful of sprites. `vite build` only
reads `index.html`, so none of it reaches the production bundle. Delete the
folder and `preview.html` if you do not want it.

### The battle engine is pure

`src/engine/` contains plain TypeScript with **no React imports and no network calls**. It
takes a battle state plus a pair of actions and returns a new state alongside a list of
battle events. React renders that event list; it never computes battle outcomes itself.
Every source of randomness routes through a single seedable PRNG, so tests can pin a seed
and assert exact results.

To extend the engine — a new status condition, a new move effect, a new AI difficulty —
add it under `src/engine/` and cover it with a Vitest spec next to the module. If a change
requires reaching for `window`, `fetch` or a React hook, it belongs in `src/state/` or
`src/components/` instead.

### API layer and PokéAPI fair use

PokéAPI's fair-use policy requires consumers to cache responses locally. Every read goes
through `src/api/client.ts`, which layers four behaviours in order:

1. **Cache** (`src/api/cache.ts`) — 7-day TTL, keyed by absolute URL. IndexedDB where
   available, falling back to `localStorage` with LRU eviction, then to memory in Node.
2. **In-flight deduplication** — concurrent reads of the same URL share one promise.
3. **Concurrency cap** (`src/api/queue.ts`) — at most 6 parallel requests.
4. **Retry with exponential backoff** — transient statuses only; a 404 fails immediately.

`client.onProgress()` reports completed/active/queued counts so the UI can show real
loading progress while a team hydrates (roughly 30 requests for six Pokémon).

The type chart is **derived from `/type` at runtime**, never hardcoded, with placeholder
types (`unknown`, `shadow`) and non-canonical entries (id ≥ 10000) filtered out. Known
matchups are asserted in `src/api/typeChart.test.ts`.

## Build phases

- [x] **Phase 1** — Data layer: scaffold, cached API client, type chart, debug page.
- [x] **Phase 2** — Pure battle engine and test suite.
- [x] **Phase 3** — Battle UI.
- [x] **Phase 4** — Six-Pokémon team builder, CPU opponent, CPU difficulty strategies, and hot-seat mode.
- [x] **Phase 5** — Staged battle animation, Pokémon cries, reduced-motion support, live match timer, and keyboard navigation.

## Engine interface

Open `/#battle` or choose **Start a battle** to build two six-Pokémon teams from the
National Dex. Choose a CPU opponent or local hot-seat play, then select moves from the
in-battle command panel. Each move includes its short effect text, target, PP, power,
category, and a live effectiveness suggestion against the active opponent. Turn events
are presented one by one with combat animations and a battle log. Use `/?seed=42#battle`
for reproducible battle randomness. Arrow keys navigate moves, Enter selects, and Escape
closes voluntary switching. Battle state and logs use `useReducer` and Context under
`src/state/`.

`createBattle(teams, chart, seed)` creates an independent battle state. Pass both players'
simultaneous choices to `resolveTurn(state, [action0, action1])`; it returns `{ state, events }`
without modifying its input. `legalActions(state, side)` lists available moves, switches,
and forfeit. Move slot `-1` represents Struggle and is legal only when all PP is exhausted.

During the `switch` phase, fainted sides choose a replacement and surviving sides pass
`null`. Replacements do not consume a turn or trigger residual damage. During `ended`,
`winner` is side `0`, side `1`, or `draw`.

The engine stores its seedable RNG state in `BattleState.rng`; saving the state preserves
replayability. `seedFromQuery('?seed=42')` parses the hidden seed parameter for later UI
wiring. The homepage now opens a responsive landing page with featured Pokémon and
searchable profiles. The original Phase 1 debug component remains in the source.

`src/api/battleData.ts` converts already-loaded PokéAPI Pokémon and move metadata into
engine inputs. The engine itself performs no network or React operations. `Move.target`
controls the main target; `statTarget` supports attacks with effects on the user's stats.
Status-only metadata with a zero effect chance is normalized to a guaranteed effect.

The console runner uses two hardcoded teams and a small **offline fixture** chart under
`src/engine/fixtures.ts`. Production battle charts must use the existing PokéAPI loader;
the fixture is not a replacement for it. CPU difficulty lives in `src/state/cpuStrategy.ts`
and remains deterministic for a given seed. Move-specific effects outside the requested
metadata mechanics (weather, abilities, items, protection, fixed damage) are not modeled.
