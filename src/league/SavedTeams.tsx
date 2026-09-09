import { useState } from 'react';
import { label } from '../engine/types';
import { sprite } from './client';

type SavedTeam = { id: string; name: string; roster: string[] };
export default function SavedTeams({ userId, roster, disabled, onLoad }: { userId: string; roster: string[]; disabled: boolean; onLoad: (roster: string[]) => void }) {
  const key = `league-teams:${userId}`;
  const [teams, setTeams] = useState<SavedTeam[]>(() => {
    try {
      const data = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(data) ? data.filter(t => typeof t?.id === 'string' && typeof t.name === 'string' && Array.isArray(t.roster) && t.roster.length === 6 && new Set(t.roster).size === 6 && t.roster.every((n: unknown) => typeof n === 'string' && /^[a-z0-9-]{1,40}$/.test(n))) : [];
    } catch { return []; }
  });
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const save = (next: SavedTeam[]) => {
    try { localStorage.setItem(key, JSON.stringify(next)); setTeams(next); setError(''); return true; }
    catch { setError('Teams could not be saved. Browser storage is unavailable.'); return false; }
  };
  return <section className="lg-saved-teams" aria-label="Saved teams">
    <div className="lg-section-title"><h2>Saved teams</h2><span>This browser</span></div>
    <div className="lg-team-save"><label>Team name<input maxLength={32} value={name} onChange={e => setName(e.target.value)} placeholder="My first team" /></label><button type="button" className="lg-secondary" disabled={!name.trim() || teams.length >= 20} onClick={() => { if (save([...teams, { id: crypto.randomUUID(), name: name.trim(), roster: [...roster] }])) setName(''); }}>Save composition</button></div>
    {error && <p role="alert">{error}</p>}
    {teams.length === 0 && <p className="lg-muted">No saved teams yet.</p>}
    <div className="lg-team-library">{teams.map(team => <div className="lg-saved-team" key={team.id}><strong>{team.name}</strong><div className="lg-team-miniatures">{team.roster.map(n => <img key={n} src={sprite(n)} alt={label(n)} title={label(n)} />)}</div><div className="lg-inline"><button type="button" className="lg-secondary" disabled={disabled} onClick={() => onLoad([...team.roster])}>Use team</button><button type="button" className="lg-link" onClick={() => save(teams.filter(t => t.id !== team.id))}>Delete</button></div></div>)}</div>
  </section>;
}
