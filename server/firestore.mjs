import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// The collections league.mjs's `data` object may contain. `presence` isn't part of
// blankData() (league.mjs keeps it as a separate Map on the League instance), but it's
// persisted the same way, so it's included here.
export const COLLECTIONS = ['users', 'friends', 'blocks', 'challenges', 'matches', 'teams', 'presence'];

export function createApp() {
  if (getApps().length) return getApps()[0];
  // FIREBASE_SERVICE_ACCOUNT (raw JSON, for Netlify env vars) or FIREBASE_SERVICE_ACCOUNT_PATH
  // (a file path, more convenient for local development) — never commit either.
  const json = process.env.FIREBASE_SERVICE_ACCOUNT
    ?? (process.env.FIREBASE_SERVICE_ACCOUNT_PATH && readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
  if (!json) throw Object.assign(new Error('League storage is not configured on this server.'),
    { status: 503, detail: 'FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH must be set to a Firebase service-account JSON key.' });
  return initializeApp({ credential: cert(JSON.parse(json)) });
}

export function createStore(app = createApp()) {
  return { db: getFirestore(app), auth: getAuth(app) };
}

const empty = () => Object.fromEntries(COLLECTIONS.map(c => [c, {}]));
const key = (collection, id) => `${collection}/${id}`;
// Firestore document values must be maps. server/teams.mjs stores a bare array per user
// (league.mjs's other collections always store objects) — wrap/unwrap it transparently
// here so that quirk stays local to the storage layer.
const toDoc = v => Array.isArray(v) ? { list: v } : v;
const fromDoc = v => (v && typeof v === 'object' && Array.isArray(v.list) && Object.keys(v).length === 1) ? v.list : v;

/**
 * Runs `operation(data)` inside a Firestore transaction, where `data` is a sparse object
 * shaped like league.mjs's blankData() (plus `presence`) containing only the documents
 * named in `plan` (an array of {collection, id}). After `operation` returns, every
 * document that was either in `plan` or ended up present in `data` afterward (an
 * operation may create fresh ids, e.g. a new match or challenge) is written back;
 * documents present before but missing after are deleted (e.g. a declined friend
 * request). Firestore's transaction read-set versioning — not diffing — is what
 * guarantees correctness: if anything in `plan` changed since being read, the whole
 * transaction aborts and this rejects so the caller can retry.
 */
export async function withDocs(db, plan, operation) {
  return db.runTransaction(async tx => {
    const data = empty();
    const refs = new Map();
    const entries = plan.map(({ collection, id }) => {
      const ref = db.collection(collection).doc(id);
      refs.set(key(collection, id), ref);
      return { collection, id, ref };
    });
    const snaps = await Promise.all(entries.map(e => tx.get(e.ref)));
    const before = COLLECTIONS.map(() => new Set());
    entries.forEach((e, i) => {
      if (snaps[i].exists) { data[e.collection][e.id] = fromDoc(snaps[i].data()); before[COLLECTIONS.indexOf(e.collection)].add(e.id); }
    });
    const result = await operation(data);
    COLLECTIONS.forEach((collection, i) => {
      const afterIds = new Set(Object.keys(data[collection]));
      for (const id of new Set([...before[i], ...afterIds])) {
        const ref = refs.get(key(collection, id)) ?? db.collection(collection).doc(id);
        if (afterIds.has(id)) tx.set(ref, toDoc(data[collection][id])); else tx.delete(ref);
      }
    });
    return result;
  });
}

/** Runs one or more queries (each an array of Firestore QuerySnapshot docs) and merges results into a plain {id: value} map, deduped by doc id. */
export function mergeQuerySnapshots(snapshots) {
  const out = {};
  for (const snap of snapshots) for (const doc of snap.docs) out[doc.id] = fromDoc(doc.data());
  return out;
}
