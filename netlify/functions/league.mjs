import { handle } from '../../server/serverless.mjs';
import { createStore } from '../../server/firestore.mjs';

// The store is built on first *access* (not import) and reused for the life of the
// container, so `config` still answers when the server credentials are missing — handle()
// never touches store.db/store.auth on that path. That lets the League page load and
// offer guest play instead of failing to start at all.
let cached;
const store = {
  get db() { return (cached ??= createStore()).db; },
  get auth() { return (cached ??= createStore()).auth; },
};

export default async request => handle(request, store);

export const config = { path: '/api/league/*' };
