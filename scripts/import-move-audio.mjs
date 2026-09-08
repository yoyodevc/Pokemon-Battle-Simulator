import { mkdir, writeFile } from 'node:fs/promises';
const repo = 'https://api.github.com/repos/pagefaultgames/pokerogue-assets';
const response = await fetch(`${repo}/git/trees/beta?recursive=1`);
if (!response.ok) throw new Error(`Tree: ${response.status}`);
const tree = await response.json();
const base = `https://raw.githubusercontent.com/pagefaultgames/pokerogue-assets/${tree.sha}/`;
const files = new Set(tree.tree.map(entry => entry.path));
const manifest = {};
const sounds = new Set();
async function read(path) {
  const response = await fetch(base + path.split('/').map(encodeURIComponent).join('/'));
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response;
}
async function parallel(items, action) {
  let next = 0;
  await Promise.all(Array.from({length: 10}, async () => {
    while (next < items.length) await action(items[next++]);
  }));
}
await parallel([...files].filter(path => /^battle-anims\/.*\.json$/.test(path)), async path => {
  const data = await (await read(path)).json();
  const animation = Array.isArray(data) ? data[0] : data;
  const cues = Object.values(animation.frameTimedEvents ?? {}).flat()
    .filter(cue => cue.eventType === 'AnimTimedSoundEvent' && cue.resourceName)
    .flatMap(cue => {
      const file = [cue.resourceName, `${cue.resourceName}.m4a`, `${cue.resourceName}.wav`]
        .find(name => files.has(`audio/battle_anims/${name}`));
      if (!file) return [];
      sounds.add(file);
      return [{file, frame: cue.frameIndex ?? 0, volume: cue.volume ?? 100, pitch: cue.pitch ?? 100}];
    }).sort((a,b) => a.frame - b.frame);
  if (cues.length) manifest[path.split('/').pop().replace('.json','')] = cues;
});
await mkdir('public/audio/moves', {recursive:true});
await parallel([...sounds], async file => {
  await writeFile(`public/audio/moves/${file}`, Buffer.from(await (await read(`audio/battle_anims/${file}`)).arrayBuffer()));
});
await mkdir('public/audio/credits', {recursive:true});
for (const path of ['audio/REUSE.toml', 'battle-anims/REUSE.toml', 'LICENSES/LicenseRef-POKEMON-REBORN.txt', 'LICENSES/LicenseRef-FAIR-USE.txt', 'LICENSES/AGPL-3.0-only.txt', 'LICENSES/CC-BY-NC-SA-4.0.txt']) {
  await writeFile(`public/audio/credits/${path.replaceAll('/', '-')}`, await (await read(path)).text());
}
await writeFile('src/components/moveAudioManifest.json', JSON.stringify(manifest));
await writeFile('public/audio/credits/source.json', JSON.stringify({repository:repo, revision:tree.sha, moves:Object.keys(manifest).length, files:sounds.size}, null, 2));
console.log(`Imported ${Object.keys(manifest).length} move mappings and ${sounds.size} recordings at ${tree.sha}`);
