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
  const db = getFirestore(app);
  // Hydrated battle data (e.g. a move with no ailment effect) legitimately contains
  // `undefined` fields, which Firestore otherwise rejects outright (unlike `null`).
  db.settings({ ignoreUndefinedProperties: true });
  return { db, auth: getAuth(app) };
}

const empty = () => Object.fromEntries(COLLECTIONS.map(c => [c, {}]));
const key = (collection, id) => `${collection}/${id}`;
// Firestore forbids two shapes league.mjs's plain-JS data structures use freely:
// (1) a document root that isn't a map — server/teams.mjs stores a bare array per user;
// (2) an array whose elements are themselves arrays — e.g. a match's `rosters` and
// `revealed` fields are each a 2-element array of arrays. Both are wrapped transparently
// on the way in and unwrapped on the way out, so this quirk stays local to the storage
// layer and league.mjs never has to know about it.
const wrapArrays = v => {
  if (Array.isArray(v)) return v.map(item => Array.isArray(item) ? { __arr: wrapArrays(item) } : wrapArrays(item));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, wrapArrays(x)]));
  return v;
};
const unwrapArrays = v => {
  if (Array.isArray(v)) return v.map(item => (item && typeof item === 'object' && Array.isArray(item.__arr) && Object.keys(item).length === 1) ? unwrapArrays(item.__arr) : unwrapArrays(item));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unwrapArrays(x)]));
  return v;
};
const toDoc = v => { const wrapped = wrapArrays(v); return Array.isArray(wrapped) ? { list: wrapped } : wrapped; };
const fromDoc = v => unwrapArrays((v && typeof v === 'object' && Array.isArray(v.list) && Object.keys(v).length === 1) ? v.list : v);

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
  // Above the SDK's own default (5): each document here is touched by at most two
  // players plus this endpoint's own polling, so a higher ceiling costs nothing in the
  // normal case and gives real headroom against transient contention under a burst.
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
  }, { maxAttempts: 10 });
}

/** Runs one or more queries (each an array of Firestore QuerySnapshot docs) and merges results into a plain {id: value} map, deduped by doc id. */
export function mergeQuerySnapshots(snapshots) {
  const out = {};
  for (const snap of snapshots) for (const doc of snap.docs) out[doc.id] = fromDoc(doc.data());
  return out;
}
