// Help view: contextual help, contact placeholders, feedback, statement record,
// integrity checks and exception preview, accessibility + UserWay status,
// about/slots, YES.help.open + #/help/<section> routes, language switch,
// statement-of-record print view, accessibility (axe) and mobile reflow.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

export const meta = { name: 'help', viewports: ['desktop', 'mobile'], hash: '#/help' };

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-results', 'screens');
const SECTIONS = {
  contact: 'Contact support',
  feedback: 'Feedback',
  record: 'Statement record',
  integrity: 'Statement integrity',
  accessibility: 'Accessibility',
  about: 'About this demo'
};

export default async function (t) {
  const { page } = t;
  const mobile = t.viewport !== 'desktop';
  mkdirSync(SHOTS, { recursive: true });
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
  const setLang = async (l) => {
    await page.click(`[data-lang="${l}"]`);
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
  t.step('statement record');
  const recTxt = await text('#help-record');
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
  for (const v of ['1,000.00', '500.00', '200.00', '450.00', '100.00', '2.50', '1,147.50 EXUSD']) t.assert(eqVisual.includes(v), `equation shows ${v}`);
  const spoken = await page.locator('#help-integrity .help-eq .sr-only').textContent();
  t.assert(nbsp(spoken).startsWith('Opening balance 1,000.00 EXUSD, plus deposits 500.00 EXUSD') && nbsp(spoken).includes('minus fees 2.50 EXUSD, equals closing balance 1,147.50 EXUSD.'), 'equation spoken text');
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
  for (const f of ['Keyboard', 'Screen readers', 'Visible focus', 'Reduced motion', 'Zoom and reflow', 'Text alternatives for charts', 'Two languages']) t.assert(a11y.includes(f), `feature: ${f}`);
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
  for (const x of ['Online only', 'Local demo', 'Local mock', 'Placeholder', 'Session only', 'None', 'Illustrative only', 'Not connected', 'no live blockchain verification', 'no reserve assertion']) t.assert(about.includes(x), `about mentions ${x}`);
  const slots = await page.$$eval('[data-help-slots] tbody tr', (els) => els.map((e) => e.getAttribute('data-slot-row')));
  t.eq(slots, ['YES_LOGO', 'YES_PRIMARY', 'YES_ACCENT', 'YES_FONT', 'PRODUCT_NAME', 'ISSUER_OR_PARTNER', 'VIDEO_POSTER', 'DISCLOSURES', 'SUPPORT'], 'replacement slots');
  const slotsCfg = await page.evaluate(() => YES.config.slots);
  t.assert(about.includes(slotsCfg.YES_PRIMARY) && about.includes(slotsCfg.YES_ACCENT), 'colour slot values');
  t.assert(about.includes(slotsCfg.PRODUCT_NAME.en) && about.includes(slotsCfg.ISSUER_OR_PARTNER.en), 'product and issuer slot values');
  t.assert(about.includes(slotsCfg.DISCLOSURES.en.slice(0, 40)), 'disclosures slot value');
  t.eq(await page.locator('[data-help-slots] .tag--illustrative').count(), 9, 'every slot tagged as placeholder');
  await shotEl('#help-about', 'about');

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
  t.eq(await text('[data-print-closing]'), '1,147.50 EXUSD', 'closing balance 1,147.50');
  t.assert(pr.includes('Not included in the statement balance'), 'pending section heading');
  t.eq(await page.$$eval('#print-root [data-print-pending]', (els) => els.map((e) => e.getAttribute('data-print-pending'))), ['TX-260930-2247'], 'pending transaction listed separately');
  t.eq(await page.locator('#print-root [data-print-ledger] [data-print-pending]').count(), 0, 'pending not in the posted ledger');
  for (const fact of ['Statement of record', 'Sam Ortega', '100 Sample Avenue, Apt 4', 'Anytown, ST 00000', '•••• 7316', s.id, 'Version', 'Issue status', 'Original', 'Generated', 'Oct 1, 2026', 'Statement as of', 'America/New_York', 'Date basis', 'Posted date', 'Initiated date', 'Previous period', 'Balance summary', 'Fees summary', 'Disclosures', 'Illustrative demo data — fictional customer, amounts and references']) {
    t.assert(pr.toLowerCase().includes(fact.toLowerCase()), `print includes "${fact}"`);
  }
  t.eq(await page.$$eval('#print-root [data-print-cat]', (els) => els.map((e) => e.getAttribute('data-print-cat'))), ['deposits', 'transfers_in', 'transfers_out', 'redemptions', 'fees'], 'summary categories');
  t.eq(await text('[data-print-eq]'), 'Opening balance 1,000.00 + Deposits 500.00 + Incoming transfers 200.00 − Outgoing transfers 450.00 − Redemptions 100.00 − Fees 2.50 = Closing balance 1,147.50 EXUSD', 'equation line');
  t.eq(await page.locator('#print-root [data-print-fee]').count(), 3, 'three fee lines');
  t.assert((await text('[data-print-fees] tfoot')).includes('−2.50'), 'fees total');
  t.assert(pr.includes(slotsCfg.DISCLOSURES.en.slice(0, 40)), 'disclosures slot printed');
  t.assert(pr.includes('Nothing you do on this page is sent anywhere'), 'demo footer');
  const tx1 = await text('[data-print-tx="TX-260901-0418"]');
  t.assert(tx1.includes('REF-D7K2-9QW4') && tx1.includes('+250.00') && tx1.includes('Deposit') && tx1.includes('Linked bank account'), 'row has reference, signed amount, type label and counterparty');
  t.assert(!(await page.$$eval('#print-root .amount, #print-root [style*="color"]', (els) => els.length)), 'no colour-coded amounts in print');
  await settle(100);
  await t.shot('print', { fullPage: true });
  if (!mobile) {
    try {
      await page.pdf({ path: join(SHOTS, 'help-print.pdf'), format: 'A4', printBackground: true });
    } catch {
      /* PDF output needs headless Chromium; the screenshot covers the layout. */
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

  /* ------------------------------------------------------------------ */
  t.step('dark colour scheme');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => YES.help.open('integrity'));
  await settle(700);
  await t.shot('dark-integrity');
  await page.evaluate(() => YES.help.open('contact'));
  await settle(700);
  await t.shot('dark-contact');
  await seriousAxe('#view-help', 'help view (dark)');
  await page.emulateMedia({ colorScheme: 'light' });

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
