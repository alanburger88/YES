// Help view: contextual help, contact placeholders, feedback, "Download or
// print" (print, PDF, CSV and the statement-record facts), integrity checks
// and exception preview, accessibility + UserWay status, about/slots,
// YES.help.open + #/help/<section> routes (and the masthead's Download or
// print button), language switch, statement-of-record print view, the
// statement-of-record PDF (YES.help.downloadPdf, checked with poppler's
// pdfinfo / pdftotext / pdftoppm), light and dark themes, accessibility (axe)
// and mobile reflow.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

export const meta = { name: 'help', viewports: ['desktop', 'mobile'], hash: '#/help' };

const RESULTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-results');
const SHOTS = join(RESULTS, 'screens');
const SECTIONS = {
  contact: 'Contact support',
  feedback: 'Feedback',
  record: 'Download or print',
  integrity: 'Statement integrity',
  accessibility: 'Accessibility',
  about: 'About this demo'
};

export default async function (t) {
  const { page } = t;
  const mobile = t.viewport !== 'desktop';
  mkdirSync(SHOTS, { recursive: true });
  // The slot rows are checked from an empty VIDEO_VOICEOVER; the recordings
  // packaged from src/media are covered by tests/08-voiceover.test.mjs.
  await page.addInitScript(() => {
    window.YES_SKIP_PACKAGED_MEDIA = true;
  });
  await t.goto('#/help');
  // Intl output uses no-break / narrow spaces; compare with plain spaces.
  const nbsp = (s) => String(s).replace(/[   ]/g, ' ');
  const text = (sel) => page.locator(sel).first().innerText().then(nbsp);
  const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  // Mobile emulation widens the layout viewport to fit overflowing content, so
  // measure every visible element against the device width instead.
  const overflowAt = (w) =>
    page.$$eval(
      '#help-root *',
      (els, w) =>
        els
          .filter((e) => {
            const r = e.getBoundingClientRect();
            if (!r.width || e.closest('.sr-only')) return false;
            return r.right > w + 1 || r.left < -1;
          })
          .map((e) => (e.getAttribute('data-fk') || e.className || e.tagName) + '@' + Math.round(e.getBoundingClientRect().right))
          .slice(0, 8),
      w
    );
  const activeId = () => page.evaluate(() => document.activeElement && document.activeElement.id);
  const settle = async (ms = 450) => {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.waitForTimeout(ms);
  };
  // Element screenshots without the sticky masthead painted over them.
  const shotEl = async (sel, label) => {
    await page.addStyleTag({ content: '#masthead{visibility:hidden!important}' }).then(async (h) => {
      await page.locator(sel).first().screenshot({ path: join(SHOTS, `help-${t.viewport}-${label}.png`) });
      await h.evaluate((n) => n.remove());
    });
  };
  const seriousAxe = async (sel, label) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const v = await t.axe(sel);
    const bad = v.filter((x) => x.impact === 'serious' || x.impact === 'critical');
    t.eq(bad, [], `axe serious/critical violations in ${label}`);
    const minor = v.filter((x) => !(x.impact === 'serious' || x.impact === 'critical'));
    if (minor.length) console.log(`    (axe ${label}, ${t.viewport}: ${minor.map((x) => x.id + '/' + x.impact).join(', ')})`);
  };
  const installSpies = () =>
    page.evaluate(() => {
      window.__calls = [];
      YES.assistant.open = (ctx) => __calls.push({ fn: 'assistant', topic: ctx.topic, trigger: !!ctx.trigger });
      YES.inquiry.resume = () => __calls.push({ fn: 'resume' });
      YES.explorer.exportCsv = (which) => __calls.push({ fn: 'csv', which });
      YES.explorer.openTx = (id) => __calls.push({ fn: 'openTx', id });
      window.print = () => __calls.push({ fn: 'print' });
    });
  const calls = () => page.evaluate(() => window.__calls.splice(0));
  // The language switch lives in the masthead: on phones inside the Menu.
  const setLang = async (l) => {
    if (await page.locator('#masthead [data-mast-menu]').isVisible()) {
      if ((await page.getAttribute('#masthead [data-mast-menu]', 'aria-expanded')) !== 'true') await page.click('#masthead [data-mast-menu]');
      await page.click(`#mast-menu [data-lang="${l}"]`);
      await page.keyboard.press('Escape');
    } else {
      await page.click(`#masthead .mast-wide [data-lang="${l}"]`);
    }
    await page.waitForFunction((x) => document.documentElement.lang === x, l);
  };
  const focusedIs = async (id, msg) => {
    await page.waitForFunction((x) => document.activeElement && document.activeElement.id === x, id, { timeout: 3000 }).catch(() => {});
    t.eq(await activeId(), id, msg);
  };
  const notObscured = async (sel) =>
    page.evaluate((s) => {
      const el = document.querySelector(s);
      const mast = document.getElementById('masthead').getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return r.top >= mast.bottom - 1 && r.bottom <= window.innerHeight;
    }, sel);

  /* ------------------------------------------------------------------ */
  t.step('view renders');
  await page.waitForSelector('#h-help');
  t.assert(await page.locator('#view-help').isVisible(), 'help view visible');
  t.eq(await page.locator('#view-help h1').count(), 1, 'exactly one h1 in the view');
  const h1 = page.locator('#h-help');
  t.eq((await h1.innerText()).trim(), 'Help and statement record', 'h1 text');
  t.eq(await h1.getAttribute('class'), 'view-title', 'h1 class');
  t.eq(await h1.getAttribute('tabindex'), '-1', 'h1 tabindex');
  t.assert((await h1.getAttribute('data-view-heading')) !== null, 'h1 data-view-heading');
  for (const [id, title] of Object.entries(SECTIONS)) {
    const sec = page.locator(`#help-${id}`);
    t.eq(await sec.count(), 1, `section ${id} present`);
    t.eq(await sec.getAttribute('aria-labelledby'), `help-${id}-title`, `section ${id} labelled by its heading`);
    t.eq((await page.locator(`#help-${id}-title`).innerText()).trim(), title, `section ${id} heading`);
    t.eq(await page.evaluate((x) => document.getElementById(`help-${x}-title`).tagName, id), 'H2', `section ${id} heading is h2`);
    t.eq(await page.locator(`.help-toc a[data-help-go="${id}"]`).getAttribute('href'), `#/help/${id}`, `toc link to ${id}`);
  }
  t.eq(await page.locator('.help-toc').getAttribute('aria-label'), 'On this page', 'toc landmark label');
  t.eq(await page.locator('#help-q-title').innerText(), 'Question about a transaction?', 'contextual transaction help');
  t.assert((await text('.help-quick')).includes('Ask about this transaction'), 'explains "Ask about this transaction"');
  t.eq(await page.evaluate(() => YES.i18n.audit()), {}, 'i18n parity');
  const badHrefs = await page.$$eval('#help-root [href], #help-root [src], #print-root [href], #print-root [src]', (els) =>
    els.map((e) => e.getAttribute('href') || e.getAttribute('src')).filter((h) => /^(https?:|tel:|mailto:|\/\/)/i.test(h))
  );
  t.eq(badHrefs, [], 'no http/tel/mailto links in the help view or print view');
  t.eq(await page.$$eval('#help-root a', (els) => els.filter((a) => !a.getAttribute('href').startsWith('#')).length), 0, 'every link is a local hash route');
  t.assert(await noHScroll(), 'no horizontal scroll');
  const missingFk = await page.$$eval('#help-root button, #help-root a, #help-root input, #help-root textarea', (els) => els.filter((e) => !e.getAttribute('data-fk') && !e.hasAttribute('data-nav')).map((e) => e.outerHTML.slice(0, 80)));
  t.eq(missingFk, [], 'every interactive control has a data-fk');
  await settle(200);
  await t.shot('top');

  /* ------------------------------------------------------------------ */
  t.step('contextual help actions');
  await installSpies();
  await page.click('[data-fk="help-ask"]');
  t.eq(await calls(), [{ fn: 'assistant', topic: 'general', trigger: true }], 'Ask YES opens the assistant with topic general');
  t.eq(await page.locator('[data-help-resume]').count(), 0, 'no "Continue" without a draft');
  await page.evaluate(() => YES.set({ inquiry: { txId: 'TX-260909-2051', step: 'reason', status: 'draft' } }));
  t.eq((await text('[data-help-resume]')).trim(), 'Continue your demo inquiry', 'continue button appears for a draft');
  t.assert((await text('#help-quick-tx')).includes('Sent to an external wallet'), 'draft note names the transaction');
  await page.click('[data-help-resume]');
  t.eq(await calls(), [{ fn: 'resume' }], 'continue calls YES.inquiry.resume()');
  await page.evaluate(() => YES.set({ inquiry: { txId: 'TX-260909-2051', step: 'done', status: 'submitted', ref: 'DEMO-INQ-0001' } }));
  t.assert((await text('#help-quick-tx')).includes('Demo only — no inquiry was sent'), 'submitted demo inquiry says nothing was sent');
  await page.click('[data-help-opentx]');
  t.eq(await calls(), [{ fn: 'openTx', id: 'TX-260909-2051' }], 'view the transaction of a completed inquiry');
  await page.evaluate(() => YES.set({ inquiry: null }));
  t.eq(await page.locator('[data-help-resume], [data-help-opentx]').count(), 0, 'inquiry actions removed when there is no inquiry');
  await page.click('[data-fk="help-go-tx"]');
  await page.waitForFunction(() => location.hash === '#/transactions');
  t.assert(await page.evaluate(() => !document.getElementById('view-transactions').hidden), '"Go to Transactions" navigates');
  await page.evaluate(() => YES.nav.go('help'));
  await page.waitForFunction(() => !document.getElementById('view-help').hidden);

  /* ------------------------------------------------------------------ */
  t.step('contact placeholders');
  const cfg = await page.evaluate(() => YES.config.support);
  t.eq(await text('[data-help-value="phone"]'), cfg.phone, 'phone from config');
  t.eq(await text('[data-help-value="email"]'), cfg.email, 'email from config');
  t.eq(await text('[data-help-value="hours"]'), nbsp(cfg.hours.en), 'hours from config');
  t.eq(await page.locator('.help-contact .tag--illustrative').count(), 3, 'phone, email and hours tagged as placeholders');
  t.eq((await page.locator('.help-contact .tag--illustrative').first().innerText()).trim(), 'placeholder', 'placeholder tag text');
  const contact = await text('#help-contact');
  t.assert(contact.includes('placeholders and are not connected in this demo'), 'says support destinations are placeholders, not connected');
  t.assert(/Chat\s*Not available in this demo/.test(contact), 'chat not available in the demo');
  t.assert(contact.includes('Formal dispute') && contact.includes('Fraud or unauthorized activity'), 'formal routes listed');
  t.assert(contact.includes('An inquiry is not a formal dispute or fraud report'), 'inquiry distinguished from dispute/fraud');
  t.assert(contact.includes('approved YES policy and timing copy'), 'formal routes need approved policy and timing copy');
  t.eq(await page.locator('#help-contact .help-route--dispute .tag').innerText(), 'Not available in this demo', 'dispute not available');
  t.eq(await page.$$eval('#help-contact a', (els) => els.length), 0, 'contact details are text, not links');
  t.eq(await page.getAttribute('[data-help-copy="phone"]', 'aria-label'), 'Copy the placeholder phone number', 'copy button accessible name');
  t.eq(await page.getAttribute('[data-help-copy="email"]', 'aria-label'), 'Copy the placeholder email address', 'copy button accessible name (email)');
  await page.click('[data-help-copy="email"]');
  await page.waitForFunction(() => document.getElementById('toast').classList.contains('is-visible'), null, { timeout: 3000 });
  t.assert(/Copied to clipboard|Copy is not available/.test(await text('#toast')), 'copy confirms with a toast');
  await shotEl('#help-contact', 'contact');

  /* ------------------------------------------------------------------ */
  t.step('YES.help.open focuses a section');
  await page.evaluate(() => YES.help.open('feedback'));
  await focusedIs('help-feedback-title', 'YES.help.open("feedback") focuses the feedback heading');
  t.eq(await page.evaluate(() => location.hash), '#/help/feedback', 'route #/help/feedback');
  t.eq(await page.evaluate(() => YES.state.help.section), 'feedback', 'section kept in state');
  await settle(700);
  t.assert(await notObscured('#help-feedback-title'), 'focused heading is in view and not under the sticky masthead');
  // From another view.
  await page.evaluate(() => YES.nav.go('overview'));
  await page.evaluate(() => YES.help.open('integrity'));
  await focusedIs('help-integrity-title', 'open() from another view navigates to Help and focuses the section');
  t.assert(await page.evaluate(() => !document.getElementById('view-help').hidden), 'help view shown');
  await settle(700);
  t.assert(await notObscured('#help-integrity-title'), 'integrity heading not obscured');
  // Table of contents.
  await page.click('.help-toc a[data-help-go="about"]');
  await focusedIs('help-about-title', 'toc link focuses its section');
  t.eq(await page.evaluate(() => location.hash), '#/help/about', 'toc updates the route');
  // Unknown section: just the view heading.
  await page.evaluate(() => YES.help.open('nope'));
  await focusedIs('h-help', 'unknown section focuses the view heading');
  // Deep link on a fresh load.
  await page.goto('about:blank');
  await t.goto('#/help/record');
  await focusedIs('help-record-title', 'deep link #/help/record focuses the record section');
  // #/help/download is another name for "Download or print"; the address becomes the canonical route.
  await page.evaluate(() => YES.nav.go('overview'));
  await page.evaluate(() => (location.hash = '#/help/download'));
  await focusedIs('help-record-title', '#/help/download focuses "Download or print"');
  t.eq(await page.evaluate(() => location.hash), '#/help/record', 'the alias is rewritten to #/help/record');
  await page.evaluate(() => YES.help.open('contact'));
  await focusedIs('help-contact-title', 'contact focused');
  await page.evaluate(() => YES.help.open('download'));
  await focusedIs('help-record-title', 'YES.help.open("download") opens "Download or print"');
  // The masthead's "Download or print" (in the Menu on phones) lands on the section from any view.
  await page.evaluate(() => YES.nav.go('transactions'));
  if (mobile) {
    await page.click('#masthead [data-mast-menu]');
    await page.click('#mast-menu [data-mast-record]');
  } else {
    await page.click('#masthead .mast-wide [data-mast-record]');
  }
  await focusedIs('help-record-title', 'the masthead\'s "Download or print" focuses the section heading');
  t.eq(await page.evaluate(() => [YES.state.view, location.hash]), ['help', '#/help/record'], 'masthead button routes to #/help/record');
  await settle(700);
  t.assert(await notObscured('#help-record-title'), '"Download or print" heading in view, not under the masthead');
  await installSpies();

  /* ------------------------------------------------------------------ */
  t.step('feedback validation');
  await page.evaluate(() => YES.help.open('feedback'));
  await focusedIs('help-feedback-title', 'feedback focused');
  t.eq((await text('#help-feedback legend')).trim(), 'How clear was this statement?', 'clarity question');
  t.eq(await page.locator('#help-feedback input[type="radio"]').count(), 4, 'four answers');
  t.assert((await text('#help-feedback')).includes('Demo only — feedback is kept only in this browser session and is not sent.'), 'demo note before saving');
  await page.click('[data-fk="help-fb-submit"]');
  t.assert(await page.locator('#help-fb-error').isVisible(), 'error shown when no answer chosen');
  t.eq(await page.getAttribute('[data-fk="help-fb-very_clear"]', 'aria-invalid'), 'true', 'radios marked invalid');
  t.eq(await page.getAttribute('[data-fk="help-fb-very_clear"]', 'aria-describedby'), 'help-fb-error', 'radios described by the error');
  t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-fk')), 'help-fb-very_clear', 'focus moves to the first answer');
  await page.waitForFunction(() => document.getElementById('live-assertive').textContent.includes('Choose how clear'), null, { timeout: 2000 });
  t.eq(await page.evaluate(() => YES.state.feedback.clarity || null), null, 'nothing saved on error');
  await page.locator('label.choice', { hasText: 'Mostly clear' }).click();
  t.eq(await page.locator('#help-fb-error').count(), 0, 'error cleared after choosing');
  t.assert(await page.isChecked('[data-fk="help-fb-mostly_clear"]'), 'answer checked');
  await page.fill('#help-fb-comment', 'The fee lines were easy to follow.');
  t.eq(await page.evaluate(() => [YES.state.help.rating, YES.state.help.comment]), ['mostly_clear', 'The fee lines were easy to follow.'], 'draft kept in state');

  t.step('feedback draft survives language switch');
  await setLang('es');
  t.eq((await text('#help-feedback legend')).trim(), '¿Qué tan claro fue este estado de cuenta?', 'Spanish question');
  t.assert(await page.isChecked('[data-fk="help-fb-mostly_clear"]'), 'answer still checked in Spanish');
  t.eq(await page.inputValue('#help-fb-comment'), 'The fee lines were easy to follow.', 'comment preserved');
  t.eq((await text('#h-help')).trim(), 'Ayuda y registro del estado de cuenta', 'Spanish h1');
  t.eq((await text('#help-record-title')).trim(), 'Descargar o imprimir', 'Spanish "Download or print" heading');
  t.eq((await text('[data-fk="help-pdf"]')).trim(), 'Descargar PDF', 'Spanish PDF button');
  t.assert((await text('#help-dl-pdf-desc')).includes('tamaño A4'), 'Spanish PDF is A4');
  t.eq(await page.evaluate(() => YES.i18n.audit()), {}, 'i18n parity in Spanish');
  await setLang('en');

  t.step('feedback confirmation');
  await page.click('[data-fk="help-fb-submit"]');
  await page.waitForSelector('#help-fb-done');
  const done = await text('#help-fb-done');
  t.assert(done.includes('Demo only'), 'confirmation says demo only');
  t.assert(done.includes('not sent'), 'confirmation says not sent');
  t.assert(done.includes('only in this browser session'), 'confirmation says kept only in this browser session');
  t.assert(done.includes('Mostly clear') && done.includes('The fee lines were easy to follow.'), 'confirmation repeats the answer and comment');
  await focusedIs('help-fb-done', 'focus moves to the confirmation');
  await page.waitForFunction(() => document.getElementById('live-polite').textContent.includes('nothing was sent'), null, { timeout: 2000 });
  const rec = await page.evaluate(() => YES.state.feedback.clarity);
  t.eq([rec.rating, rec.comment], ['mostly_clear', 'The fee lines were easy to follow.'], 'saved in YES.state.feedback');
  t.eq(t.external.filter((u) => !/userway/.test(u)), [], 'nothing sent over the network');
  await shotEl('#help-feedback', 'feedback-done');
  await setLang('es');
  const doneEs = await text('#help-fb-done');
  t.assert(doneEs.includes('no se envió') && doneEs.includes('Bastante claro'), 'confirmation survives the language switch (Spanish)');
  await setLang('en');
  await page.click('[data-fk="help-fb-edit"]');
  t.assert(await page.isChecked('[data-fk="help-fb-mostly_clear"]'), 'edit restores the saved answer');
  t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-fk')), 'help-fb-mostly_clear', 'focus on the saved answer');
  await page.click('[data-fk="help-fb-cancel"]');
  t.assert(await page.locator('#help-fb-done').isVisible(), 'cancel returns to the confirmation');
  t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-fk')), 'help-fb-edit', 'focus returns to "Change my answer"');

  /* ------------------------------------------------------------------ */
  t.step('Download or print');
  const recTxt = await text('#help-record');
  // Print, PDF and CSV together, each with a heading, a description and one button.
  t.eq(await page.$$eval('#help-record [data-help-dl] > li', (els) => els.map((e) => e.className)), ['help-dl__opt help-dl__opt--print', 'help-dl__opt help-dl__opt--pdf', 'help-dl__opt help-dl__opt--csv'], 'print, PDF and CSV options in order');
  t.eq(await page.$$eval('#help-record .help-dl__title', (els) => els.map((e) => [e.tagName, e.textContent])), [['H3', 'Print'], ['H3', 'PDF file'], ['H3', 'Spreadsheet (CSV)']], 'option headings');
  const dlButtons = await page.$$eval('#help-record .help-dl__btn', (els) =>
    els.map((b) => {
      const d = document.getElementById(b.getAttribute('aria-describedby'));
      return { fk: b.getAttribute('data-fk'), text: b.textContent.trim(), desc: d ? d.closest('.help-dl__opt') === b.closest('.help-dl__opt') : false };
    })
  );
  t.eq(dlButtons, [
    { fk: 'help-print', text: 'Print statement', desc: true },
    { fk: 'help-pdf', text: 'Download PDF', desc: true },
    { fk: 'help-csv', text: 'Download CSV — complete record', desc: true }
  ], 'buttons, each described by its option text');
  const recSec = page.locator('#help-record');
  t.eq(await recSec.getByRole('button', { name: /^Print\b/ }).count(), 1, 'one Print button (accessible name starts with "Print")');
  t.eq(await recSec.getByRole('button', { name: /PDF/ }).count(), 1, 'one button named with "PDF"');
  t.assert((await text('#help-dl-pdf-desc')).includes('US Letter size'), 'PDF description names the page size (English: US Letter)');
  t.assert(recTxt.includes('Files are created here, offline — nothing is sent.'), 'says files are made on this device and nothing is sent');
  t.assert(recTxt.includes('“Illustrative demo data” watermark'), 'mentions the demo watermark on every page');
  t.eq((await text('#help-rec-facts')).trim(), 'Statement record', 'the statement-record facts follow under their own heading');
  const dlLayout = await page.$$eval('#help-record .help-dl__opt', (els) =>
    els.map((li) => {
      const b = li.querySelector('.help-dl__btn').getBoundingClientRect();
      const r = li.getBoundingClientRect();
      return { left: Math.round(b.left), width: Math.round(b.width), height: Math.round(b.height), card: Math.round(r.width) };
    })
  );
  if (mobile) t.assert(dlLayout.every((d) => d.width >= d.card - 40), 'phones: each button spans its card: ' + JSON.stringify(dlLayout));
  else t.assert(dlLayout.every((d) => d.left === dlLayout[0].left && d.width === dlLayout[0].width), 'desktop: the three buttons line up in one column: ' + JSON.stringify(dlLayout));
  t.assert(dlLayout.every((d) => d.height >= 44), 'buttons are at least 44px tall');
  const s = await page.evaluate(() => YES.data.statement);
  t.assert(recTxt.includes(s.id), 'statement ID');
  t.assert(/Version\s*1\.0/.test(recTxt), 'version');
  t.assert(/Issue status\s*Original/.test(recTxt), 'issue status');
  t.assert(recTxt.includes(nbsp(await page.evaluate(() => YES.fmt.range(YES.data.statement.periodStart, YES.data.statement.periodEnd)))), 'period');
  t.assert(/Generated\s*Oct 1, 2026/.test(recTxt), 'generated time');
  t.assert(/Statement as of\s*Sep 30, 2026/.test(recTxt), 'as-of time');
  t.assert(recTxt.includes('America/New_York'), 'timezone');
  t.assert(/Date basis\s*Posted date/.test(recTxt), 'date basis');
  t.assert(recTxt.includes('This is a period snapshot; an issued statement is never changed — corrections are issued as a new version.'), 'snapshot statement');
  t.assert(recTxt.includes('Retention, archival and correction handling are defined with YES and InfoSlips before live use.'), 'retention note');
  await page.click('[data-fk="help-print"]');
  await page.click('[data-fk="help-csv"]');
  t.eq(await calls(), [{ fn: 'print' }, { fn: 'csv', which: 'all' }], 'print calls window.print(); CSV exports the complete record');
  t.eq((await text('[data-fk="help-csv"]')).trim(), 'Download CSV — complete record', 'CSV button label');
  t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-fk')), 'help-csv', 'focus stays on the pressed button');
  await shotEl('#help-record', 'record');

  /* ------------------------------------------------------------------ */
  t.step('integrity');
  t.eq(await page.locator('#help-integrity .help-check.check--ok').count(), 9, '9 passed checks');
  t.eq(await page.locator('#help-integrity .help-check.check--fail').count(), 0, 'no failed checks');
  const checkStates = await page.$$eval('#help-integrity .help-check .check__state', (els) => els.map((e) => e.textContent));
  t.assert(checkStates.length === 9 && checkStates.every((x) => x === 'Passed'), 'each check says Passed in words');
  t.eq(await page.$$eval('#help-integrity .help-check svg', (els) => els.length), 9, 'each check has an icon');
  t.eq((await text('#help-integrity .help-check'))?.includes('Every transaction has a unique ID'), true, 'labels from foundation check strings');
  t.eq((await text('#help-integrity .help-badge')).trim(), '9 of 9 checks passed', 'summary badge');
  const eqVisual = await text('#help-integrity .help-eq__visual');
  for (const v of ['1,000.00', '500.00', '200.00', '450.00', '100.00', '2.50', '1,147.50 USBC']) t.assert(eqVisual.includes(v), `equation shows ${v}`);
  const spoken = await page.locator('#help-integrity .help-eq .sr-only').textContent();
  t.assert(nbsp(spoken).startsWith('Opening balance 1,000.00 USBC, plus deposits 500.00 USBC') && nbsp(spoken).includes('minus fees 2.50 USBC, equals closing balance 1,147.50 USBC.'), 'equation spoken text');
  const prev = page.locator('[data-help-preview]');
  t.eq(await prev.getAttribute('href'), '#/overview?simulate=mismatch', 'preview link loads the simulated mismatch');
  t.eq((await prev.innerText()).trim(), 'Preview the exception state', 'preview label');
  const intTxt = await text('#help-integrity');
  t.assert(intTxt.includes('withheld') && intTxt.includes('never visually fixed'), 'explains withheld, never visually fixed');
  t.assert(intTxt.includes('Demo only'), 'preview marked demo only');
  await shotEl('#help-integrity', 'integrity');

  /* ------------------------------------------------------------------ */
  t.step('accessibility and UserWay status');
  const a11y = await text('#help-accessibility');
  t.assert(a11y.includes('WCAG 2.2 Level AA'), 'WCAG 2.2 AA target');
  t.eq(await page.locator('#help-accessibility .help-feature').count(), 8, 'eight built-in features');
  for (const f of ['Keyboard', 'Screen readers', 'Visible focus', 'Reduced motion', 'Zoom and reflow', 'Text alternatives for charts', 'Never color alone', 'Two languages']) t.assert(a11y.includes(f), `feature: ${f}`);
  t.assert(a11y.includes('B3W9A2mgGs'), 'configured account ID');
  t.assert(a11y.includes('augments, not replaces'), 'widget augments the accessible base');
  await page.waitForFunction(() => ['unavailable', 'loaded', 'host', 'disabled'].includes(YES.userway.status), null, { timeout: 12000 });
  t.eq(await page.getAttribute('[data-help-uw-status]', 'data-help-uw-status'), 'unavailable', 'status attribute follows YES.userway');
  const uw = await text('#help-uw-live');
  t.assert(/unavailable/i.test(uw), 'status text says unavailable offline');
  t.assert(uw.includes('Everything still works without it'), 'says everything still works without it');
  t.eq(await page.getAttribute('#help-uw-live', 'role'), 'status', 'status is a live region');
  t.assert((await text('[data-help-uw-about]')).includes('Unavailable offline'), 'about table shows the current status');
  for (const [st, label] of [
    ['loading', 'Loading'],
    ['loaded', 'Loaded'],
    ['host', 'Provided by host viewer'],
    ['disabled', 'Disabled'],
    ['unavailable', 'Unavailable offline']
  ]) {
    await page.evaluate((x) => {
      YES.userway.status = x;
      YES.emit('userway', x);
    }, st);
    t.assert((await text('#help-uw-live')).includes(label), `status ${st} → ${label}`);
  }
  await shotEl('#help-accessibility', 'accessibility');

  /* ------------------------------------------------------------------ */
  t.step('about this demo');
  const enh = await page.$$eval('[data-help-enh] tbody tr', (els) => els.map((e) => e.getAttribute('data-enh')));
  t.eq(enh, ['userway', 'ai', 'inquiry', 'video', 'feedback', 'analytics', 'evidence', 'liveBalance'], 'enhancement rows');
  const about = await text('#help-about');
  for (const x of ['Online only', 'Local demo', 'Local mock', 'Session only', 'None', 'Illustrative only', 'Not connected', 'no live blockchain verification', 'no reserve assertion']) t.assert(about.includes(x), `about mentions ${x}`);
  // Analytics: the statement measures nothing, but while it loads the
  // third-party UserWay widget it must not say that nothing leaves the page.
  const analytics = () => text('[data-enh="analytics"] td:first-of-type .help-enh__text');
  t.eq(
    await analytics(),
    'The statement itself measures and sends nothing. When you are online, the page also loads the UserWay accessibility widget, a third-party service with its own privacy terms.',
    'analytics row is qualified while UserWay is enabled'
  );
  t.assert(!(await text('#help-root')).includes('Nothing you do on this page is measured or sent'), 'no unqualified "nothing is sent" claim');
  t.assert(!/nothing you do here is sent/i.test(contact), 'contact notice is scoped to support, not the whole page');
  await page.evaluate(() => {
    YES.config.userway.enabled = false;
    YES.renderAll();
  });
  t.eq(await analytics(), 'The statement itself measures and sends nothing.', 'no widget mention when UserWay is turned off');
  await page.evaluate(() => {
    YES.config.userway.enabled = true;
    YES.renderAll();
  });
  t.assert((await analytics()).includes('UserWay'), 'widget named again when enabled');
  // The logo slot shows a miniature of the real slot rendering, hidden from AT (the words describe it).
  t.eq(
    await page.$eval('[data-slot-row="YES_LOGO"] .help-logo-mini', (e) => ({ cls: e.className, hidden: e.getAttribute('aria-hidden'), slot: e.getAttribute('data-slot'), text: e.textContent })),
    { cls: 'yes-logo yes-logo--placeholder help-logo-mini help-logo-mini--placeholder', hidden: 'true', slot: 'YES_LOGO', text: 'YES' },
    'logo slot miniature uses ui.logoHtml'
  );
  t.assert((await text('[data-slot-row="YES_LOGO"]')).includes('Text “YES” in a placeholder box'), 'logo slot described as a text placeholder');
  const logoArtRow = await page.evaluate(() => {
    YES.config.slots.YES_LOGO.svg = '<svg viewBox="0 0 120 40" focusable="false" aria-hidden="true"><rect width="120" height="40" rx="8"/></svg>';
    YES.renderAll();
    const row = document.querySelector('[data-slot-row="YES_LOGO"]');
    const out = { svg: !!row.querySelector('.help-logo-mini--art svg'), text: row.querySelector('.help-slot__value').textContent };
    delete YES.config.slots.YES_LOGO.svg;
    YES.renderAll();
    return out;
  });
  t.eq(logoArtRow, { svg: true, text: 'Logo artwork supplied' }, 'supplied logo artwork is shown and named in the slot table');
  const slots = await page.$$eval('[data-help-slots] tbody tr', (els) => els.map((e) => e.getAttribute('data-slot-row')));
  t.eq(slots, ['YES_LOGO', 'YES_PRIMARY', 'YES_ACCENT', 'YES_FONT', 'PRODUCT_NAME', 'ISSUER_OR_PARTNER', 'VIDEO_POSTER', 'VIDEO_VOICEOVER', 'DISCLOSURES', 'SUPPORT'], 'replacement slots');
  const slotsCfg = await page.evaluate(() => YES.config.slots);
  t.assert(about.includes(slotsCfg.YES_PRIMARY) && about.includes(slotsCfg.YES_ACCENT), 'colour slot values');
  t.assert(about.includes(slotsCfg.PRODUCT_NAME.en) && about.includes(slotsCfg.ISSUER_OR_PARTNER.en), 'product and issuer slot values');
  t.assert(about.includes(slotsCfg.DISCLOSURES.en.slice(0, 40)), 'disclosures slot value');
  t.eq(await page.locator('[data-help-slots] .tag--illustrative').count(), 10, 'every slot tagged as placeholder');
  // The video: the overview's player draws its own poster (its opening frame)
  // and narrates with the device voice unless an approved recording is set.
  const videoAbout = await text('[data-enh="video"]');
  t.assert(/never plays on its own/.test(videoAbout) && /device’s built-in voice, or an approved recording/.test(videoAbout), 'video row describes the player and its narration');
  t.assert(!/placeholder poster/i.test(about), 'no drawn placeholder poster is claimed');
  const slotValue = (row) => page.$eval(`[data-slot-row="${row}"] .help-slot__value`, (e) => e.innerText.replace(/\s*\n\s*/g, ' | ').trim());
  t.eq(slotsCfg.VIDEO_POSTER, null, 'no poster configured in the demo');
  t.eq(await slotValue('VIDEO_POSTER'), 'Not set — the player shows its own opening frame', 'unset poster: the player’s opening frame');
  const noVoice = 'English: not set | Spanish: not set | Narration uses the device’s built-in voice, if it has one for that language. Captions and a transcript are always available.';
  t.eq(slotsCfg.VIDEO_VOICEOVER, { en: null, es: null }, 'no recording configured in the demo');
  t.eq(await slotValue('VIDEO_VOICEOVER'), noVoice, 'voiceover slot: per-language state and the device-voice fallback');
  // The table reports what the player will actually use: data: URIs only.
  const slotStates = await page.evaluate(() => {
    const s = YES.config.slots;
    const read = () => {
      YES.renderAll();
      const v = (r) => document.querySelector(`[data-slot-row="${r}"] .help-slot__value`).innerText.replace(/\s*\n\s*/g, ' | ').trim();
      return { poster: v('VIDEO_POSTER'), voice: v('VIDEO_VOICEOVER') };
    };
    const out = {};
    s.VIDEO_POSTER = 'data:image/png;base64,iVBORw0KGgo=';
    s.VIDEO_VOICEOVER.en = 'data:audio/mpeg;base64,SUQz';
    out.some = read();
    s.VIDEO_VOICEOVER.es = 'data:audio/wav;base64,UklGRg==';
    out.all = read();
    s.VIDEO_POSTER = 'https://example.invalid/poster.png';
    s.VIDEO_VOICEOVER.en = 'https://example.invalid/voice-en.mp3';
    out.ignored = read();
    s.VIDEO_POSTER = null;
    s.VIDEO_VOICEOVER.en = null;
    s.VIDEO_VOICEOVER.es = null;
    YES.renderAll();
    return out;
  });
  t.eq(
    slotStates.some,
    {
      poster: 'Poster image supplied',
      voice: 'English: approved recording set | Spanish: not set | A language without a recording uses the device’s built-in voice, if it has one. Captions and a transcript are always available.'
    },
    'one recording set: named per language'
  );
  t.eq(slotStates.all.voice, 'English: approved recording set | Spanish: approved recording set | Each language plays its approved recording. Captions and a transcript are always available.', 'both recordings set');
  t.eq(
    slotStates.ignored,
    {
      poster: 'Not used — only an image packaged in this file (a data: URI) is shown, so the player shows its own opening frame',
      voice:
        'English: not used — a recording must be packaged in this file (a data: audio URI) | Spanish: approved recording set | A language without a recording uses the device’s built-in voice, if it has one. Captions and a transcript are always available.'
    },
    'values the player would not use (a URL is a request) are reported as not used'
  );
  t.eq(await slotValue('VIDEO_VOICEOVER'), noVoice, 'restored');
  await setLang('es');
  t.eq(await slotValue('VIDEO_POSTER'), 'Sin definir: el reproductor muestra su propio fotograma inicial', 'poster slot in Spanish');
  t.eq(
    await slotValue('VIDEO_VOICEOVER'),
    'Inglés: sin definir | Español: sin definir | La narración usa la voz integrada del dispositivo, si tiene una para ese idioma. Los subtítulos y la transcripción siempre están disponibles.',
    'voiceover slot in Spanish'
  );
  t.assert(/nunca se reproduce solo/.test(await text('[data-enh="video"]')), 'video row in Spanish');
  await shotEl('#help-about', 'about-es');
  await setLang('en');
  await shotEl('#help-about', 'about');

  // English copy follows the en-US locale used for dates and numbers.
  const ukSpelling = (await text('#help-root')).match(/\b\w*(colour|labelled|minimis|recognis|organis|behaviour|favour|centre)\w*\b/gi);
  t.eq(ukSpelling, null, 'English help copy uses US spelling');

  /* ------------------------------------------------------------------ */
  t.step('axe');
  await seriousAxe('#view-help', 'help view');

  /* ------------------------------------------------------------------ */
  t.step('reflow');
  t.assert(await noHScroll(), 'no horizontal scroll');
  t.eq(await overflowAt(mobile ? 390 : 1280), [], 'no element wider than the viewport');
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(200);
  await t.shot('full', { fullPage: true });
  if (mobile) {
    await page.setViewportSize({ width: 320, height: 640 });
    await settle(200);
    t.assert(await noHScroll(), 'no horizontal scroll at 320px');
    t.eq(await overflowAt(320), [], 'no element overflows at 320px');
    // Same check with the saved-feedback, draft-inquiry and Spanish variants.
    await page.evaluate(() => YES.set({ inquiry: { txId: 'TX-260909-2051', step: 'reason', status: 'draft' } }));
    await setLang('es');
    await settle(100);
    t.eq(await overflowAt(320), [], 'no element overflows at 320px in Spanish');
    await t.shot('narrow-es', { fullPage: true });
    await setLang('en');
    await page.evaluate(() => YES.set({ inquiry: null }));
    const small = await page.$$eval('#help-root button, #help-root a, #help-root label.choice', (els) =>
      els.filter((e) => e.offsetParent !== null).filter((e) => { const r = e.getBoundingClientRect(); return r.height < 44 || r.width < 44; }).map((e) => e.getAttribute('data-fk') || e.className)
    );
    t.eq(small, [], 'touch targets at least 44px');
    await t.shot('narrow-full', { fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
  }

  /* ------------------------------------------------------------------ */
  t.step('print view');
  await page.emulateMedia({ media: 'print' });
  t.assert(await page.locator('#print-root').isVisible(), '#print-root visible in print');
  t.assert(!(await page.locator('#app').isVisible()), 'screen UI hidden in print');
  const ledger = await page.$$eval('#print-root [data-print-tx]', (els) => els.map((e) => e.getAttribute('data-print-tx')));
  const postedIds = await page.evaluate(() => YES.calc.posted().map((x) => x.id));
  t.eq(ledger.length, 15, '15 posted ledger rows');
  t.eq(ledger, postedIds, 'ledger in chronological order');
  const balances = await page.$$eval('#print-root [data-print-tx] td:last-child', (els) => els.map((e) => e.textContent));
  const runBal = await page.evaluate(() => YES.calc.running().map((r) => YES.fmt.amount(r.balance, { unit: false })));
  t.eq(balances, runBal, 'balance after each row from calc.running');
  const pr = await text('#print-root');
  t.assert(await page.locator('#print-root .print-watermark span').first().isVisible(), 'watermark visible');
  t.eq(await text('#print-root .print-watermark span'), 'ILLUSTRATIVE DEMO DATA', 'watermark text');
  t.assert((await page.locator('#print-root .print-watermark span').count()) >= 2, 'watermark repeats');
  const wm = await page.evaluate(() => {
    const r = document.querySelector('#print-root .print-watermark span').getBoundingClientRect();
    return r.left >= 0 && r.right <= window.innerWidth;
  });
  t.assert(wm, 'watermark fits the page width');
  t.eq(await text('[data-print-closing]'), '1,147.50 USBC', 'closing balance 1,147.50');
  t.assert(pr.includes('Not included in the statement balance'), 'pending section heading');
  t.eq(await page.$$eval('#print-root [data-print-pending]', (els) => els.map((e) => e.getAttribute('data-print-pending'))), ['TX-260930-2247'], 'pending transaction listed separately');
  t.eq(await page.locator('#print-root [data-print-ledger] [data-print-pending]').count(), 0, 'pending not in the posted ledger');
  for (const fact of ['Statement of record', 'Sam Ortega', '100 Sample Avenue, Apt 4', 'Anytown, ST 00000', '•••• 7316', s.id, 'Version', 'Issue status', 'Original', 'Generated', 'Oct 1, 2026', 'Statement as of', 'America/New_York', 'Date basis', 'Posted date', 'Initiated date', 'Previous period', 'Balance summary', 'Fees summary', 'Disclosures', 'Illustrative demo data — fictional customer, amounts and references']) {
    t.assert(pr.toLowerCase().includes(fact.toLowerCase()), `print includes "${fact}"`);
  }
  t.eq(await page.$$eval('#print-root [data-print-cat]', (els) => els.map((e) => e.getAttribute('data-print-cat'))), ['deposits', 'transfers_in', 'transfers_out', 'redemptions', 'fees'], 'summary categories');
  t.eq(await text('[data-print-eq]'), 'Opening balance 1,000.00 + Deposits 500.00 + Incoming transfers 200.00 − Outgoing transfers 450.00 − Redemptions 100.00 − Fees 2.50 = Closing balance 1,147.50 USBC', 'equation line');
  t.eq(await page.locator('#print-root [data-print-fee]').count(), 3, 'three fee lines');
  t.assert((await text('[data-print-fees-total]')).includes('−2.50'), 'fees total');
  // Totals print once, at the true end of their table. A <tfoot> (display:
  // table-footer-group) repeats at the foot of every printed page, which put
  // "Closing balance 1,147.50" under a mid-period running balance on page 1.
  t.eq(
    await page.$$eval('#print-root *', (els) => els.filter((e) => getComputedStyle(e).display === 'table-footer-group').map((e) => e.tagName)),
    [],
    'no repeating table footers in the print view'
  );
  const lastRows = await page.$$eval('#print-root table', (tables) =>
    tables.map((tb) => {
      const rows = tb.querySelectorAll('tr');
      const last = rows[rows.length - 1];
      return last.classList.contains('pr-closing') ? last.textContent.replace(/[\u00a0\u202f]/g, ' ') : null;
    })
  );
  t.eq(lastRows.filter(Boolean).length, 3, 'summary, ledger and fees each end with their closing/total row');
  t.assert(lastRows[0].includes('Closing balance') && lastRows[0].includes('1,147.50'), 'summary ends with the closing balance');
  const ledgerEnd = await page.$$eval('[data-print-ledger] tbody tr', (rows) => rows.slice(-2).map((r) => r.getAttribute('data-print-tx') || r.getAttribute('data-print-ledger-closing')));
  t.eq(ledgerEnd, [postedIds[postedIds.length - 1], ''], 'ledger closing row follows the last posted transaction');
  const ledgerTxt = await text('[data-print-ledger] table');
  t.eq(ledgerTxt.split('Closing balance').length - 1, 1, '"Closing balance" appears once in the ledger');
  t.assert(/Sep 30, 2026\s+Closing balance\s+1,147\.50/.test(await text('[data-print-ledger-closing]')), 'ledger closes dated at the period end, mirroring the opening row');
  t.assert((await text('[data-print-opening]')).includes('Opening balance'), 'ledger opens with the opening balance');
  t.eq(await page.$eval('[data-print-ledger-closing]', (e) => getComputedStyle(e).breakBefore), 'avoid', 'closing row stays with the row above it');
  // Disclosures and the identifying footer print together, never a footer alone on a page.
  t.eq(await page.$$eval('[data-print-end] > *', (els) => els.map((e) => e.className)), ['pr-sec pr-disc', 'pr-foot'], 'disclosures and footer grouped');
  t.eq(await page.$eval('[data-print-end]', (e) => getComputedStyle(e).breakInside), 'avoid', 'disclosures and footer kept together');
  // Running page footer: statement ID and version, page n of N.
  const pageCss = await page.evaluate(() => (document.getElementById('help-print-page') || {}).textContent || '');
  t.assert(pageCss.includes('@bottom-left{content:"Statement ' + s.id + ' · version 1.0"}'), 'running footer names the statement and version');
  t.assert(pageCss.includes('@bottom-right{content:"Page " counter(page) " of " counter(pages)}'), 'running footer numbers the pages');
  t.eq(await page.locator('#help-print-page').count(), 1, 'one page-footer style element');
  t.assert(pr.includes(slotsCfg.DISCLOSURES.en.slice(0, 40)), 'disclosures slot printed');
  t.assert(pr.includes('Nothing you do on this page is sent anywhere'), 'demo footer');
  const tx1 = await text('[data-print-tx="TX-260901-0418"]');
  t.assert(tx1.includes('REF-D7K2-9QW4') && tx1.includes('+250.00') && tx1.includes('Deposit') && tx1.includes('Linked bank account'), 'row has reference, signed amount, type label and counterparty');
  t.assert(!(await page.$$eval('#print-root .amount, #print-root [style*="color"]', (els) => els.length)), 'no colour-coded amounts in print');
  // Status-aware type labels: a pending redemption never reads as completed.
  const typeCell = (sel) => text(`${sel} td:nth-child(${sel.includes('pending') ? 3 : 4})`);
  t.eq(await typeCell('[data-print-tx="TX-260920-0900"]'), 'Redeemed', 'posted redemption reads "Redeemed"');
  t.eq(await typeCell('[data-print-pending="TX-260930-2247"]'), 'Redemption requested', 'pending redemption reads "Redemption requested"');
  // Masked identifiers: bullets stay visible but are hidden from assistive
  // technology, which hears "ending in …" instead.
  const masked = await page.$$eval('#print-root .pr-meta .mono, #print-root .pr-sub', (els) =>
    els
      .filter((e) => e.textContent.includes('•'))
      .map((e) => {
        const hidden = e.querySelector('[aria-hidden="true"]');
        const sr = e.querySelector('.sr-only');
        return { visible: hidden && hidden.textContent, spoken: sr && sr.textContent };
      })
  );
  t.eq(masked[0], { visible: '•••• 7316', spoken: 'ending in 7316' }, 'account identifier is spoken as "ending in 7316"');
  const maskedTx = await page.evaluate(() => YES.calc.posted().concat(YES.calc.notInBalance()).filter((x) => YES.L(x.counterparty).includes('•')).length);
  t.assert(maskedTx >= 2, `demo data has masked counterparties (${maskedTx})`);
  t.eq(masked.length, maskedTx + 1, 'the account and every masked counterparty use the masked markup');
  t.assert(masked.every((m) => m.visible && /^ending in \w+$/.test(m.spoken || '')), 'no masked identifier reads as bullets');
  t.assert(!(await page.$$eval('#print-root .sr-only', (els) => els.some((e) => e.getBoundingClientRect().width > 1))), 'spoken text never prints visibly');
  await settle(100);
  await t.shot('print', { fullPage: true });
  if (!mobile) {
    let pdfOk = false;
    try {
      await page.pdf({ path: join(SHOTS, 'help-print.pdf'), format: 'A4', printBackground: true });
      pdfOk = true;
    } catch {
      /* PDF output needs headless Chromium; the screenshot covers the layout. */
    }
    // Paginated check when poppler's pdftotext is available.
    const pdf = pdfOk ? spawnSync('pdftotext', ['-raw', join(SHOTS, 'help-print.pdf'), '-'], { encoding: 'utf8' }) : null;
    if (pdf && pdf.status === 0) {
      const pages = pdf.stdout.split('\f').filter((p) => p.trim());
      const all = pages.join('\n');
      t.assert(pages.length >= 2, `statement prints on several pages (${pages.length})`);
      // Summary row + equation + ledger closing row; a repeated table footer adds more.
      t.eq((all.match(/Closing balance/g) || []).length, 3, '"Closing balance" printed exactly three times (summary, equation, end of ledger)');
      t.eq((all.match(/Total fees/g) || []).length, 1, '"Total fees" printed once');
      pages.forEach((p, i) => t.assert(p.includes(`Page ${i + 1} of ${pages.length}`) && p.includes(s.id), `page ${i + 1} carries the statement ID and "Page ${i + 1} of ${pages.length}"`));
      const last = pages[pages.length - 1];
      t.assert(last.includes('Disclosures') && last.includes('Interactive statement delivered via InfoSlips'), 'last page has the disclosures with the footer');
      // The spoken form of masked identifiers is for assistive technology only.
      t.assert(all.includes('•••• 7316') && !/ending in/.test(all), 'PDF text shows the masked identifier, never the spoken form');
      t.assert(/Redemption\s+requested/.test(all), 'PDF names the pending redemption as requested');
    } else {
      console.log('    (pdftotext not available: paginated print checks skipped)');
    }
  }

  t.step('print view in Spanish');
  await page.emulateMedia({ media: 'screen' });
  await setLang('es');
  await page.emulateMedia({ media: 'print' });
  const prEs = await text('#print-root');
  t.assert(prEs.includes('Estado de cuenta oficial'), 'Spanish print title');
  t.assert(prEs.includes('No incluido en el saldo del estado de cuenta'), 'Spanish pending heading');
  t.assert(prEs.includes('Resumen del saldo') && prEs.includes('Movimientos registrados'), 'Spanish section headings');
  t.eq(await text('#print-root .print-watermark span'), 'DATOS ILUSTRATIVOS DE DEMOSTRACIÓN', 'Spanish watermark');
  t.eq(await text('[data-print-closing]'), nbsp(await page.evaluate(() => YES.fmt.amount(YES.data.statement.closing))), 'Spanish closing amount format');
  t.eq(await page.getAttribute('#print-root .pr', 'data-print-lang'), 'es', 'print view re-rendered in Spanish');
  t.eq(await page.locator('#print-root [data-print-tx]').count(), 15, '15 rows in Spanish');
  const pageCssEs = await page.evaluate(() => document.getElementById('help-print-page').textContent);
  t.assert(pageCssEs.includes('"Estado de cuenta ' + s.id + ' · versión 1.0"') && pageCssEs.includes('"Página " counter(page) " de " counter(pages)'), 'running footer in Spanish');
  t.assert(/Saldo final/.test(await text('[data-print-ledger-closing]')), 'Spanish ledger closing row');
  t.eq(await typeCell('[data-print-pending="TX-260930-2247"]'), 'Canje solicitado', 'Spanish pending redemption reads "Canje solicitado"');
  t.eq(await typeCell('[data-print-tx="TX-260920-0900"]'), 'Canjeado', 'Spanish posted redemption reads "Canjeado"');
  t.eq(await page.$eval('#print-root .pr-meta .mono .sr-only', (e) => e.textContent), 'que termina en 7316', 'Spanish spoken account identifier');
  await t.shot('print-es');
  await page.emulateMedia({ media: 'screen' });
  await setLang('en');
  t.eq(await page.getAttribute('#print-root .pr', 'data-print-lang'), 'en', 'print view back in English');

  t.step('beforeprint refreshes the print view');
  await page.evaluate(() => {
    document.getElementById('print-root').innerHTML = '';
    window.dispatchEvent(new Event('beforeprint'));
  });
  t.eq(await page.locator('#print-root [data-print-tx]').count(), 15, 'rendered on beforeprint');

  t.step('print header uses supplied logo artwork');
  t.eq((await text('#print-root .pr-logo')).trim(), 'YES', 'text placeholder when no artwork is supplied');
  const logo = await page.evaluate(() => {
    const slot = YES.config.slots.YES_LOGO;
    slot.svg = '<svg viewBox="0 0 120 40" focusable="false" aria-hidden="true"><rect width="120" height="40" rx="8"/></svg>';
    window.dispatchEvent(new Event('beforeprint'));
    const el = document.querySelector('#print-root .pr-logo');
    const out = { art: el.classList.contains('pr-logo--art'), svg: !!el.querySelector('svg'), role: el.getAttribute('role'), label: el.getAttribute('aria-label'), slot: el.getAttribute('data-slot'), text: el.textContent };
    delete slot.svg;
    window.dispatchEvent(new Event('beforeprint'));
    return out;
  });
  t.eq(logo, { art: true, svg: true, role: 'img', label: 'YES', slot: 'YES_LOGO', text: '' }, 'approved [YES_LOGO] artwork replaces the text placeholder in print');
  // Same slot rendering as the masthead (ui.logoHtml): a data: image is used,
  // a URL that would fetch is ignored, and the placeholder is a named image.
  const logoVariants = await page.evaluate(() => {
    const slot = YES.config.slots.YES_LOGO;
    const read = () => {
      window.dispatchEvent(new Event('beforeprint'));
      const el = document.querySelector('#print-root .pr-logo');
      const img = el.querySelector('img');
      return { cls: el.className, img: img ? img.getAttribute('src').slice(0, 15) : null, text: el.textContent, label: el.getAttribute('aria-label'), h: el.style.getPropertyValue('--logo-h') };
    };
    const out = { placeholder: read() };
    slot.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    out.dataImage = read();
    slot.src = 'https://example.invalid/logo.png';
    out.url = read();
    delete slot.src;
    read();
    return out;
  });
  t.eq(logoVariants.placeholder, { cls: 'yes-logo yes-logo--placeholder pr-logo pr-logo--placeholder', img: null, text: 'YES', label: 'YES', h: '28pt' }, 'print placeholder via ui.logoHtml at 28pt');
  t.eq([logoVariants.dataImage.cls.includes('pr-logo--art'), logoVariants.dataImage.img], [true, 'data:image/png;'], 'a data: image logo prints');
  t.eq([logoVariants.url.cls.includes('pr-logo--placeholder'), logoVariants.url.img], [true, null], 'a logo URL that would fetch is ignored in print');
  await page.emulateMedia({ media: 'print' });
  const logoBox = await page.$eval('#print-root .pr-logo', (e) => {
    const cs = getComputedStyle(e);
    return { bg: cs.backgroundColor, color: cs.color, border: cs.borderTopStyle, h: Math.round(e.getBoundingClientRect().height) };
  });
  t.eq([logoBox.bg, logoBox.color, logoBox.border], ['rgba(0, 0, 0, 0)', 'rgb(0, 0, 0)', 'solid'], 'placeholder prints as a boxed black wordmark without a fill');
  t.assert(logoBox.h >= 34 && logoBox.h <= 40, `print logo is 28pt tall (${logoBox.h}px)`);
  await page.emulateMedia({ media: 'screen' });

  /* ------------------------------------------------------------------ */
  t.step('statement-of-record PDF');
  // One click on "Download PDF" saves a real PDF made in the page (YES.pdf):
  // checked with poppler's pdfinfo / pdftotext and rendered with pdftoppm.
  const poppler = !spawnSync('pdfinfo', ['-v']).error;
  const getPdf = async (lang) => {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click('[data-fk="help-pdf"]')]);
    const path = join(RESULTS, `help-${t.viewport}-${lang}.pdf`);
    await dl.saveAs(path);
    const bytes = readFileSync(path);
    const raw = bytes.toString('latin1');
    // Content streams, one per page (the writer's objects are uncompressed).
    const streams = [...raw.matchAll(/\/Length (\d+) >>\nstream\n/g)].map((m) => raw.substr(m.index + m[0].length, +m[1]));
    const out = { name: dl.suggestedFilename(), path, bytes, raw, streams, info: '', text: '', order: '', pages: 0, words: [] };
    if (poppler) {
      const info = spawnSync('pdfinfo', ['-enc', 'UTF-8', path], { encoding: 'utf8' });
      t.eq([info.status, (info.stderr || '').trim()], [0, ''], `pdfinfo (${lang}): valid, no errors`);
      out.info = info.stdout || '';
      out.pages = +(out.info.match(/^Pages:\s+(\d+)/m) || [0, 0])[1];
      out.text = nbsp(spawnSync('pdftotext', ['-layout', '-enc', 'UTF-8', path, '-'], { encoding: 'utf8' }).stdout || '');
      // Content order (the diagonal watermark letters can reorder -layout lines), whitespace collapsed.
      out.order = nbsp(spawnSync('pdftotext', ['-raw', '-enc', 'UTF-8', path, '-'], { encoding: 'utf8' }).stdout || '').replace(/[ \t\r\n]+/g, ' ');
      const bbox = spawnSync('pdftotext', ['-bbox', '-enc', 'UTF-8', path, '-'], { encoding: 'utf8' }).stdout || '';
      out.words = [...bbox.matchAll(/<word xMin="([\d.]+)" yMin="[\d.]+" xMax="([\d.]+)" yMax="[\d.]+">([^<]*)<\/word>/g)].map((m) => ({ x1: +m[2], w: m[3].replace(/&amp;/g, '&') }));
    }
    return out;
  };
  const toastSays = async (str) => {
    await page.waitForFunction((x) => document.getElementById('toast').textContent.includes(x), str, { timeout: 3000 }).catch(() => {});
    return text('#toast');
  };
  const refs = await page.evaluate(() => ({ posted: YES.calc.posted().map((x) => x.reference), pending: YES.calc.notInBalance().map((x) => x.reference) }));
  t.eq(refs.pending, ['REF-X6P3-9AT5'], 'demo data: one item not in the balance');
  await page.evaluate(() => YES.help.open('record'));
  await focusedIs('help-record-title', 'Download or print focused');
  const en = await getPdf('en');
  t.eq(en.name, `YES-statement-${s.id}-DEMO.pdf`, 'file name: YES-statement-<statement id>-DEMO.pdf');
  t.eq(en.bytes.subarray(0, 8).toString('latin1'), '%PDF-1.4', 'a real PDF 1.4 file');
  const toastEn = await toastSays('PDF saved');
  t.assert(/^PDF saved to this device \(\d+ pages\)\. Nothing was sent\.$/.test(toastEn), 'toast: saved on this device, nothing sent: ' + toastEn);
  await page.waitForFunction(() => document.getElementById('live-polite').textContent.includes('PDF saved'), null, { timeout: 2000 }).catch(() => {});
  t.assert((await page.textContent('#live-polite')).includes('Nothing was sent'), 'the confirmation is announced');
  t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-fk')), 'help-pdf', 'focus stays on Download PDF');
  t.eq(t.external.filter((u) => !/userway/.test(u)), [], 'making the PDF requested nothing from the network');
  t.assert(en.raw.includes('/Lang <FEFF0065006E002D00550053>'), 'catalog /Lang en-US');
  // Watermark: drawn first on every page (beneath the content), light grey; tables use rules, never fills that would hide it.
  t.assert(en.streams.length >= 2 && en.streams.every((x) => /^q BT \/F2 [\d.]+ Tf [\d.]+ [\d.]+ [\d.]+ rg [-\d. ]+ Tm \(ILLUSTRATIVE DEMO DATA\) Tj ET Q\n/.test(x)), 'every page starts with the demo watermark');
  t.assert(en.streams.every((x) => +x.match(/Tf ([\d.]+) /)[1] >= 0.85), 'the watermark is a light grey');
  t.assert(!en.streams.some((x) => / re [fB]\b/.test(x)), 'no filled boxes or row fills: the watermark shows everywhere');
  if (poppler) {
    t.assert(en.pages >= 2, `the record runs over several pages (${en.pages})`);
    t.eq(en.streams.length, en.pages, 'one content stream per page');
    t.assert(/^Page size:\s+612 x 792 pts \(letter\)/m.test(en.info), 'English: US Letter');
    const titleEn = await page.evaluate(() => YES.t('help.pdf.docTitle', { period: YES.fmt.range(YES.data.statement.periodStart, YES.data.statement.periodEnd), id: YES.data.statement.id }));
    t.eq((en.info.match(/^Title:\s+(.*)$/m) || [])[1], titleEn, 'document title');
    t.eq(nbsp(titleEn), 'YES statement of record, September 1 – 30, 2026 (YES-STM-202609-000184)', 'title names the period and statement');
    const tx = en.text;
    for (const fact of ['Statement of record', 'US BANK COIN', 'Sam Ortega', '100 Sample Avenue, Apt 4', 'Anytown, ST 00000', 'YES stablecoin account •••• 7316', 'Wallet 0x5A…E19C', s.id, 'Issue status', 'Original', 'Oct 1, 2026, 6:15 AM EDT', 'Sep 30, 2026, 11:59 PM EDT', 'EDT (America/New_York)', 'Posted date', 'US Bank Coin (USBC)', 'Balance summary', 'Opening balance 1,000.00 + Deposits 500.00', 'Net change +147.50 USBC across 15 transactions.', 'Posted transactions', 'Initiated date', 'Previous period', 'Fee for REF-N8C4-2VB9', 'Fees summary', 'Total fees (3 transactions)', 'Disclosures', 'Interactive statement delivered via InfoSlips', 'ILLUSTRATIVE DEMO DATA — FICTIONAL']) {
      t.assert(tx.includes(fact), `PDF text includes "${fact}"`);
    }
    t.assert(/Closing balance\s+1,147\.50 USBC/.test(tx), 'closing balance 1,147.50 USBC in the summary');
    t.assert(!/ending in/.test(tx) && !tx.includes('?'), 'masked identifiers print as bullets; nothing fell outside the PDF encoding');
    // The ledger: every posted reference, in chronological order, then the closing row.
    const ord = en.order;
    const at = refs.posted.map((r) => ord.indexOf(r));
    t.assert(at.every((x) => x >= 0) && refs.posted.every((r) => tx.includes(r)), 'all 15 posted references are in the PDF');
    t.assert(at.every((x, i) => i === 0 || x > at[i - 1]), 'posted transactions in chronological order');
    t.assert(/Sep 1, 2026 Opening balance 1,000\.00 Sep 1, 2026 9:02 AM Aug 31, 2026 9:14 PM Previous period Deposit from linked bank account/.test(ord), 'the ledger opens with the opening balance, then the first posted transaction (initiated in the previous period)');
    const pendHead = ord.indexOf('Not included in the statement balance');
    const pendAt = ord.indexOf('REF-X6P3-9AT5');
    t.assert(pendHead > at[at.length - 1] && pendAt > pendHead && pendAt < ord.indexOf('Fees summary'), 'the pending REF-X6P3-9AT5 is listed under "Not included in the statement balance", after the ledger');
    t.eq(ord.split('REF-X6P3-9AT5').length - 1, 1, 'the pending item appears once (never in the ledger)');
    t.assert(/REF-T6J4-1NB8 -24\.50 1,147\.50 Sep 30, 2026 Closing balance 1,147\.50 /.test(ord), 'the ledger closes, dated at the period end, with the closing balance right after the last transaction');
    // Running footer on every page; the record's identification ends the last page.
    const pageTexts = tx.split('\f').filter((p) => p.trim());
    t.eq(pageTexts.length, en.pages, 'pdftotext sees every page');
    pageTexts.forEach((p, i) => {
      t.assert(p.includes(`Statement ${s.id} · version 1.0`) && p.includes(`Page ${i + 1} of ${en.pages}`) && p.includes('Illustrative demo data — fictional customer, amounts and references'), `page ${i + 1}: statement ID, "Page ${i + 1} of ${en.pages}" and the demo notice`);
      if (i > 0) t.assert(p.includes('Statement of record · September 1 – 30, 2026') && p.includes('Sam Ortega'), `page ${i + 1}: running header`);
      if (p.includes('Posted transactions (continued)')) t.assert(p.includes('Posted date') && p.includes('Balance after'), `page ${i + 1}: ledger column headers repeat`);
    });
    const lastPage = pageTexts[pageTexts.length - 1].replace(/\s+/g, ' ');
    t.assert(lastPage.includes('Disclosures') && lastPage.includes('This PDF was created on the device that downloaded it; nothing was sent.') && lastPage.includes(`Statement ${s.id} · version 1.0 · Generated Oct 1, 2026, 6:15 AM EDT`), 'the last page holds the disclosures with the identification block');
    // Right-aligned figures: every "Balance after" (and every unique ledger amount) ends on one edge.
    const balances = await page.evaluate(() => YES.calc.running().slice(0, -1).map((r) => YES.fmt.amount(r.balance, { unit: false })));
    const balRight = en.words.filter((w) => balances.includes(nbsp(w.w))).map((w) => w.x1);
    t.assert(balRight.length >= balances.length && Math.max(...balRight) - Math.min(...balRight) < 0.6, `"Balance after" figures are right-aligned (${balRight.length}, spread ${(Math.max(...balRight) - Math.min(...balRight)).toFixed(2)}pt)`);
    const amounts = await page.evaluate(() => YES.calc.posted().map((x) => YES.fmt.amount(x.amount, { sign: 'always', unit: false }).replace('−', '-')));
    const amtRight = en.words.filter((w) => amounts.includes(w.w) && en.words.filter((v) => v.w === w.w).length === 1).map((w) => w.x1);
    t.assert(amtRight.length >= 6 && Math.max(...amtRight) - Math.min(...amtRight) < 0.6, `ledger amounts are right-aligned (${amtRight.length})`);
    if (!mobile) {
      const r = spawnSync('pdftoppm', ['-r', '80', '-png', en.path, join(SHOTS, 'help-pdf-en')]);
      t.eq(r.status, 0, 'pdftoppm renders the English PDF');
    }
  } else {
    console.log('    (poppler-utils not available: PDF text checks skipped)');
  }

  t.step('statement-of-record PDF in Spanish');
  await setLang('es');
  const es = await getPdf('es');
  t.eq(es.name, `YES-statement-${s.id}-DEMO.pdf`, 'same file name in Spanish');
  const toastEs = await toastSays('PDF guardado');
  t.assert(/^PDF guardado en este dispositivo \(\d+ páginas\)\. No se envió nada\.$/.test(toastEs), 'Spanish toast: ' + toastEs);
  t.assert(es.raw.includes('/Lang <FEFF00650073002D00450053>'), 'catalog /Lang es-ES');
  t.assert(es.streams.every((x) => x.includes('(DATOS ILUSTRATIVOS DE DEMOSTRACI\\323N) Tj')), 'Spanish watermark on every page (Ó in WinAnsi)');
  if (poppler) {
    t.assert(/^Page size:\s+595\.28 x 841\.89 pts \(A4\)/m.test(es.info), 'Spanish: A4');
    t.eq(nbsp((es.info.match(/^Title:\s+(.*)$/m) || [])[1] || ''), 'Estado de cuenta oficial de YES del 1 al 30 de septiembre de 2026 (YES-STM-202609-000184)', 'Spanish title');
    const tx = es.text;
    for (const fact of ['Estado de cuenta oficial', 'Cuenta de stablecoin de YES •••• 7316', 'Monedero 0x5A…E19C', 'Período del estado de cuenta', 'Resumen del saldo', 'Saldo inicial 1.000,00 + Depósitos 500,00', 'Movimientos registrados', 'Fecha de inicio', 'Período anterior', 'Comisión de REF-N8C4-2VB9', 'Resumen de comisiones', 'Divulgaciones', 'Página 1 de ' + es.pages, 'Datos ilustrativos de demostración — cliente, importes y referencias ficticios', 'DATOS ILUSTRATIVOS DE DEMOSTRACIÓN']) {
      t.assert(tx.includes(fact), `Spanish PDF text includes "${fact}"`);
    }
    t.assert(/Saldo final\s+1\.147,50 USBC/.test(tx), 'Spanish closing balance 1.147,50 USBC');
    t.assert(!tx.includes('?') && !/ending in|que termina en/.test(tx), 'Spanish text fully encoded');
    const ord = es.order;
    const at = refs.posted.map((r) => ord.indexOf(r));
    t.assert(at.every((x, i) => x >= 0 && (i === 0 || x > at[i - 1])), 'all 15 posted references, in order');
    const pendHead = ord.indexOf('No incluido en el saldo del estado de cuenta');
    t.assert(pendHead > at[at.length - 1] && ord.indexOf('REF-X6P3-9AT5') > pendHead, 'pending item under "No incluido en el saldo del estado de cuenta"');
    t.assert(/REF-T6J4-1NB8 -24,50 1\.147,50 30 sept 2026 Saldo final 1\.147,50 /.test(ord), 'Spanish ledger closes with "Saldo final 1.147,50"');
    tx.split('\f').filter((p) => p.trim()).forEach((p, i) => t.assert(p.includes(`Página ${i + 1} de ${es.pages}`), `Spanish page ${i + 1} numbered`));
    if (!mobile) t.eq(spawnSync('pdftoppm', ['-r', '80', '-png', es.path, join(SHOTS, 'help-pdf-es')]).status, 0, 'pdftoppm renders the Spanish PDF');
  }
  await setLang('en');

  t.step('statement-of-record PDF: API and options');
  const api = await page.evaluate(() => {
    const latin1 = (bytes) => {
      let out = '';
      for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
      return out;
    };
    const stable = (o) => latin1(o.bytes).replace(/\/(CreationDate|ModDate) \([^)]*\)/g, '').replace(/\/ID \[[^\]]*\]/g, '');
    const res = {};
    const base = YES.help.buildPdf();
    res.base = { name: base.name, size: base.size, pages: base.pages };
    // The file never depends on the screen theme.
    YES.theme.set('dark');
    const dark = stable(YES.help.buildPdf());
    YES.theme.set('light');
    res.sameInBothThemes = dark === stable(YES.help.buildPdf());
    YES.theme.set(null);
    // Outside the showcase: no watermark, no demo notices, no -DEMO suffix.
    YES.config.demo = false;
    const live = YES.help.buildPdf();
    YES.config.demo = true;
    const liveRaw = latin1(live.bytes);
    res.live = { name: live.name, mark: /ILLUSTRATIVE DEMO DATA|Illustrative demo data/i.test(liveRaw) };
    // Page size is configurable.
    YES.config.pdf = { pageSize: 'a4' };
    const a4 = YES.help.buildPdf();
    delete YES.config.pdf;
    res.a4 = { size: a4.size, box: latin1(a4.bytes).includes('/MediaBox [0 0 595.28 841.89]') };
    // A withheld statement makes no PDF.
    YES.integrity.ok = false;
    res.withheld = YES.help.downloadPdf();
    YES.integrity.ok = true;
    res.typeof = typeof YES.help.downloadPdf;
    return res;
  });
  t.eq(api.base, { name: `YES-statement-${s.id}-DEMO.pdf`, size: 'letter', pages: en.pages || api.base.pages }, 'YES.help.buildPdf(): name, size, pages');
  t.assert(api.sameInBothThemes, 'the PDF is identical in the light and dark themes');
  t.eq(api.live, { name: `YES-statement-${s.id}.pdf`, mark: false }, 'outside demo mode: no watermark, no demo notice, no -DEMO suffix');
  t.eq(api.a4, { size: 'a4', box: true }, 'YES.config.pdf.pageSize overrides the page size');
  t.eq([api.withheld, api.typeof], [null, 'function'], 'a withheld statement makes no PDF');
  t.assert((await toastSays('withheld')).includes('withheld'), 'and says why');

  /* ------------------------------------------------------------------ */
  t.step('dark colour scheme');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => YES.help.open('integrity'));
  await settle(700);
  await t.shot('dark-integrity');
  await page.evaluate(() => YES.help.open('contact'));
  await settle(700);
  await t.shot('dark-contact');
  await page.evaluate(() => YES.help.open('record'));
  await settle(700);
  await shotEl('#help-record', 'record-dark-device');
  await seriousAxe('#view-help', 'help view (dark)');
  await page.emulateMedia({ colorScheme: 'light' });

  t.step('dark mode chosen in the masthead');
  await page.evaluate(() => YES.theme.set('dark'));
  t.eq(await page.getAttribute('html', 'data-theme'), 'dark', 'dark theme applied');
  const lum = (c) => {
    const m = c.match(/[\d.]+/g).map(Number);
    return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
  };
  const darkColors = await page.$eval('#help-record .help-dl__opt', (e) => ({ bg: getComputedStyle(e).backgroundColor, ink: getComputedStyle(e.querySelector('.help-dl__title')).color }));
  t.assert(lum(darkColors.bg) < 0.2 && lum(darkColors.ink) > 0.7, 'options follow the dark tokens: ' + JSON.stringify(darkColors));
  await shotEl('#help-record', 'record-dark');
  await seriousAxe('#help-record', 'Download or print (dark mode chosen)');
  await page.evaluate(() => YES.help.open('about'));
  await settle(500);
  await shotEl('#help-about', 'about-dark');
  await seriousAxe('#help-about', 'About this demo (dark mode chosen)');
  await page.evaluate(() => YES.theme.set('light'));
  t.assert(lum(await page.$eval('#help-record .help-dl__opt', (e) => getComputedStyle(e).backgroundColor)) > 0.9, 'light choice: light surfaces');
  await page.evaluate(() => YES.theme.set(null));

  /* ------------------------------------------------------------------ */
  t.step('exception preview');
  await page.evaluate(() => YES.help.open('integrity'));
  await focusedIs('help-integrity-title', 'integrity focused');
  await Promise.all([page.waitForEvent('load'), page.click('[data-help-preview]')]);
  await page.waitForFunction(() => window.YES && window.YES.ready === true, null, { timeout: 10000 });
  t.assert(await page.locator('#withheld-title').isVisible(), 'preview leads to the withheld state');
  t.assert(!(await page.locator('#main').isVisible()), 'statement suppressed in the preview');
  t.assert((await text('#integrity-root')).includes('simulated'), 'simulated failure is labelled');
  await Promise.all([page.waitForEvent('load'), page.click('[data-integrity-return]')]);
  await page.waitForFunction(() => window.YES && window.YES.ready === true, null, { timeout: 10000 });
  t.assert(await page.evaluate(() => YES.integrity.ok), 'returns to the valid statement');
}
