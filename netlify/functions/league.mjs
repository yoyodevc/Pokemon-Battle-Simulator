import { handle } from '../../server/serverless.mjs';
import { createStore } from '../../server/supabase-store.mjs';

export default async (request, context) => {
  try { return await handle(request, createStore(), { ip: context.ip }); }
  catch { return new Response(JSON.stringify({ error: 'League database is not configured.' }), { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }
};

export const config = { path: '/api/league/*' };
