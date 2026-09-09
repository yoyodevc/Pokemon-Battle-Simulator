import { useEffect, useState } from 'react';
import { avatar, type Invitation } from './client';
export default function ChallengeInbox({ invitations, busy, onRespond }: { invitations: Invitation[]; busy: boolean; onRespond: (id: string, action: string) => Promise<void> }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  if (!invitations.length) return null;
  return <section className="lg-challenge-inbox" aria-label="Incoming challenges"><div className="lg-section-title"><h2>A rival awaits</h2><span>{invitations.length}</span></div>{invitations.map(c => {
    const seconds = Math.max(0, Math.ceil((c.expires - now) / 1000));
    return <article className="lg-challenge-card" key={c.id}><img src={avatar(c.from.avatar)} alt="" /><div><span className="lg-kicker">DUEL REQUEST / LEVEL 50</span><h3>{c.from.username}</h3><p>Standard 6v6 <span> / {seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} remaining` : 'Expired'}</span></p></div><div className="lg-inline"><button className="lg-primary" disabled={busy || !seconds} onClick={() => void onRespond(c.id, 'accept')}>Accept duel &#8594;</button><button className="lg-link" disabled={busy || !seconds} onClick={() => void onRespond(c.id, 'decline')}>Decline</button></div></article>;
  })}</section>;
}
