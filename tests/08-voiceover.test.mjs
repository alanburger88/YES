// The recorded voiceover for "Your statement in 60 seconds": recordings packaged
// from src/media (scripts/voiceover.mjs → build.mjs) and the script-fingerprint
// guard that refuses a recording made for different captions or figures.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const meta = { name: 'voiceover', viewports: ['desktop'] };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'src', 'media', 'voiceover.json');

// A silent 61-second WAV (8 kHz, 8-bit mono) as a data: URI, built in the page.
const SILENT_WAV = () => {
  const sr = 8000;
  const n = sr * 61;
  const buf = new Uint8Array(44 + n);
  const dv = new DataView(buf.buffer);
  const w = (o, s) => {
    for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i);
  };
  w(0, 'RIFF');
  dv.setUint32(4, 36 + n, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr, true);
  dv.setUint16(32, 1, true);
  dv.setUint16(34, 8, true);
  w(36, 'data');
  dv.setUint32(40, n, true);
  buf.fill(128, 44);
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return 'data:audio/wav;base64,' + btoa(bin);
};

export default async function (t) {
  const { page } = t;
  const state = (fn, arg) => page.evaluate(fn, arg);
  const mode = () => state(() => YES.overview.video.state().mode);

  t.step('the script fingerprint is stable and differs per language');
  const h = await state(() => {
    const en = YES.overview.video.scriptHash();
    YES.setLang('es', { silent: true });
    const es = YES.overview.video.scriptHash();
    YES.setLang('en', { silent: true });
    return { en, es, again: YES.overview.video.scriptHash() };
  });
  t.assert(/^[0-9a-f]{8}$/.test(h.en) && /^[0-9a-f]{8}$/.test(h.es), 'eight hex digits: ' + JSON.stringify(h));
  t.assert(h.en !== h.es && h.en === h.again, 'one fingerprint per language, stable across a switch');

  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : null;
  if (manifest) {
    t.step('packaged recordings: both languages, for this very script');
    const slot = await state(() => {
      const v = YES.config.slots.VIDEO_VOICEOVER;
      const one = (x) => x && { isObject: typeof x === 'object', mp3: /^data:audio\/mpeg;base64,/.test(x.src || ''), hash: x.scriptHash, voice: x.voice, kb: Math.round((x.src || '').length / 1024) };
      return { en: one(v.en), es: one(v.es) };
    });
    for (const lang of ['en', 'es']) {
      const s = slot[lang];
      t.assert(s && s.isObject && s.mp3, `${lang}: an MP3 data: URI is packaged`);
      t.eq(s && s.hash, h[lang], `${lang}: recorded for the current script (${h[lang]})`);
      t.eq(s && s.hash, manifest.languages[lang].scriptHash, `${lang}: matches src/media/voiceover.json`);
      t.eq(s && s.voice, manifest.voice.name, `${lang}: voice name carried along`);
    }
    t.eq(await mode(), 'recorded', 'English plays the packaged recording');
    t.eq(await state(() => YES.overview.video.state().recording), 'ready', 'state() reports the recording as ready');
    const dur = await state(
      () =>
        new Promise((done) => {
          const a = document.querySelector('audio[data-vp-audio]');
          if (!a) return done(-1);
          if (a.readyState >= 1) return done(a.duration);
          a.addEventListener('loadedmetadata', () => done(a.duration), { once: true });
          setTimeout(() => done(-2), 5000);
        })
    );
    const total = await state(() => YES.overview.video.state().duration);
    t.assert(dur > 0 && Math.abs(dur - total) < 0.6, `the recording lasts as long as the video (${dur}s vs ${total}s)`);
    t.assert((await page.locator('.ov-video__honest').innerText()).includes('recorded voiceover'), 'the card says the narration is a recorded voiceover');
    await state(() => YES.setLang('es', { silent: true }));
    t.eq(await mode(), 'recorded', 'Spanish plays its packaged recording');
    await state(() => YES.setLang('en', { silent: true }));
    await page.evaluate(() => YES.help.open('about'));
    const helpText = await page.locator('#view-help').innerText();
    t.assert(/English: approved recording set/.test(helpText) && /Spanish: approved recording set/.test(helpText), 'Help lists both recordings as set');
  }

  if (manifest) {
    t.step('another browser formats dates and numbers differently: the recording still plays');
    // Imitate an engine without thin spaces in date ranges and without
    // useGrouping: 'always' (Spanish 1000,00 instead of 1.000,00). The
    // fingerprint is built from facts and templates, so it must not change.
    const page2 = await page.context().newPage();
    await page2.addInitScript(() => {
      const fr = Intl.DateTimeFormat.prototype.formatRange;
      if (fr) {
        Intl.DateTimeFormat.prototype.formatRange = function (a, b) {
          return fr.call(this, a, b).replace(/\s*[–-]\s*/g, '–').replace(/[\u2009\u202f]/g, '');
        };
      }
      const NF = Intl.NumberFormat;
      const Patched = function (loc, opts) {
        if (opts && opts.useGrouping === 'always') opts = Object.assign({}, opts, { useGrouping: true });
        return new NF(loc, opts);
      };
      Patched.prototype = NF.prototype;
      Patched.supportedLocalesOf = NF.supportedLocalesOf;
      Intl.NumberFormat = Patched;
    });
    await page2.goto(page.url());
    await page2.waitForFunction(() => window.YES && YES.ready === true);
    const other = await page2.evaluate(() => {
      const r = {};
      for (const l of ['en', 'es']) {
        YES.setLang(l, { silent: true });
        r[l] = { hash: YES.overview.video.scriptHash(), recording: YES.overview.video.state().recording, mode: YES.overview.video.state().mode, text: YES.overview.video.cues().map((c) => c.text).join(' ') };
      }
      return r;
    });
    const here = await state(() => {
      YES.setLang('en', { silent: true });
      return YES.overview.video.cues().map((c) => c.text).join(' ');
    });
    t.assert(other.en.text !== here, 'the imitation really changed the captions (date range formatting)');
    for (const lang of ['en', 'es']) {
      t.eq(other[lang].hash, manifest.languages[lang].scriptHash, `${lang}: same fingerprint under different formatting`);
      t.eq([other[lang].recording, other[lang].mode], ['ready', 'recorded'], `${lang}: the recording is used`);
    }
    await page2.close();
  }

  t.step('the fingerprint guard: a recording for another script is not played');
  const warns = [];
  page.on('console', (m) => {
    if (m.type() === 'warning' && /voiceover was recorded for a different script/.test(m.text())) warns.push(m.text());
  });
  const wav = await state(SILENT_WAV);
  await state((src) => {
    YES.config.slots.VIDEO_VOICEOVER.en = { src: src, scriptHash: 'deadbeef', voice: 'Test' };
    YES.renderAll();
  }, wav);
  t.assert((await mode()) !== 'recorded', 'a mismatched recording is refused');
  t.eq(await page.locator('.ov-video audio[data-vp-audio]').count(), 0, 'no <audio> for a refused recording');
  t.eq(warns.length, 1, 'one console warning explains why');

  await state(
    ([src, hash]) => {
      YES.config.slots.VIDEO_VOICEOVER.en = { src: src, scriptHash: hash, voice: 'Test' };
      YES.renderAll();
    },
    [wav, h.en]
  );
  t.eq(await mode(), 'recorded', 'a recording for this script is played');
  t.eq(await page.locator('.ov-video audio[data-vp-audio]').count(), 1, 'one <audio> element');
}
