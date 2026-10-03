// Transaction inquiry: multi-step local mock, accessible validation, review,
// "Demo only — no inquiry was sent" confirmation, draft kept across close and
// language switch, duplicate-prevention demo, hand-offs with the transaction
// detail, full-screen sheet on mobile, axe, no network.
export const meta = { name: 'inquiry', viewports: ['desktop', 'mobile'] };

const TX = 'TX-260909-2051';
const TX2 = 'TX-260918-2011';
const PENDING = 'TX-260930-2247';
const REF_RE = /^DEMO-INQ-[2-9A-HJ-NP-Z]{4}$/;

export default async function (t) {
  const { page } = t;
  const mobile = t.viewport !== 'desktop';
  // Amounts use a no-break space before the unit (YES.fmt); compare with plain spaces.
  const nbsp = (s) => String(s).replace(/ /g, ' ');
  const text = (sel) => page.locator(sel).innerText().then(nbsp);
  const isOpen = () => page.evaluate(() => document.getElementById('inquiry-dialog').open);
  const waitOpen = () => page.waitForFunction(() => document.getElementById('inquiry-dialog').open, null, { timeout: 3000 });
  // `open` flips at once; the 'close' event (draft clean-up, focus return) follows a task later.
  const waitClosed = () =>
    page.waitForFunction(() => {
      const d = document.getElementById('inquiry-dialog');
      return !d.open && !d.hasAttribute('data-step');
    }, null, { timeout: 3000 });
  const activeFk = () => page.evaluate(() => document.activeElement && (document.activeElement.getAttribute('data-fk') || document.activeElement.id));
  const expectFocus = async (fk, msg) => {
    await page
      .waitForFunction((k) => document.activeElement && (document.activeElement.getAttribute('data-fk') === k || document.activeElement.id === k), fk, { timeout: 2000 })
      .catch(() => {});
    t.eq(await activeFk(), fk, msg);
  };
  const step = () =>
    page.evaluate(() => {
      const li = document.querySelectorAll('#inquiry-dialog .inq-steps li[aria-current="step"]');
      return li.length === 1 ? li[0].getAttribute('data-inq-stepitem') : 'current-count:' + li.length;
    });
  const draft = (id) => page.evaluate((x) => YES.inquiry.draftFor(x), id);
  const title = () => text('#inquiry-dialog-title').then((s) => s.trim());
  const dialogText = () => text('#inquiry-dialog');
  const noHScroll = () =>
    page.evaluate(() => {
      const de = document.documentElement;
      const body = document.querySelector('#inquiry-dialog .inq-body');
      const d = document.getElementById('inquiry-dialog');
      return {
        page: de.scrollWidth <= window.innerWidth + 1,
        dialog: !d.open || d.scrollWidth <= d.clientWidth + 1,
        body: !body || body.scrollWidth <= body.clientWidth + 1
      };
    });
  const settle = () => page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 2000 }).catch(() => {});
  const seriousAxe = async (label) => {
    await settle(); // contrast is measured on settled colours, not mid-fade
    const v = await t.axe('#inquiry-dialog');
    const bad = v.filter((x) => x.impact === 'serious' || x.impact === 'critical');
    t.eq(bad, [], `axe serious/critical violations (${label})`);
    const minor = v.filter((x) => !(x.impact === 'serious' || x.impact === 'critical'));
    if (minor.length) console.log(`    (axe ${label}, ${t.viewport}: ${minor.map((x) => x.id + '/' + x.impact).join(', ')})`);
  };
  // Screenshots wait for the dialog and step transitions to finish.
  const shot = async (label) => {
    await settle();
    await t.shot(label);
  };
  // A page-level control that starts the inquiry, so focus return can be checked.
  const addTrigger = () =>
    page.evaluate((id) => {
      if (document.getElementById('inq-test-trigger')) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.id = 'inq-test-trigger';
      b.className = 'btn';
      b.setAttribute('data-fk', 'inq-test-trigger');
      b.textContent = 'Test: ask about a transaction';
      b.addEventListener('click', () => YES.inquiry.start(b.getAttribute('data-tx') || id, { trigger: b }));
      document.getElementById('main').prepend(b);
    }, TX);
  const openWith = async (id) => {
    await page.evaluate((x) => document.getElementById('inq-test-trigger').setAttribute('data-tx', x), id);
    await page.focus('#inq-test-trigger');
    await page.keyboard.press('Enter');
    await waitOpen();
  };
  const close = async () => {
    await page.keyboard.press('Escape');
    await waitClosed();
  };
  const realExplorer = await page.evaluate(() => !!document.querySelector('#h-transactions'));

  /* ------------------------------------------------------------------ */
  t.step('open on the transaction step');
  await addTrigger();
  await openWith(TX);
  t.assert(await isOpen(), 'YES.inquiry.start opens the inquiry dialog');
  t.eq(await title(), 'Ask about this transaction', 'dialog title');
  t.eq(await page.getAttribute('#inquiry-dialog', 'aria-labelledby'), 'inquiry-dialog-title', 'dialog labelled by its title');
  await expectFocus('inq-title', 'focus moves to the dialog title');
  t.eq(await step(), 'transaction', 'step indicator: Transaction is the current step');
  t.eq(await page.locator('#inquiry-dialog ol.steps > li').count(), 4, 'four steps');
  t.assert(!!(await page.getAttribute('#inquiry-dialog ol.steps', 'aria-label')), 'step indicator is labelled');
  t.eq((await text('#inquiry-dialog .inq-steps')).replace(/\s+/g, ' ').trim(), 'Transaction Details Review Confirmation'.replace(/ /g, ' '), 'step labels');
  const s1 = await dialogText();
  t.assert(/step 1 of 4/i.test(s1), 'step heading names the position');
  t.assert(s1.includes('Sent') && s1.includes('Sent to an external wallet on a blockchain network'), 'transaction label carried in');
  t.assert(s1.includes('External wallet 0x9C1D…44B7'), 'counterparty carried in');
  t.assert(s1.includes('Sep 9, 2026'), 'posted date carried in');
  t.assert(s1.includes('−200.00 EXUSD'), 'signed amount carried in');
  t.assert(s1.includes('REF-N8C4-2VB9'), 'reference carried in');
  t.assert(s1.includes('Linked fee') && s1.includes('−1.00 EXUSD'), 'linked fee shown from calc.feesFor');
  t.assert(s1.includes('not a formal dispute') || s1.includes('isn’t a formal dispute'), 'inquiry distinguished from a dispute or fraud report');
  t.assert(await page.locator('#inquiry-dialog .inq-head .tag--illustrative').isVisible(), 'visible demo tag in the header');
  t.assert(await page.locator('[data-inq-backtx]').isVisible(), 'Back to transaction is available');
  t.eq(await page.locator('#inquiry-dialog a[href^="http"], #inquiry-dialog [src^="http"]').count(), 0, 'no external links');
  if (mobile) {
    await page.waitForFunction(() => document.getElementById('inquiry-dialog').getAnimations().every((a) => a.playState === 'finished'), null, { timeout: 2000 }).catch(() => {});
    const box = await page.evaluate(() => {
      const r = document.getElementById('inquiry-dialog').getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), vw: window.innerWidth, vh: window.innerHeight };
    });
    t.assert(box.x === 0 && box.y === 0 && box.w === box.vw && Math.abs(box.h - box.vh) <= 1, 'full-screen sheet on mobile: ' + JSON.stringify(box));
  }
  t.eq(await noHScroll(), { page: true, dialog: true, body: true }, 'no horizontal scroll');
  await seriousAxe('transaction step');
  await shot('step1');

  /* ------------------------------------------------------------------ */
  t.step('details step');
  await page.click('[data-inq-next]');
  t.eq(await step(), 'details', 'Details is the current step');
  await expectFocus('inq-h-details', 'focus moves to the step heading');
  t.eq(await page.locator('#inquiry-dialog input[name="inq-reason"]').count(), 5, 'five reasons');
  t.eq(await page.locator('#inquiry-dialog input[name="inq-channel"]').count(), 3, 'three reply channels');
  const s2 = await dialogText();
  for (const r of ['I don’t recognise this transaction', 'The amount looks wrong', 'It’s still pending', 'I have a question about a fee', 'Something else']) t.assert(s2.includes(r), 'reason: ' + r);
  for (const c of ['In-app message', 'Email on file', 'Phone call on file']) t.assert(s2.includes(c), 'channel: ' + c);
  t.assert(s2.includes('This demo collects no contact details'), 'says the demo collects no contact details');
  t.assert(s2.includes('details already on your account'), 'production uses the details already on the account');
  t.assert(/passwords, full card or account numbers, or recovery phrases/.test(s2), 'sensitive-data warning');
  t.eq(await page.getAttribute('#inq-desc', 'maxlength'), '500', 'description max 500');
  t.eq((await text('#inq-desc-count')).trim(), '500 characters left', 'character counter');
  t.assert((await page.getAttribute('#inq-desc', 'aria-describedby')).includes('inq-desc-count'), 'counter linked to the textarea');
  t.eq(await page.locator('#inquiry-dialog input[type="email"], #inquiry-dialog input[type="tel"], #inquiry-dialog input[type="text"]').count(), 0, 'no contact-detail inputs');
  t.eq(await page.getAttribute('[data-inq-group="reason"]', 'role'), 'radiogroup', 'reason is a radio group');
  t.eq(await page.getAttribute('[data-inq-group="reason"]', 'aria-required'), 'true', 'reason required');
  t.eq(await page.getAttribute('[data-inq-group="channel"]', 'aria-required'), 'true', 'channel required');
  t.eq(await noHScroll(), { page: true, dialog: true, body: true }, 'no horizontal scroll');
  await shot('step2');

  /* ------------------------------------------------------------------ */
  t.step('missing required fields: error summary and inline errors');
  await page.click('[data-inq-next]');
  t.eq(await step(), 'details', 'stays on Details');
  const summary = page.locator('#inquiry-dialog .inq-errors');
  t.assert(await summary.isVisible(), 'error summary shown');
  t.eq(await summary.getAttribute('role'), 'alert', 'summary has role=alert');
  await expectFocus('inq-errors', 'focus moves to the error summary');
  const links = await page.$$eval('#inquiry-dialog .inq-errors a', (as) => as.map((a) => [a.getAttribute('data-inq-errlink'), a.textContent.trim()]));
  t.eq(links, [['reason', 'Choose what your inquiry is about.'], ['channel', 'Choose how YES should reply.']], 'summary links, in form order');
  const inv = await page.evaluate(() => {
    const g = (f) => document.querySelector('[data-inq-group="' + f + '"]');
    const radios = (f) => Array.from(document.querySelectorAll('input[name="inq-' + f + '"]')).every((r) => r.getAttribute('aria-invalid') === 'true');
    return {
      reason: g('reason').getAttribute('aria-invalid'),
      channel: g('channel').getAttribute('aria-invalid'),
      reasonRadios: radios('reason'),
      channelRadios: radios('channel'),
      reasonDesc: (g('reason').getAttribute('aria-describedby') || '').split(' ').includes('inq-reason-error'),
      channelDesc: (g('channel').getAttribute('aria-describedby') || '').split(' ').includes('inq-channel-error'),
      reasonMsg: (document.getElementById('inq-reason-error') || {}).textContent,
      channelMsg: (document.getElementById('inq-channel-error') || {}).textContent,
      descInvalid: document.getElementById('inq-desc').getAttribute('aria-invalid')
    };
  });
  t.eq(inv.reason, 'true', 'reason group aria-invalid');
  t.eq(inv.channel, 'true', 'channel group aria-invalid');
  t.assert(inv.reasonRadios && inv.channelRadios, 'radios carry aria-invalid');
  t.assert(inv.reasonDesc && inv.channelDesc, 'inline errors linked with aria-describedby');
  t.assert(/Error:\s*Choose what your inquiry is about\./.test(inv.reasonMsg || ''), 'inline reason error with prefix');
  t.assert(/Choose how YES should reply\./.test(inv.channelMsg || ''), 'inline channel error');
  t.eq(inv.descInvalid, null, 'optional description is not invalid');
  await page.waitForFunction(() => document.getElementById('live-assertive').textContent.includes('2 answers need your attention'), null, { timeout: 2000 }).catch(() => {});
  t.assert((await text('#live-assertive')).includes('2 answers need your attention'), 'error count announced assertively');
  await seriousAxe('error state');
  await shot('errors');
  const hashBefore = await page.evaluate(() => location.hash);
  await page.click('[data-inq-errlink="channel"]');
  await expectFocus('inq-channel-in_app', 'summary link moves focus to the channel field');
  t.eq(await page.evaluate(() => location.hash), hashBefore, 'summary links never change the route');
  await page.click('[data-inq-errlink="reason"]');
  await expectFocus('inq-reason-unrecognised', 'summary link moves focus to the reason field');

  t.step('answering a field clears its error');
  await page.click('label[for="inq-reason-amount"]');
  t.eq(await page.locator('#inq-reason-error').count(), 0, 'reason error removed');
  t.eq(await page.getAttribute('[data-inq-group="reason"]', 'aria-invalid'), null, 'reason group valid');
  t.eq(await page.$$eval('#inquiry-dialog .inq-errors a', (as) => as.map((a) => a.getAttribute('data-inq-errlink'))), ['channel'], 'summary keeps the remaining error');
  await page.click('label[for="inq-channel-email"]');
  t.eq(await page.locator('#inquiry-dialog .inq-errors').count(), 0, 'summary removed once everything is answered');

  t.step('description: counter and sensitive-number guard');
  await page.fill('#inq-desc', 'My card is 4111 1111 1111 1111');
  await page.click('[data-inq-next]');
  t.eq(await step(), 'details', 'a full card number blocks the step');
  t.eq(await page.getAttribute('#inq-desc', 'aria-invalid'), 'true', 'description aria-invalid');
  t.assert((await page.getAttribute('#inq-desc', 'aria-describedby')).split(' ').includes('inq-description-error'), 'description error linked');
  await expectFocus('inq-errors', 'focus to the summary');
  const desc = 'The amount is higher than I expected.\nPlease check it.';
  await page.fill('#inq-desc', desc);
  t.eq(await page.getAttribute('#inq-desc', 'aria-invalid'), null, 'error clears once the number is removed');
  t.eq(await page.locator('#inquiry-dialog .inq-errors').count(), 0, 'summary cleared');
  t.eq((await text('#inq-desc-count')).trim(), `${500 - desc.length} characters left`, 'counter follows the text');
  await page.locator('[data-inq-group="channel"]').scrollIntoViewIfNeeded();
  await shot('channel');
  const st = await page.evaluate(() => YES.state.inquiry);
  t.eq([st.txId, st.step, st.reason, st.channel, st.description, st.status], [TX, 'details', 'amount', 'email', desc, 'draft'], 'answers live in YES.state.inquiry');

  /* ------------------------------------------------------------------ */
  t.step('draft survives closing and reopening');
  await page.click('[data-inq-close]');
  await waitClosed();
  await expectFocus('inq-test-trigger', 'focus returns to the trigger');
  const d1 = await draft(TX);
  t.eq([d1 && d1.status, d1 && d1.step, d1 && d1.reason, d1 && d1.channel], ['draft', 'details', 'amount', 'email'], 'draftFor returns the draft');
  await openWith(TX);
  t.eq(await step(), 'details', 'resumes at its step');
  t.assert(await page.locator('[data-inq-notice="resumed"]').isVisible(), 'welcome-back notice');
  t.assert(await page.isChecked('#inq-reason-amount'), 'reason kept');
  t.assert(await page.isChecked('#inq-channel-email'), 'channel kept');
  t.eq(await page.inputValue('#inq-desc'), desc, 'description kept (including its line break)');

  t.step('Spanish: switch with the dialog closed, then reopen');
  await close();
  await page.click('[data-lang="es"]');
  await page.waitForFunction(() => YES.i18n.lang === 'es');
  await openWith(TX);
  t.eq(await title(), 'Preguntar por este movimiento', 'Spanish title');
  t.eq(await step(), 'details', 'same step');
  const es = await dialogText();
  t.assert(/paso 2 de 4/i.test(es) && es.includes('Detalles'), 'Spanish step labels');
  t.assert(es.includes('¿Sobre qué es tu consulta?') && es.includes('¿Cómo quieres que YES te responda?'), 'Spanish legends');
  t.assert(es.includes('El importe no parece correcto') && es.includes('Correo electrónico registrado'), 'Spanish choices');
  t.assert(es.includes('Esta demostración no recoge datos de contacto'), 'Spanish no-contact-details hint');
  t.assert(await page.isChecked('#inq-reason-amount'), 'same reason');
  t.assert(await page.isChecked('#inq-channel-email'), 'same channel');
  t.eq(await page.inputValue('#inq-desc'), desc, 'same description');
  t.eq((await text('#inq-desc-count')).trim(), `Quedan ${500 - desc.length} caracteres`, 'Spanish counter');
  await page.locator('[data-inq-group="channel"]').scrollIntoViewIfNeeded();
  await shot('es-channel');
  await page.click('[data-inq-next]');
  t.eq(await step(), 'review', 'Spanish review');
  t.assert((await dialogText()).includes('Solo demostración: no se enviará nada.'), 'Spanish demo note');
  await seriousAxe('Spanish review');
  await shot('es-review');

  t.step('language switch while the dialog is open keeps step, answers and focus');
  await page.focus('[data-fk="inq-edit-reason"]');
  await page.evaluate(() => YES.setLang('en'));
  t.assert(await isOpen(), 'still open');
  t.eq(await title(), 'Ask about this transaction', 'English again');
  t.eq(await step(), 'review', 'same step');
  await expectFocus('inq-edit-reason', 'focus kept on the same control');
  t.eq(await page.evaluate(() => YES.i18n.audit()), {}, 'i18n parity');

  /* ------------------------------------------------------------------ */
  t.step('review shows every entry with edit links and the demo note');
  await expectFocus('inq-edit-reason', 'focus on Change reason');
  const rv = await dialogText();
  t.assert(rv.includes('Demo only — nothing will be sent'), 'review demo note');
  t.assert(rv.includes('The amount looks wrong'), 'reason shown');
  t.assert(rv.includes('The amount is higher than I expected.') && rv.includes('Please check it.'), 'description shown');
  t.assert(rv.includes('Email on file'), 'channel shown');
  t.assert(rv.includes('REF-N8C4-2VB9') && rv.includes('−200.00 EXUSD'), 'transaction shown');
  t.eq(await page.$$eval('[data-inq-edit]', (bs) => bs.map((b) => b.getAttribute('data-inq-edit'))), ['transaction', 'reason', 'description', 'channel'], 'an edit link per entry');
  t.assert((await text('[data-inq-edit="channel"]')).includes('Reply by'), 'edit links have specific accessible names');
  await page.click('[data-inq-edit="description"]');
  t.eq(await step(), 'details', 'edit goes back to Details');
  await expectFocus('inq-desc', 'focus on the field being changed');
  await page.click('[data-inq-next]');
  t.eq(await step(), 'review', 'back to review');
  await page.click('[data-inq-edit="transaction"]');
  t.eq(await step(), 'transaction', 'edit transaction goes to step 1');
  await page.click('[data-inq-next]');
  await page.click('[data-inq-next]');
  t.eq(await step(), 'review', 'forward to review again');
  await expectFocus('inq-h-review', 'focus on the review heading');
  await seriousAxe('review');
  await shot('review');

  /* ------------------------------------------------------------------ */
  t.step('demo submission');
  await page.click('[data-inq-submit]');
  t.eq(await title(), 'Demo only — no inquiry was sent', 'confirmation heading says exactly that');
  t.eq(await step(), 'done', 'Confirmation is the current step');
  t.eq(await page.locator('#inquiry-dialog .inq-steps li.is-done').count(), 3, 'earlier steps marked done');
  await expectFocus('inq-title', 'focus on the confirmation heading');
  const ref = (await text('[data-inq-ref]')).trim();
  t.assert(REF_RE.test(ref), 'fictional DEMO-INQ reference: ' + ref);
  const done = await dialogText();
  t.assert(/fictional demo reference/i.test(done) && done.includes('Fictional — not a case number'), 'reference labelled as fictional');
  t.assert(done.includes('No case was created'), 'says no case exists');
  t.assert(done.includes('authenticated, auditable'), 'production: authenticated, auditable submission');
  t.assert(done.includes('genuine case ID') && done.includes('status'), 'production: genuine case ID and status');
  t.assert(done.includes('duplicate'), 'production: duplicate prevention');
  t.assert(done.includes('redacted from analytics'), 'production: sensitive fields redacted from analytics');
  t.assert(done.includes('formal dispute or a fraud report') && done.includes('approved policy and timing copy'), 'inquiry vs dispute/fraud with placeholder');
  t.assert(done.includes('The amount looks wrong') && done.includes('Email on file'), 'what was entered is summarised');
  await page.waitForFunction(() => document.querySelector('#inquiry-dialog [data-inq-live-a]').textContent.includes('Demo only — no inquiry was sent'), null, { timeout: 2000 }).catch(() => {});
  t.assert((await page.evaluate(() => document.querySelector('#inquiry-dialog [data-inq-live-a]').textContent)).includes(ref), 'confirmation announced assertively inside the dialog');
  t.assert((await text('#live-assertive')).includes('Demo only — no inquiry was sent'), 'and through the shared assertive region');
  t.eq(t.external.filter((u) => !/cdn\.userway\.org/.test(u)), [], 'no network requests');
  t.eq(
    await page.evaluate(() => {
      const keys = [];
      try {
        for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
        for (let i = 0; i < sessionStorage.length; i++) keys.push(sessionStorage.key(i));
      } catch (e) {}
      return keys.filter((k) => /inq/i.test(k));
    }),
    [],
    'nothing stored outside YES.state'
  );
  t.eq(await noHScroll(), { page: true, dialog: true, body: true }, 'no horizontal scroll');
  await seriousAxe('confirmation');
  await shot('done');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot('dark-done');
  await page.evaluate(() => document.querySelector('#inquiry-dialog .inq-body').scrollTo(0, 99999));
  await shot('dark-done-bottom');
  await page.emulateMedia({ colorScheme: 'light' });

  /* ------------------------------------------------------------------ */
  t.step('after submission: duplicate-prevention demo');
  await page.click('[data-fk="inq-done"]');
  await waitClosed();
  await expectFocus('inq-test-trigger', 'focus returns to the trigger');
  const d2 = await draft(TX);
  t.eq([d2 && d2.status, d2 && d2.ref], ['submitted', ref], 'draftFor returns the submitted demo inquiry');
  await openWith(TX);
  t.eq(await title(), 'Demo only — no inquiry was sent', 'start() shows the existing confirmation');
  t.assert(await page.locator('[data-inq-notice="duplicate"]').isVisible(), 'duplicate notice');
  t.assert((await dialogText()).includes('You already completed a demo inquiry about this transaction'), 'explains the existing inquiry');
  t.eq((await text('[data-inq-ref]')).trim(), ref, 'same fictional reference');
  await shot('duplicate');
  await page.click('[data-inq-new]');
  t.eq(await step(), 'transaction', 'new demo inquiry starts at step 1');
  t.eq(await title(), 'Ask about this transaction', 'fresh inquiry');
  await expectFocus('inq-h-transaction', 'focus on the step heading');
  await close();
  const d3 = await draft(TX);
  t.eq([d3 && d3.status, d3 && d3.ref], ['submitted', ref], 'an unused new inquiry does not erase the completed one');

  /* ------------------------------------------------------------------ */
  t.step('pending transaction; Escape closes; untouched drafts are not kept');
  await openWith(PENDING);
  const p = await dialogText();
  t.assert(p.includes('Not posted yet') && p.includes('Not included in statement balance') && p.includes('Pending'), 'pending state explicit');
  t.assert(p.includes('REF-X6P3-9AT5'), 'pending reference carried in');
  await page.keyboard.press('Escape');
  await waitClosed();
  await expectFocus('inq-test-trigger', 'Escape closes and focus returns');
  t.eq(await draft(PENDING), null, 'no draft for an inquiry that was only opened');
  t.eq((await draft(TX)) && (await draft(TX)).status, 'submitted', 'the completed one is still there');

  /* ------------------------------------------------------------------ */
  t.step('Back to transaction keeps the draft and reopens the detail');
  await page.evaluate(() => {
    window.__openTx = [];
    const orig = YES.explorer.openTx;
    YES.explorer.openTx = function (id, o) {
      window.__openTx.push({ id, trigger: o && o.trigger ? o.trigger.getAttribute('data-fk') || o.trigger.id : null });
      return orig.apply(this, arguments);
    };
  });
  await openWith(TX2);
  await page.click('[data-inq-next]');
  await page.click('label[for="inq-reason-unrecognised"]');
  await page.click('[data-inq-backtx]');
  await waitClosed();
  t.eq(await page.evaluate(() => window.__openTx), [{ id: TX2, trigger: 'inq-test-trigger' }], 'YES.explorer.openTx(txId, { trigger })');
  const d4 = await draft(TX2);
  t.eq([d4 && d4.status, d4 && d4.step, d4 && d4.reason], ['draft', 'details', 'unrecognised'], 'draft kept');
  t.eq((await draft(TX)) && (await draft(TX)).status, 'submitted', 'other transaction’s inquiry kept separately');
  if (realExplorer) {
    await page.waitForFunction(() => document.getElementById('tx-dialog').open, null, { timeout: 3000 });
    t.eq((await text('[data-fk="txd-ask"]')).trim(), 'Continue your inquiry', 'detail offers “Continue your inquiry”');
    await page.click('[data-fk="txd-ask"]');
    await waitOpen();
    t.assert(!(await page.evaluate(() => document.getElementById('tx-dialog').open)), 'detail closed before the inquiry opens');
    t.eq(await step(), 'details', 'continues at its step');
    await close();
    await expectFocus('inq-test-trigger', 'focus returns to the control that opened the detail');
  } else {
    t.eq(await page.evaluate(() => document.activeElement === document.body), false, 'focus not lost when the detail is unavailable');
  }

  t.step('resume() reopens the draft in progress');
  await page.evaluate(() => YES.inquiry.resume({ trigger: document.getElementById('inq-test-trigger') }));
  await waitOpen();
  t.eq(await step(), 'details', 'resume opens the draft at its step');
  t.assert(await page.isChecked('#inq-reason-unrecognised'), 'with its answers');
  await close();

  /* ------------------------------------------------------------------ */
  t.step('hand-off from the transaction detail');
  if (realExplorer) {
    await page.evaluate((id) => YES.explorer.openTx(id, { trigger: document.getElementById('inq-test-trigger') }), PENDING);
    await page.waitForFunction(() => document.getElementById('tx-dialog').open);
    await page.click('[data-fk="txd-ask"]');
  } else {
    // Stand-in for the explorer's detail dialog (not part of the isolated build).
    await page.evaluate((id) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.id = 'fake-row';
      row.setAttribute('data-fk', 'fake-row');
      row.textContent = 'Row';
      document.getElementById('main').prepend(row);
      const d = document.getElementById('tx-dialog');
      d.innerHTML = '<h2 id="tx-dialog-title" tabindex="-1">Detail</h2><button type="button" id="fake-ask" data-fk="fake-ask">Ask about this transaction</button>';
      d.querySelector('#fake-ask').addEventListener('click', (e) => YES.inquiry.start(id, { trigger: e.currentTarget }));
      YES.ui.openDialog(d, { trigger: row, initialFocus: '#fake-ask' });
    }, PENDING);
    await page.click('#fake-ask');
  }
  await waitOpen();
  t.assert(!(await page.evaluate(() => document.getElementById('tx-dialog').open)), 'transaction detail closed first');
  t.eq(await page.evaluate(() => document.querySelectorAll('dialog[open]').length), 1, 'only one modal open');
  t.eq(await step(), 'transaction', 'starts on the transaction step');
  await expectFocus('inq-title', 'focus in the inquiry');
  await close();
  await expectFocus(realExplorer ? 'inq-test-trigger' : 'fake-row', 'focus returns to the control that opened the detail');

  /* ------------------------------------------------------------------ */
  if (mobile) {
    t.step('narrow 320px: no horizontal scroll on any step');
    await page.setViewportSize({ width: 320, height: 640 });
    await openWith(TX2);
    for (const s of ['details', 'review']) {
      if (s === 'details') t.eq(await step(), 'details', 'at details');
      else {
        await page.click('label[for="inq-channel-phone"]');
        await page.click('[data-inq-next]');
        t.eq(await step(), 'review', 'at review');
      }
      t.eq(await noHScroll(), { page: true, dialog: true, body: true }, `no horizontal scroll at 320px (${s})`);
      await shot('narrow-' + s);
    }
    await page.click('[data-inq-submit]');
    t.eq(await noHScroll(), { page: true, dialog: true, body: true }, 'no horizontal scroll at 320px (confirmation)');
    await shot('narrow-done');
    const tgt = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#inquiry-dialog button, #inquiry-dialog .choice'))
        .filter((b) => b.offsetParent !== null)
        .map((b) => {
          const r = b.getBoundingClientRect();
          return { k: b.getAttribute('data-fk') || b.className, h: Math.round(r.height), w: Math.round(r.width) };
        })
        .filter((r) => r.h < 44 || r.w < 44)
    );
    t.eq(tgt, [], '44px touch targets');
    await close();
    await page.setViewportSize({ width: 390, height: 844 });
  }

  t.step('deterministic reference from the transaction id');
  const refs = await page.evaluate(() => {
    const out = [];
    for (const id of ['TX-260909-2051', 'TX-260918-2011']) {
      const d = YES.inquiry.draftFor(id);
      out.push(d && d.ref);
    }
    return out;
  });
  t.eq(refs[0], ref, 'same reference for the same transaction');
  if (mobile) t.assert(REF_RE.test(refs[1]) && refs[1] !== ref, 'different transactions get different references');
  t.eq(await page.evaluate(() => YES.i18n.audit()), {}, 'i18n parity at the end');

  /* ------------------------------------------------------------------ */
  t.step('keyboard only: Next, arrow keys in a radio group, Back');
  await openWith(PENDING);
  await expectFocus('inq-title', 'focus on the title');
  await page.focus('[data-inq-next]');
  await page.keyboard.press('Enter');
  t.eq(await step(), 'details', 'Enter on Next');
  await page.focus('#inq-reason-unrecognised');
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  t.eq(await page.evaluate(() => YES.state.inquiry.reason), 'pending', 'arrow keys choose a reason');
  await expectFocus('inq-reason-pending', 'focus follows the selection');
  await page.focus('[data-inq-prev]');
  await page.keyboard.press('Enter');
  t.eq(await step(), 'transaction', 'Back returns to the previous step');
  await expectFocus('inq-h-transaction', 'focus on the step heading');

  t.step('discard a resumed draft');
  await close();
  t.eq((await draft(PENDING)) && (await draft(PENDING)).reason, 'pending', 'draft kept');
  await openWith(PENDING);
  t.assert(await page.locator('[data-inq-notice="resumed"]').isVisible(), 'resumed notice');
  await page.click('[data-inq-discard]');
  t.eq(await step(), 'transaction', 'starts over');
  t.eq(await page.evaluate(() => YES.state.inquiry.reason), '', 'answers cleared');
  t.eq(await page.locator('[data-inq-notice]').count(), 0, 'notice gone');
  await page.waitForFunction(() => document.querySelector('#inquiry-dialog [data-inq-live]').textContent.includes('Draft discarded'), null, { timeout: 2000 }).catch(() => {});
  t.assert((await page.evaluate(() => document.querySelector('#inquiry-dialog [data-inq-live]').textContent)).includes('Draft discarded'), 'discard announced');
  await close();
  t.eq(await draft(PENDING), null, 'nothing kept for a discarded draft');
  t.eq((await draft(TX)) && (await draft(TX)).status, 'submitted', 'other inquiries untouched');
}
