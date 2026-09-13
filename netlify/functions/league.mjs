import { handle } from '../../server/serverless.mjs';
import { createStore } from '../../server/supabase-store.mjs';

// The store is built on first use and reused for the life of the container, so
// `config` still answers when the server credentials are missing. That lets the
// League page load and offer guest play instead of failing to start at all.
let store;
const lazy = {
  read: () => (store ??= createStore()).read(),
  write: (version, payload) => (store ??= createStore()).write(version, payload),
};

export default async (request, context) => handle(request, lazy, { ip: context.ip });

export const config = { path: '/api/league/*' };
