// Verifies a Firebase ID token with WebCrypto, since firebase-admin does not run on Workers.
// Follows https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let keys = null, keysExpire = 0;

const decode = part => Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const parse = part => JSON.parse(new TextDecoder().decode(decode(part)));

async function publicKey(kid) {
  if (!keys || Date.now() >= keysExpire) {
    const response = await fetch(JWKS_URL);
    if (!response.ok) throw new Error('Could not load Firebase signing keys.');
    const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') || '')?.[1] || 3600);
    keys = new Map();
    for (const jwk of (await response.json()).keys) {
      keys.set(jwk.kid, await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
    }
    keysExpire = Date.now() + maxAge * 1000;
  }
  return keys.get(kid);
}

export async function verifyFirebaseToken(token, projectId) {
  const [head, body, signature] = token.split('.');
  if (!head || !body || !signature) throw new Error('Malformed token.');
  const header = parse(head), payload = parse(body), now = Date.now() / 1000;
  if (header.alg !== 'RS256') throw new Error('Unexpected algorithm.');
  const key = await publicKey(header.kid);
  if (!key) throw new Error('Unknown signing key.');
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(signature), new TextEncoder().encode(`${head}.${body}`));
  if (!valid) throw new Error('Bad signature.');
  if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('Wrong project.');
  if (!(payload.exp > now) || !(payload.iat <= now + 300) || !(payload.auth_time <= now + 300)) throw new Error('Token expired.');
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) throw new Error('Missing subject.');
  return { ...payload, uid: payload.sub };
}
