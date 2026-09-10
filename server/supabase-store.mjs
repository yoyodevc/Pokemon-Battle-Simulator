import { createClient } from '@supabase/supabase-js';

export function createStore() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase server credentials are missing.');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async read() {
      const { data, error } = await client.from('league_state').select('version,payload').eq('id', 1).single();
      if (error) throw error;
      return data;
    },
    async write(version, payload) {
      const { data, error } = await client.from('league_state').update({ version: version + 1, payload }).eq('id', 1).eq('version', version).select('id');
      if (error) throw error;
      return data.length === 1;
    },
  };
}

export async function transact(store, operation) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { version, payload } = await store.read();
    const result = await operation(payload);
    if (await store.write(version, payload)) return result;
    await new Promise(resolve => setTimeout(resolve, 20 + Math.random() * 80));
  }
  throw Object.assign(new Error('The League is busy. Please try again.'), { status: 503 });
}
