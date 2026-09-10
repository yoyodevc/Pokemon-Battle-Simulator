export function savedTeams(data, id, input = {}) {
  data.teams ??= {};
  const teams = data.teams[id] ??= [];
  const fail = () => { throw Object.assign(new Error('Use up to 20 named teams of six different Pokemon.'), { status: 400 }); };
  const validate = t => {
    if (!t || typeof t.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(t.id) || typeof t.name !== 'string' || !t.name.trim() || t.name.length > 32 ||
      !Array.isArray(t.roster) || t.roster.length !== 6 || new Set(t.roster).size !== 6 || t.roster.some(n => typeof n !== 'string' || !/^[a-z0-9-]{1,40}$/.test(n))) fail();
    return { id: t.id, name: t.name.trim(), roster: [...t.roster] };
  };
  if (input.action === 'save' || input.action === 'import') {
    const incoming = input.action === 'save' ? [input.team] : input.teams;
    if (!Array.isArray(incoming) || incoming.length > 20) fail();
    const next = new Map(teams.map(t => [t.id, t]));
    for (const t of incoming.map(validate)) if (input.action === 'save' || !next.has(t.id)) next.set(t.id, t);
    if (next.size > 20) fail();
    data.teams[id] = [...next.values()];
  } else if (input.action === 'delete') data.teams[id] = teams.filter(t => t.id !== input.id);
  else if (input.action !== undefined) fail();
  return { teams: data.teams[id] };
}
