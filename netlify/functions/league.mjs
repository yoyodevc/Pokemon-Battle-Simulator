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

export async function streamMatch(request, source, read = handle) {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  let id;
  try { ({ id } = await request.clone().json()); } catch { return new Response(null, { status: 400 }); }
  if (typeof id !== 'string') return new Response(null, { status: 400 });
  const readMatch = () => read(new Request(new URL('/api/league/match', request.url), {
    method: 'POST', headers: request.headers, body: JSON.stringify({ id }),
  }), source);
  const initial = await readMatch();
  if (!initial.ok) return initial;
  const first = await initial.json();
  const encoder = new TextEncoder();
  let stop;
  const body = new ReadableStream({
    start(controller) {
      let closed = false, unsubscribe = () => {}, last = JSON.stringify(first), pending = Promise.resolve();
      const send = value => { if (!closed) controller.enqueue(encoder.encode(`data: ${value}\n\n`)); };
      const heartbeat = setInterval(() => { if (!closed) controller.enqueue(encoder.encode(': keepalive\n\n')); }, 15000);
      const expiry = setTimeout(() => stop(), 50000);
      stop = (cancelled = false) => { if (closed) return; closed = true; clearInterval(heartbeat); clearTimeout(expiry); unsubscribe(); if (!cancelled) controller.close(); };
      send(last);
      unsubscribe = source.db.collection('matches').doc(id).onSnapshot(snapshot => {
        if (!snapshot.exists) { stop(); return; }
        pending = pending.then(async () => {
          const response = await readMatch();
          if (!response.ok) { stop(); return; }
          const value = JSON.stringify(await response.json());
          if (value !== last) { last = value; send(value); }
        }).catch(() => stop());
      }, () => stop());
      request.signal.addEventListener('abort', stop, { once: true });
      if (request.signal.aborted) stop();
    },
    cancel() { stop?.(true); },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export default async request => new URL(request.url).pathname === '/api/league/stream'
  ? streamMatch(request, store) : handle(request, store);

export const config = { path: '/api/league/*' };
