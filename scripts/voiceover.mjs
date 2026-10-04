#!/usr/bin/env node
/*
 * Records the voiceover for "Your statement in 60 seconds" with ElevenLabs
 * text-to-speech and stores it in src/media/, where build.mjs packages it into
 * the single HTML file. The statement itself never calls ElevenLabs: this runs
 * once, at authoring time.
 *
 *   Key: an environment API credential for api.elevenlabs.io (header xi-api-key),
 *   or export ELEVENLABS_API_KEY=… — never written to any file
 *   node build.mjs                        (the player's script is read from dist/)
 *   node scripts/voiceover.mjs check                       offline: script matches the captions
 *   node scripts/voiceover.mjs voices                      list the account's female voices
 *   node scripts/voiceover.mjs samples --voices id1,id2   one short EN+ES sample per voice
 *   node scripts/voiceover.mjs record --voice id          record EN and ES, write src/media/
 *   node build.mjs                        (packages the recordings)
 *
 * How the recording stays in step with the animation:
 * - Each caption cue is recorded on its own, with the neighbouring lines passed
 *   as context so the delivery flows, and placed at the cue's start time.
 * - A line longer than its cue window is sped up slightly (at most 15%);
 *   anything longer fails, so the cue timing in 10-overview.js can be adjusted.
 * - The spoken text comes from scripts/voiceover-script.json, whose captions
 *   must equal the player's captions; the recording carries the player's script
 *   fingerprint, so a later change to the statement disables an outdated
 *   recording instead of narrating the wrong figures.
 *
 * Generated lines are cached in .cache/voiceover/ (not committed), so a re-run
 * does not spend credits on unchanged lines.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Node's built-in fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 (Node ≥ 22.21).
// In a cloud session the proxy is also what attaches the API credential.
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1', NODE_NO_WARNINGS: '1' } });
  process.exit(r.status == null ? 1 : r.status);
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'voiceover');
const MEDIA = join(ROOT, 'src', 'media');
const DIST = join(ROOT, 'dist', 'yes-statement.html');
const API = 'https://api.elevenlabs.io/v1';
const MODEL = 'eleven_multilingual_v2';
const SETTINGS = { stability: 0.55, similarity_boost: 0.75, style: 0, use_speaker_boost: true };
// ElevenLabs' own pacing per language (voice_settings.speed): Spanish runs longer
// than English in the same caption windows, and a slightly quicker delivery
// sounds more natural than speeding the audio up afterwards.
const SPEED = { en: 1, es: 1.06 };
const SEED = 20261004;
const LEAD = 0.06; // seconds of air before each line
const TAIL = 0.12; // seconds kept free before the next cue
const MAX_TEMPO = 1.15;
const BITRATE = '64k';

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const KEY = process.env.ELEVENLABS_API_KEY;
const die = (msg) => {
  console.error('✖ ' + msg);
  process.exit(1);
};

/*
 * Authentication: in a Claude Code cloud environment, store the key as an API
 * credential (host api.elevenlabs.io, header xi-api-key, no prefix); the agent
 * proxy attaches it to each request, so the key is never in this process. Or
 * set ELEVENLABS_API_KEY, which is sent as xi-api-key. Neither is ever written
 * to a file.
 */
async function api(path, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (KEY) headers['xi-api-key'] = KEY;
  const res = await fetch(API + path, { ...init, headers });
  if (res.status === 401 || res.status === 403) die(`ElevenLabs refused the request (${res.status}). Add the key as an API credential on the environment (api.elevenlabs.io, header xi-api-key) or set ELEVENLABS_API_KEY. ${(await res.text()).slice(0, 200)}`);
  if (!res.ok) die(`ElevenLabs ${init.method || 'GET'} ${path.split('?')[0]} → ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res;
}

/** One line of speech as MP3 bytes, cached by everything that shapes it. */
async function speak(voiceId, text, prev, next, lang) {
  const speed = (lang && SPEED[lang]) || 1;
  const body = { text, model_id: MODEL, voice_settings: speed === 1 ? SETTINGS : { ...SETTINGS, speed }, seed: SEED };
  if (prev) body.previous_text = prev;
  if (next) body.next_text = next;
  const id = createHash('sha256').update(JSON.stringify([voiceId, body])).digest('hex').slice(0, 24);
  const file = join(CACHE, id + '.mp3');
  if (existsSync(file)) return file;
  mkdirSync(CACHE, { recursive: true });
  const res = await api(`/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify(body)
  });
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/** Captions use no-break and thin spaces (amount units, date ranges); compare them as plain spaces. */
const norm = (str) => String(str).replace(/[\u00a0\u2009\u202f]/g, ' ');
/* ElevenLabs' standard library voices (female), by id: used for names when the
   key may not read the voice list (a key restricted to text to speech). */
const KNOWN = {
  EXAVITQu4vr4xnSDxMaL: 'Sarah',
  XrExE9yKIg1WjnnlVkGX: 'Matilda',
  '21m00Tcm4TlvDq8ikWAM': 'Rachel',
  Xb7hH8MSUJpSbSDYk0k2: 'Alice',
  FGY2WhTYpPnrIDTdsKH5: 'Laura',
  pFZP5JQG7iQjIQuC4Bku: 'Lily',
  cgSgspJ2msm6clMCkdW9: 'Jessica',
  '9BWtsMINqrJLrRacOk9x': 'Aria'
};
/** Voice name by id: the account's list when the key may read it, else KNOWN, else the id. */
async function voiceName(id) {
  try {
    const headers = KEY ? { 'xi-api-key': KEY } : {};
    const res = await fetch(`${API}/voices/${encodeURIComponent(id)}`, { headers });
    if (res.ok) return (await res.json()).name || KNOWN[id] || id;
  } catch (e) {
    /* fall through */
  }
  return KNOWN[id] || id;
}

const duration = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());

/** The player's cues and script fingerprint per language, read from the built file. */
async function playerScript() {
  if (!existsSync(DIST)) die('Build first: node build.mjs');
  const { chromium } = await import(pathToFileURL(join(ROOT, 'node_modules', 'playwright', 'index.mjs')).href);
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.route('**/*', (r) => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(DIST).href);
  await page.waitForFunction(() => window.YES && window.YES.ready === true);
  const out = {};
  for (const lang of ['en', 'es']) {
    out[lang] = await page.evaluate((l) => {
      YES.setLang(l, { silent: true });
      return { cues: YES.overview.video.cues(), hash: YES.overview.video.scriptHash(), duration: YES.overview.video.state().duration };
    }, lang);
  }
  await browser.close();
  return out;
}

async function listVoices() {
  const data = await (await api('/voices')).json();
  const voices = (data.voices || []).map((v) => ({ id: v.voice_id, name: v.name, category: v.category, ...(v.labels || {}) }));
  const female = voices.filter((v) => /female|woman/i.test(v.gender || '') || /female/i.test(v.description || ''));
  console.log(`${female.length} female voices (of ${voices.length}):`);
  for (const v of female) console.log(`  ${v.id}  ${v.name}  · ${[v.accent, v.age, v.description, v.use_case || v['use case'], v.category].filter(Boolean).join(' · ')}`);
  return female;
}

async function samples() {
  const ids = (opt('--voices') || '').split(',').filter(Boolean);
  if (!ids.length) die('Pass --voices id1,id2,…');
  const outDir = resolve(opt('--out') || join(ROOT, '.cache', 'samples'));
  mkdirSync(outDir, { recursive: true });
  const script = JSON.parse(readFileSync(join(ROOT, 'scripts', 'voiceover-script.json'), 'utf8'));
  const pick = (lang) => ['hello', 'period', 'closing'].map((k) => script[lang][k].voice).join(' ');
  for (const id of ids) {
    const name = await voiceName(id);
    const en = await speak(id, pick('en'));
    const es = await speak(id, pick('es'));
    const out = join(outDir, `sample-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.mp3`);
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', en, '-f', 'lavfi', '-t', '0.8', '-i', 'anullsrc=r=44100:cl=mono', '-i', es, '-filter_complex', '[0:a]aformat=channel_layouts=mono[a];[2:a]aformat=channel_layouts=mono[c];[a][1:a][c]concat=n=3:v=0:a=1', '-ac', '1', '-b:a', '96k', out]);
    console.log(`✔ ${name}: ${out}`);
  }
}

async function record() {
  const voiceId = opt('--voice');
  if (!voiceId) die('Pass --voice <voice id> (see: voices)');
  const script = JSON.parse(readFileSync(join(ROOT, 'scripts', 'voiceover-script.json'), 'utf8'));
  const player = await playerScript();
  const name = opt('--name') || (await voiceName(voiceId));
  mkdirSync(MEDIA, { recursive: true });
  const manifest = { voice: { id: voiceId, name: name }, model: MODEL, settings: SETTINGS, speed: SPEED, generatedAt: new Date().toISOString(), languages: {} };

  for (const lang of ['en', 'es']) {
    const { cues, hash, duration: total } = player[lang];
    const lines = cues.map((c) => {
      const s = script[lang][c.id];
      if (!s) die(`${lang}: no spoken line for cue "${c.id}" in scripts/voiceover-script.json`);
      if (norm(s.caption) !== norm(c.text)) die(`${lang}/${c.id}: the player's caption changed.\n    player: ${c.text}\n    script: ${s.caption}\n  Update scripts/voiceover-script.json first.`);
      return { ...c, voice: s.voice };
    });
    const placed = [];
    for (let i = 0; i < lines.length; i++) {
      const c = lines[i];
      const file = await speak(voiceId, c.voice, lines[i - 1] && lines[i - 1].voice, lines[i + 1] && lines[i + 1].voice, lang);
      const d = duration(file);
      const room = c.end - c.at - LEAD - TAIL;
      const tempo = d > room ? d / room : 1;
      if (tempo > MAX_TEMPO) die(`${lang}/${c.id}: "${c.voice}" lasts ${d.toFixed(2)}s but its cue leaves ${room.toFixed(2)}s (needs ${((tempo - 1) * 100).toFixed(0)}% faster). Lengthen this cue in 10-overview.js.`);
      placed.push({ id: c.id, at: c.at, end: c.end, file, clip: +(d / tempo).toFixed(3), tempo: +tempo.toFixed(3) });
      console.log(`  ${lang} ${c.id.padEnd(9)} ${d.toFixed(2)}s in ${room.toFixed(2)}s${tempo > 1 ? `  (×${tempo.toFixed(2)})` : ''}`);
    }
    // Assemble: every line at its cue time over silence, one level for the whole track.
    const inputs = placed.flatMap((p) => ['-i', p.file]);
    const chains = placed.map((p, i) => {
      const ms = Math.round((p.at + LEAD) * 1000);
      return `[${i}:a]aresample=44100,aformat=channel_layouts=mono${p.tempo > 1 ? `,atempo=${p.tempo}` : ''},adelay=delays=${ms}:all=1[l${i}]`;
    });
    const mix = placed.map((p, i) => `[l${i}]`).join('') + `amix=inputs=${placed.length}:normalize=0:dropout_transition=0,apad=whole_dur=${total},atrim=0:${total},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100[out]`;
    const out = join(MEDIA, `voiceover-${lang}.mp3`);
    execFileSync('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', chains.concat(mix).join(';'), '-map', '[out]', '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', BITRATE, out]);
    manifest.languages[lang] = { file: `voiceover-${lang}.mp3`, scriptHash: hash, duration: +duration(out).toFixed(2), cues: placed.map(({ file, ...rest }) => rest) };
    console.log(`✔ ${lang}: ${out} (${(readFileSync(out).length / 1024).toFixed(0)} KB, ${manifest.languages[lang].duration}s, script ${hash})`);
  }
  writeFileSync(join(MEDIA, 'voiceover.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('✔ Wrote src/media/voiceover.json — now run: node build.mjs');
}

/** Offline check (no key): every player caption has a spoken line with the same caption. */
async function check() {
  const script = JSON.parse(readFileSync(join(ROOT, 'scripts', 'voiceover-script.json'), 'utf8'));
  const player = await playerScript();
  let bad = 0;
  for (const lang of ['en', 'es']) {
    for (const c of player[lang].cues) {
      const s = script[lang][c.id];
      if (!s || norm(s.caption) !== norm(c.text)) {
        bad++;
        console.log(`✖ ${lang}/${c.id}\n    player: ${c.text}\n    script: ${s ? s.caption : '(missing)'}`);
      }
    }
    console.log(`${lang}: ${player[lang].cues.length} cues, script ${player[lang].hash}, ${player[lang].duration}s`);
  }
  if (bad) die(`${bad} line(s) differ from the player's captions.`);
  console.log('✔ The spoken script matches every caption.');
}

if (cmd === 'check') await check();
else if (cmd === 'voices') await listVoices();
else if (cmd === 'samples') await samples();
else if (cmd === 'record') await record();
else {
  console.log('Usage: node scripts/voiceover.mjs check | voices | samples --voices id1,id2 | record --voice id [--name Name]');
  process.exit(cmd ? 1 : 0);
}
