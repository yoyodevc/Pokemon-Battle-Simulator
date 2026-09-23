import { League } from '../../server/league.mjs';
import { withDocs, createStore } from '../../server/firestore.mjs';

// Backstop cleanup for abandoned invitations/matches nobody is actively polling.
// server/league.mjs's tick() already handles this inline whenever a request touches a
// specific challenge/match — this only covers the case where NO player ever comes back to
// trigger that. Uses targeted queries, never a full-collection scan.
export default async () => {
  const { db } = createStore();
  const now = Date.now();

  const staleChallenges = await db.collection('challenges').where('status', '==', 'pending').where('expires', '<=', now).get();
  for (const doc of staleChallenges.docs) await doc.ref.update({ status: 'expired' });

  const staleMatches = await db.collection('matches').where('status', 'in', ['preparing', 'battle']).where('deadline', '<=', now).get();
  for (const doc of staleMatches.docs) {
    const matchId = doc.id, m = doc.data();
    const plan = [{ collection: 'matches', id: matchId }, ...m.players.flatMap(p => [{ collection: 'users', id: p }, { collection: 'presence', id: p }])];
    await withDocs(db, plan, async data => {
      const league = new League(data);
      league.presence = new Map(Object.entries(data.presence));
      league.tick();
      data.presence = Object.fromEntries(league.presence);
    });
  }

  return new Response('ok');
};

export const config = { schedule: '*/2 * * * *' };
