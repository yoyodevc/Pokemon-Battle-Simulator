import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { createStore } from '../server/supabase-store.mjs';

const db = new DatabaseSync(resolve(process.env.LEAGUE_DATABASE || '.league/league.sqlite'), { readOnly: true });
const payload = { users: {}, sessions: {}, friends: {}, blocks: {}, challenges: {}, matches: {}, teams: {}, presence: {}, limits: {} };
try {
  for (const row of db.prepare('SELECT collection,id,payload FROM league_records').all()) {
    if (!Object.hasOwn(payload, row.collection)) throw new Error(`Unknown collection: ${row.collection}`);
    payload[row.collection][row.id] = JSON.parse(row.payload);
  }
} finally { db.close(); }
for (const m of Object.values(payload.matches)) {
  if (m.status === 'loading') { m.status = 'preparing'; m.ready = [false, false]; }
  if (['preparing', 'battle'].includes(m.status)) {
    m.deadline = Date.now() + 90000;
    for (const id of m.players) payload.presence[id] = { seen: Date.now(), away: false };
  }
}
const store = createStore();
const current = await store.read();
if (current.version !== 0 || Object.values(current.payload).some(collection => Object.keys(collection).length)) throw new Error('Destination is not empty. Import stopped without overwriting data.');
if (!await store.write(current.version, payload)) throw new Error('Destination changed. Import stopped without overwriting data.');
console.log('SQLite League records imported into Supabase. The source database was not modified.');
