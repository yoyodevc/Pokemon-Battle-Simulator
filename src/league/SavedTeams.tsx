import { useEffect, useState } from 'react';
import { label } from '../engine/types';
import { request, sprite } from './client';

type SavedTeam = { id: string; name: string; roster: string[] };
export default function SavedTeams({ userId, roster, disabled, onLoad }: { userId: string; roster: string[]; disabled: boolean; onLoad: (roster: string[]) => void }) {
  const key = `league-teams:${userId}`;
  const [teams, setTeams] = useState<SavedTeam[]>([]);
  const [saving, setSaving] = useState(true);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        let local: unknown;
        try { local = JSON.parse(localStorage.getItem(key) || '[]'); } catch { local = []; }
        const result = await request<{ teams: SavedTeam[] }>('teams', Array.isArray(local) && local.length ? { action: 'import', teams: local } : {});
        if (live) setTeams(result.teams);
        try { localStorage.removeItem(key); } catch {}
      } catch { if (live) setError('Saved teams could not be loaded. Reopen this room to try again.'); }
      finally { if (live) setSaving(false); }
    })();
    return () => { live = false; };
  }, [key]);
  const save = async (body: unknown) => {
    setSaving(true);
    try { const result = await request<{ teams: SavedTeam[] }>('teams', body); setTeams(result.teams); setError(''); return true; }
    catch { setError('Teams could not be saved. Please try again.'); return false; }
    finally { setSaving(false); }
  };
  return <section className="lg-saved-teams" aria-label="Saved teams">
    <div className="lg-section-title"><h2>Saved teams</h2><span>Your trainer</span></div>
    <div className="lg-team-save"><label>Team name<input maxLength={32} value={name} onChange={e => setName(e.target.value)} placeholder="My first team" /></label><button type="button" className="lg-secondary" disabled={saving || !name.trim() || teams.length >= 20} onClick={() => { void save({ action: 'save', team: { id: crypto.randomUUID(), name: name.trim(), roster: [...roster] } }).then(ok => { if (ok) setName(''); }); }}>Save composition</button></div>
    {error && <p role="alert">{error}</p>}
    {teams.length === 0 && <p className="lg-muted">No saved teams yet.</p>}
    <div className="lg-team-library">{teams.map(team => <div className="lg-saved-team" key={team.id}><strong>{team.name}</strong><div className="lg-team-miniatures">{team.roster.map(n => <img key={n} src={sprite(n)} alt={label(n)} title={label(n)} />)}</div><div className="lg-inline"><button type="button" className="lg-secondary" disabled={disabled || saving} onClick={() => onLoad([...team.roster])}>Use team</button><button type="button" className="lg-link" disabled={saving} onClick={() => { void save({ action: 'delete', id: team.id }); }}>Delete</button></div></div>)}</div>
  </section>;
}
