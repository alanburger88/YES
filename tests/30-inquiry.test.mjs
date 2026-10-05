// Transaction inquiry: multi-step local mock, accessible validation, review,
// "Demo only — no inquiry was sent" confirmation, draft kept across close and
// language switch, duplicate-prevention demo, hand-offs with the transaction
// detail, full-screen sheet on mobile, light and dark themes, axe, no network.
//
// Language (ARCHITECTURE rule 7): the dialog has no language switch of its own.
// It renders in the language chosen in the masthead (the phone Menu) before it
// opened; to change language the customer closes it (the draft is kept),
// switches in the masthead and reopens it.
export const meta = { name: 'inquiry', viewports: ['desktop', 'mobile'] };

const TX = 'TX-260909-2051'; // posted, on-chain, with a linked fee
const TX2 = 'TX-260918-2011'; // posted, no fee
const PENDING = 'TX-260930-2247'; // pending, no fee
const FEE = 'TX-260909-2052'; // a fee line
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
  const reasons = () => page.$$eval('#inquiry-dialog input[name="inq-reason"]', (as) => as.map((a) => a.value));
  // Every live region in the dialog (the module's own and any the shared ui.announce added).
  const liveText = () => page.$$eval('#inquiry-dialog > [aria-live]', (rs) => rs.map((r) => r.textContent).join('|').replace(/^\|+|\|+$/g, ''));
  /** Where the focused control sits against the dialog's footer: fully visible, and on top at its centre? */
  const focusedClearOfFooter = (sel) =>
    page.evaluate((s) => {
      const a = document.activeElement;
      const box = (s ? a.closest(s) : null) || a;
      const r = box.getBoundingClientRect();
      const foot = document.querySelector('#inquiry-dialog .inq-foot').getBoundingClientRect();
      const body = document.querySelector('#inquiry-dialog .inq-body').getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { id: a.id, visible: r.top >= body.top - 1 && r.bottom <= foot.top + 1, onTop: !!hit && box.contains(hit) };
    }, sel);
  const nextFrames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  // The masthead is the only language switch: the desktop row, or the phone Menu
  // (the first [data-lang] in the DOM is the hidden desktop switch on phones).
  const headerLang = async (l) => {
    t.assert(!(await isOpen()), 'the masthead language switch is used with the inquiry closed');
    if (mobile) {
      await page.click('#masthead [data-mast-menu]');
      await page.click(`#mast-menu [data-lang="${l}"]`);
      await page.keyboard.press('Escape'); // closes the Menu
    } else {
      await page.click(`#masthead .mast-wide [data-lang="${l}"]`);
    }
    await page.waitForFunction((x) => YES.i18n.lang === x && document.documentElement.lang === x, l, { timeout: 3000 });
  };
  const noLangSwitch = async (label) =>
    t.eq(
      await page.evaluate(() => {
        const d = document.getElementById('inquiry-dialog');
        return { lang: d.querySelectorAll('[data-lang], [data-fk^="inq-lang"]').length, seg: d.querySelectorAll('.seg--lang').length };
      }),
      { lang: 0, seg: 0 },
      `no language switch in the dialog (${label})`
    );
  /** Close sits inside the dialog with room for its 5px focus ring (the dialog clips), and nothing covers it. */
  const closeClear = async () => {
    await settle(); // measured once the dialog's entrance has finished
    return page.evaluate(() => {
      const d = document.getElementById('inquiry-dialog').getBoundingClientRect();
      const b = document.querySelector('#inquiry-dialog .inq-head__close');
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      // Layout size (offset*), which a transform's sub-pixel rounding never changes.
      return { ringRoom: r.top - d.top >= 4.5 && d.right - r.right >= 4.5, onTop: !!hit && b.contains(hit), size: b.offsetWidth >= 44 && b.offsetHeight >= 44 };
    });
  };

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
  t.assert(s1.includes('−200.00 USBC'), 'signed amount carried in');
  t.assert(s1.includes('REF-N8C4-2VB9'), 'reference carried in');
  t.assert(s1.includes('Linked fee') && s1.includes('−1.00 USBC'), 'linked fee shown from calc.feesFor');
  t.assert(s1.includes('not a formal dispute') || s1.includes('isn’t a formal dispute'), 'inquiry distinguished from a dispute or fraud report');
  t.assert(await page.locator('#inquiry-dialog .inq-head .tag--illustrative').isVisible(), 'visible demo tag in the header');
  t.assert(await page.locator('[data-inq-backtx]').isVisible(), 'Back to transaction is available');
  // One language switch, in the masthead: the dialog uses the language chosen there.
  await noLangSwitch('transaction step');
  t.eq(
    await page.$$eval('#inquiry-dialog .inq-head__bar button', (bs) => bs.map((b) => b.getAttribute('data-fk'))),
    ['inq-backtx', 'inq-close'],
    'header row: Back to transaction and Close, nothing else'
  );
  t.eq(await page.getAttribute('[data-fk="inq-close"]', 'aria-label'), 'Close the inquiry. Your draft is kept.', 'Close is named and says the draft is kept');
  t.eq(await page.evaluate(() => document.documentElement.lang), 'en', 'in the language chosen in the masthead');
  t.eq(await closeClear(), { ringRoom: true, onTop: true, size: true }, 'Close: uncovered, 44px, focus ring inside the dialog');
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
  // A posted transfer with a linked fee: "still pending" would contradict its status.
  t.eq(await reasons(), ['unrecognized', 'amount', 'fee', 'other'], 'reasons that fit a posted transaction with a fee');
  t.eq(await page.locator('#inquiry-dialog input[name="inq-channel"]').count(), 3, 'three reply channels');
  const s2 = await dialogText();
  for (const r of ['I don’t recognize this transaction', 'The amount looks wrong', 'I have a question about a fee', 'Something else']) t.assert(s2.includes(r), 'reason: ' + r);
  t.assert(!s2.includes('It’s still pending'), '“It’s still pending” is not offered for a posted transaction');
  t.assert(!/recognis|colour/.test(s2), 'US spelling, like the en-US dates and numbers');
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
  await noLangSwitch('details step');
  await shot('step2');

  t.step('tabbing to a field shows all of it above the footer');
  await page.focus('#inq-reason-unrecognized');
  await page.keyboard.press('Tab');
  await nextFrames();
  await settle();
  t.eq(await focusedClearOfFooter('[data-inq-reveal]'), { id: 'inq-desc', visible: true, onTop: true }, 'description field and its counter clear of the footer');
  await shot('tab-description');
  await page.keyboard.press('Tab');
  await nextFrames();
  await settle();
  t.eq(await focusedClearOfFooter('[data-inq-reveal]'), { id: 'inq-channel-in_app', visible: true, onTop: true }, 'reply-channel choice clear of the footer');
  await page.evaluate(() => document.querySelector('#inquiry-dialog .inq-body').scrollTo(0, 0));

  /* ------------------------------------------------------------------ */
  t.step('missing required fields: error summary and inline errors');
  await page.evaluate(() => {
    // Record what reaches assistive technology when the errors appear.
    window.__inqA11y = [];
    const d = document.getElementById('inquiry-dialog');
    new MutationObserver((ms) =>
      ms.forEach((m) => {
        const live = m.target.nodeType === 1 ? m.target.closest('[aria-live]') : m.target.parentElement && m.target.parentElement.closest('[aria-live]');
        if (live && live.textContent) window.__inqA11y.push('live:' + live.textContent);
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 1 && (n.matches('[role="alert"]') || n.querySelector('[role="alert"]'))) window.__inqA11y.push('alert');
        });
      })
    ).observe(d, { childList: true, subtree: true, characterData: true });
  });
  await page.click('[data-inq-next]');
  t.eq(await step(), 'details', 'stays on Details');
  const summary = page.locator('#inquiry-dialog .inq-errors');
  t.assert(await summary.isVisible(), 'error summary shown');
  await expectFocus('inq-errors', 'focus moves to the error summary');
  t.eq(
    [await summary.getAttribute('role'), await summary.getAttribute('aria-labelledby'), await summary.getAttribute('aria-describedby')],
    ['group', 'inq-errors-title', 'inq-errors-list'],
    'summary is a named group described by its list (announced once, when it takes focus)'
  );
  await page.waitForTimeout(250); // longer than any queued announcement
  t.eq(await page.evaluate(() => window.__inqA11y), [], 'no role=alert and no live-region message competing with the focused summary');
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
  await seriousAxe('error state');
  await shot('errors');
  const hashBefore = await page.evaluate(() => location.hash);
  await page.click('[data-inq-errlink="channel"]');
  await expectFocus('inq-channel-in_app', 'summary link moves focus to the channel field');
  t.eq(await page.evaluate(() => location.hash), hashBefore, 'summary links never change the route');
  await page.click('[data-inq-errlink="reason"]');
  await expectFocus('inq-reason-unrecognized', 'summary link moves focus to the reason field');

  t.step('answering a field clears its error');
  await page.click('label[for="inq-reason-amount"]');
  t.eq(await page.locator('#inq-reason-error').count(), 0, 'reason error removed');
  t.eq(await page.getAttribute('[data-inq-group="reason"]', 'aria-invalid'), null, 'reason group valid');
  t.eq(await page.$$eval('#inquiry-dialog .inq-errors a', (as) => as.map((a) => a.getAttribute('data-inq-errlink'))), ['channel'], 'summary keeps the remaining error');
  await page.click('label[for="inq-channel-email"]');
  t.eq(await page.locator('#inquiry-dialog .inq-errors').count(), 0, 'summary removed once everything is answered');

  t.step('description: counter and sensitive-number guard');
  // What the guard must let through: the statement's own identifiers and ordinary numbers.
  const hash = await page.evaluate((id) => YES.calc.tx(id).onchain.hash, TX);
  const randomHashes = await page.evaluate(() => {
    const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
    return Array.from({ length: 6 }, (_, i) => (i % 2 ? '0x' + hex() : hex().toUpperCase())).join(' ');
  });
  for (const ok of [
    'This is the network hash: ' + hash,
    'Network hash ' + hash.toLowerCase() + ' on statement YES-STM-202609-000184.',
    randomHashes,
    'Between 2026-09-24 2026-09-30 I sent 500 200 450 100 to TX-260909-2051.',
    'I expected 1,147.50, not 1,000,000,000,000.00.'
  ]) {
    await page.fill('#inq-desc', ok);
    await page.click('[data-inq-next]');
    t.eq([await step(), await page.evaluate(() => YES.state.inquiry.errors)], ['review', null], 'not mistaken for a card or account number: ' + ok.slice(0, 48));
    await page.click('[data-inq-prev]');
  }
  for (const bad of ['account 000123456789', 'card:4111111111111111', 'Amex 3782 822463 10005', '4111 1111 1111 1111 123']) {
    await page.fill('#inq-desc', bad);
    await page.click('[data-inq-next]');
    t.eq(await page.evaluate(() => YES.state.inquiry.errors), { description: 'sensitive' }, 'blocked: ' + bad);
  }
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

  t.step('live regions never keep a message from an earlier step');
  await page.fill('#inq-desc', 'Long note. '.repeat(38)); // 418 characters: the counter speaks up
  await page.waitForFunction(() => /characters left/.test(document.querySelector('#inquiry-dialog [data-inq-live]').textContent), null, { timeout: 3000 }).catch(() => {});
  t.assert(/82 characters left/.test(await liveText()), 'remaining characters announced politely near the limit');
  await page.focus('#inq-desc');
  await page.keyboard.press('End');
  await page.keyboard.type('x'); // queues another count announcement…
  await page.click('[data-inq-next]'); // …and leaves the step before it is spoken
  t.eq(await step(), 'review', 'at Review');
  t.eq(await liveText(), '', 'the Details announcement is gone at Review');
  await page.waitForTimeout(1000);
  t.eq(await liveText(), '', 'and no queued Details announcement arrives later');
  await page.click('[data-inq-edit="description"]');
  await page.fill('#inq-desc', desc);
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

  t.step('Spanish: switch in the masthead with the dialog closed, then reopen');
  await close();
  await headerLang('es');
  t.eq(await page.evaluate(() => YES.state.inquiry && [YES.state.inquiry.step, YES.state.inquiry.reason]), ['details', 'amount'], 'the draft is kept while the language changes');
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

  await noLangSwitch('Spanish review');

  t.step('a language change from script while the dialog is open keeps step, answers and focus');
  // No control in the dialog changes language, but YES.setLang still re-renders it in place.
  await page.focus('[data-fk="inq-edit-reason"]');
  await page.evaluate(() => YES.setLang('en'));
  t.assert(await isOpen(), 'still open');
  t.eq(await title(), 'Ask about this transaction', 'English again');
  t.eq(await step(), 'review', 'same step');
  await expectFocus('inq-edit-reason', 'focus kept on the same control');
  await page.waitForFunction(() => /Language changed to English/.test(Array.from(document.querySelectorAll('#inquiry-dialog > [aria-live]'), (r) => r.textContent).join('|')), null, { timeout: 2000 }).catch(() => {});
  t.eq(await liveText(), 'Language changed to English', 'announced inside the dialog (the page behind it is inert)');
  await noLangSwitch('after a language change');
  t.eq(await page.evaluate(() => YES.i18n.audit()), {}, 'i18n parity');

  t.step('change language mid-flow: close, switch in the masthead, resume');
  await page.click('[data-inq-close]');
  await waitClosed();
  await expectFocus('inq-test-trigger', 'focus returns to the trigger');
  t.eq(await liveText(), '', 'closing empties the dialog’s live regions');
  await headerLang('es');
  const kept = await draft(TX);
  t.eq([kept && kept.status, kept && kept.step, kept && kept.reason, kept && kept.channel, kept && kept.description], ['draft', 'review', 'amount', 'email', desc], 'the draft survives the language change');
  await page.evaluate(() => YES.inquiry.resume({ trigger: document.getElementById('inq-test-trigger') }));
  await waitOpen();
  t.eq([await title(), await step(), await page.evaluate(() => document.documentElement.lang)], ['Preguntar por este movimiento', 'review', 'es'], 'resume() reopens it in Spanish, same step');
  const esRv = await dialogText();
  t.assert(esRv.includes('El importe no parece correcto') && esRv.includes('Correo electrónico registrado') && esRv.includes('Please check it.'), 'answers kept (the customer’s own words unchanged)');
  t.assert(!/Ask about this transaction|The amount looks wrong|Email on file/.test(esRv), 'no English left in the reopened dialog');
  await expectFocus('inq-title', 'focus on the dialog title');
  t.eq(await liveText(), '', 'no language-change message carried into the reopened dialog');
  await noLangSwitch('resumed in Spanish');
  await close();
  await headerLang('en');
  await openWith(TX);
  t.eq([await title(), await step()], ['Ask about this transaction', 'review'], 'English again after switching back in the masthead, same step');
  await page.focus('[data-fk="inq-edit-reason"]');

  /* ------------------------------------------------------------------ */
  t.step('review shows every entry with edit links and the demo note');
  await expectFocus('inq-edit-reason', 'focus on Change reason');
  const rv = await dialogText();
  t.assert(rv.includes('Demo only — nothing will be sent'), 'review demo note');
  t.assert(rv.includes('The amount looks wrong'), 'reason shown');
  t.assert(rv.includes('The amount is higher than I expected.') && rv.includes('Please check it.'), 'description shown');
  t.assert(rv.includes('Email on file'), 'channel shown');
  t.assert(rv.includes('REF-N8C4-2VB9') && rv.includes('−200.00 USBC'), 'transaction shown');
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
  await noLangSwitch('review step');
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
  t.assert(done.includes('recognized as a duplicate'), 'production: duplicate prevention');
  t.assert(!/recognis|colour/.test(done), 'US spelling on the confirmation too');
  t.assert(done.includes('redacted from analytics'), 'production: sensitive fields redacted from analytics');
  t.assert(done.includes('formal dispute or a fraud report') && done.includes('approved policy and timing copy'), 'inquiry vs dispute/fraud with placeholder');
  t.assert(done.includes('The amount looks wrong') && done.includes('Email on file'), 'what was entered is summarised');
  await page.waitForFunction(() => document.querySelector('#inquiry-dialog [data-inq-live-a]').textContent.includes('Demo only — no inquiry was sent'), null, { timeout: 2000 }).catch(() => {});
  t.assert((await page.evaluate(() => document.querySelector('#inquiry-dialog [data-inq-live-a]').textContent)).includes(ref), 'confirmation announced assertively inside the dialog');
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
  await noLangSwitch('confirmation');
  t.eq(await closeClear(), { ringRoom: true, onTop: true, size: true }, 'Close on the confirmation: uncovered, 44px, focus ring inside');
  await seriousAxe('confirmation');
  await shot('done');

  t.step('dark theme: the confirmation');
  // The visitor's choice (YES.theme, <html data-theme="dark">) and the device setting reach the same tokens.
  const dlgColors = () =>
    page.evaluate(() => {
      const cs = (s) => getComputedStyle(document.querySelector(s));
      return { bg: cs('#inquiry-dialog').backgroundColor, ink: cs('#inquiry-dialog-title').color, receipt: cs('#inquiry-dialog .inq-receipt').backgroundColor };
    });
  await page.evaluate(() => YES.theme.set('light'));
  const lightColors = await dlgColors();
  await page.evaluate(() => YES.theme.set('dark'));
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  t.assert(await isOpen(), 'a theme change leaves the dialog open');
  t.eq([await step(), await activeFk()], ['done', 'inq-title'], 'same step, focus kept');
  const darkColors = await dlgColors();
  t.assert(darkColors.bg !== lightColors.bg && darkColors.ink !== lightColors.ink && darkColors.receipt !== lightColors.receipt, 'dialog, title and receipt take the dark tokens: ' + JSON.stringify([lightColors, darkColors]));
  await seriousAxe('confirmation, dark');
  await shot('dark-done');
  await page.evaluate(() => document.querySelector('#inquiry-dialog .inq-body').scrollTo(0, 99999));
  await shot('dark-done-bottom');
  await page.evaluate(() => document.querySelector('#inquiry-dialog .inq-body').scrollTo(0, 0));
  await page.evaluate(() => YES.theme.set(null)); // follow the device again
  t.eq(await page.evaluate(() => YES.theme.effective() === YES.theme.device()), true, 'back to the device setting');

  t.step('a language change while the confirmation is open keeps it');
  await page.focus('[data-fk="inq-done"]');
  await page.evaluate(() => YES.setLang('es'));
  t.eq([await title(), await step(), (await text('[data-inq-ref]')).trim()], ['Solo demostración: no se envió ninguna consulta', 'done', ref], 'Spanish confirmation, same fictional reference');
  t.assert((await dialogText()).includes('se reconocería como duplicada'), 'Spanish production notes');
  await expectFocus('inq-done', 'focus kept on Done');
  await noLangSwitch('Spanish confirmation');
  await shot('es-done');
  await page.evaluate(() => YES.setLang('en'));
  t.eq(await title(), 'Demo only — no inquiry was sent', 'English confirmation again');
  await page.waitForFunction(() => /Language changed to English/.test(Array.from(document.querySelectorAll('#inquiry-dialog > [aria-live]'), (r) => r.textContent).join('|')), null, { timeout: 2000 }).catch(() => {});
  t.eq(await liveText(), 'Language changed to English', 'only the latest language change is announced (the Spanish one is gone)');

  /* ------------------------------------------------------------------ */
  t.step('after submission: duplicate-prevention demo');
  await page.click('[data-fk="inq-done"]');
  await waitClosed();
  await expectFocus('inq-test-trigger', 'focus returns to the trigger');
  t.eq(await liveText(), '', 'closing empties the dialog’s live regions');
  t.eq(await page.locator('#inquiry-dialog [data-lang], #inquiry-dialog button').count(), 0, 'no stale controls or old-language text left in the closed dialog');
  // In Spanish, a new inquiry about another transaction carries nothing of the English confirmation.
  await page.evaluate(() => YES.setLang('es'));
  await openWith(PENDING);
  const fresh = await page.evaluate(() => document.getElementById('inquiry-dialog').textContent);
  t.assert(!fresh.includes('Demo only — no inquiry was sent') && !fresh.includes(ref), 'no English confirmation or earlier reference left in the dialog');
  t.assert(fresh.includes('Canje solicitado') && !fresh.includes('Canjeado'), 'a pending redemption is “Canje solicitado”, never “Canjeado”');
  t.eq(await liveText(), '', 'live regions empty on a new inquiry');
  await close();
  await page.evaluate(() => YES.setLang('en'));
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
  // Status-aware type label (ui.typeLabel(tx)): nothing completed-sounding for a request still pending.
  t.assert(p.includes('Redemption requested') && !p.includes('Redeemed'), 'a pending redemption reads “Redemption requested”, never “Redeemed”');
  // Masked identifiers: bullets shown, "ending in 4821" heard.
  t.eq(
    await page.evaluate(() => {
      const dd = Array.from(document.querySelectorAll('#inquiry-dialog .inq-kv dt')).find((dt) => dt.textContent === 'Counterparty').nextElementSibling;
      const heard = dd.cloneNode(true);
      heard.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
      return [dd.innerText.replace(/\s+/g, ' ').includes('Linked bank account •••• 4821'), heard.textContent.replace(/\s+/g, ' ').trim()];
    }),
    [true, 'Linked bank account ending in 4821'],
    'masked counterparty: bullets visible, “ending in 4821” for assistive technology'
  );
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
  await page.click('label[for="inq-reason-unrecognized"]');
  await page.click('[data-inq-backtx]');
  await waitClosed();
  t.eq(await page.evaluate(() => window.__openTx), [{ id: TX2, trigger: 'inq-test-trigger' }], 'YES.explorer.openTx(txId, { trigger })');
  const d4 = await draft(TX2);
  t.eq([d4 && d4.status, d4 && d4.step, d4 && d4.reason], ['draft', 'details', 'unrecognized'], 'draft kept');
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
  t.assert(await page.isChecked('#inq-reason-unrecognized'), 'with its answers');
  await close();

  /* ------------------------------------------------------------------ */
  t.step('hand-off from the transaction detail');
  // The detail is closed through the explorer's API (never by reaching into its dialog).
  await page.evaluate(() => {
    window.__closeTx = [];
    const orig = YES.explorer.closeTx;
    YES.explorer.closeTx = function (o) {
      window.__closeTx.push(o || null);
      return orig.apply(this, arguments);
    };
  });
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
  if (!realExplorer) t.eq(await page.evaluate(() => window.__closeTx), [{ how: 'back' }], 'closed with YES.explorer.closeTx, like a customer close');
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
    // Back to transaction and Close share one row in both languages, Close clear of the sheet's edges.
    const headRow = () =>
      page.evaluate(() => {
        const box = (s) => document.querySelector('#inquiry-dialog ' + s).getBoundingClientRect();
        const back = box('.inq-head__back');
        const cls = box('.inq-head__close');
        const mid = (r) => r.top + r.height / 2;
        return {
          oneRow: Math.abs(mid(back) - mid(cls)) <= 4,
          apart: back.right <= cls.left,
          inside: cls.right <= window.innerWidth - 5 && cls.top >= 5
        };
      });
    t.eq(await headRow(), { oneRow: true, apart: true, inside: true }, 'header row fits at 320px (English)');
    t.eq(await closeClear(), { ringRoom: true, onTop: true, size: true }, 'Close at 320px: uncovered, 44px, focus ring inside');
    // Spanish at 320px, through the phone Menu: close (draft kept), switch, resume.
    await close();
    await headerLang('es');
    await page.evaluate(() => YES.inquiry.resume({ trigger: document.getElementById('inq-test-trigger') }));
    await waitOpen();
    t.eq([await title(), await step()], ['Preguntar por este movimiento', 'review'], 'resumed in Spanish at 320px, same step');
    t.eq(await headRow(), { oneRow: true, apart: true, inside: true }, 'header row fits at 320px (Spanish)');
    t.eq(await noHScroll(), { page: true, dialog: true, body: true }, 'no horizontal scroll at 320px in Spanish');
    await noLangSwitch('320px, Spanish');
    await page.evaluate(() => document.querySelector('#inquiry-dialog .inq-body').scrollTo(0, 0));
    await shot('narrow-es-review');
    // Very large text: Back wraps next to its arrow, or Close takes a row of its own, rather than running off the screen.
    await page.evaluate(() => {
      const s = document.createElement('style');
      s.id = 'inq-test-bigtext';
      s.textContent = 'html { font-size: 200% !important; }';
      document.head.appendChild(s);
    });
    t.eq(
      await page.evaluate(() => {
        const bar = document.querySelector('#inquiry-dialog .inq-head__bar');
        const back = document.querySelector('#inquiry-dialog .inq-head__back').getBoundingClientRect();
        const cls = document.querySelector('#inquiry-dialog .inq-head__close').getBoundingClientRect();
        const tag = document.querySelector('#inquiry-dialog .inq-head .tag--illustrative').getBoundingClientRect();
        return {
          fits: bar.scrollWidth <= bar.clientWidth + 1 && back.right <= window.innerWidth && cls.right <= window.innerWidth,
          apart: back.right <= cls.left || cls.top >= back.bottom - 1,
          tagInside: tag.right <= window.innerWidth
        };
      }),
      { fits: true, apart: true, tagInside: true },
      '200% text at 320px: header controls and the demo tag stay on screen without overlapping'
    );
    await shot('narrow-es-bigtext');
    await page.evaluate(() => document.getElementById('inq-test-bigtext').remove());
    await close();
    await headerLang('en');
    await openWith(TX2);
    t.eq([await title(), await step()], ['Ask about this transaction', 'review'], 'English again at 320px, same step');
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
  await page.focus('#inq-reason-unrecognized');
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

  /* ------------------------------------------------------------------ */
  t.step('reasons follow the transaction');
  for (const [id, want, label] of [
    [PENDING, ['unrecognized', 'amount', 'pending', 'other'], 'a pending transaction without fees'],
    [FEE, ['unrecognized', 'amount', 'fee', 'other'], 'a fee line'],
    [TX2, ['unrecognized', 'amount', 'other'], 'a posted transaction without fees']
  ]) {
    await openWith(id);
    if ((await step()) === 'done') await page.click('[data-inq-new]'); // already completed: start a new demo inquiry
    const at = await step();
    if (at === 'transaction') await page.click('[data-inq-next]');
    else if (at === 'review') await page.click('[data-inq-edit="reason"]');
    t.eq(await step(), 'details', 'at Details for ' + label);
    t.eq(await reasons(), want, 'reasons for ' + label);
    await close();
  }
  // A saved answer this transaction does not offer (state written from elsewhere) is dropped and re-asked.
  await page.evaluate((id) => {
    const s = YES.state.inquiry || {};
    const others = Object.assign({}, s.others || {});
    if (s.txId) {
      const cur = Object.assign({}, s);
      delete cur.others;
      others[s.txId] = cur;
    }
    others[id] = { txId: id, step: 'review', reason: 'pending', channel: 'email', description: '', status: 'draft', seq: 999 };
    YES.set({ inquiry: { txId: null, others } });
  }, TX2);
  await openWith(TX2);
  t.eq(await step(), 'details', 'back to Details instead of reviewing an answer that is not offered');
  t.eq(await page.locator('#inquiry-dialog input[name="inq-reason"]:checked').count(), 0, 'no reason selected');
  t.assert(await page.isChecked('#inq-channel-email'), 'valid answers kept');
  t.eq([(await draft(TX2)).reason, (await draft(TX2)).step], ['', 'details'], 'draft re-validated');
  await page.click('[data-inq-next]');
  await expectFocus('inq-errors', 'the missing reason is asked for');
  t.eq(await page.$$eval('#inquiry-dialog .inq-errors a', (as) => as.map((a) => a.getAttribute('data-inq-errlink'))), ['reason'], 'only the reason');
  await close();

  /* ------------------------------------------------------------------ */
  t.step('dark theme: welcome-back notice, pending transaction, errors and review');
  await page.evaluate(() => YES.theme.set('dark'));
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  await openWith(PENDING); // its draft was left at Details above
  t.eq(await step(), 'details', 'resumed at Details');
  t.assert(await page.locator('[data-inq-notice="resumed"]').isVisible(), 'welcome-back notice');
  await seriousAxe('resumed notice, dark');
  await shot('dark-resumed');
  await page.click('[data-inq-discard]');
  t.eq(await step(), 'transaction', 'started over');
  await seriousAxe('pending transaction, dark');
  await shot('dark-step1-pending');
  await page.click('[data-inq-next]');
  await page.click('[data-inq-next]');
  await expectFocus('inq-errors', 'error summary');
  await seriousAxe('errors, dark');
  await shot('dark-errors');
  await page.click('label[for="inq-reason-pending"]');
  await page.click('label[for="inq-channel-in_app"]');
  await page.fill('#inq-desc', 'Still waiting for this one.');
  await page.click('[data-inq-next]');
  t.eq(await step(), 'review', 'at Review');
  await seriousAxe('review, dark');
  await shot('dark-review');
  await noLangSwitch('dark review');
  await close();
  await page.evaluate(() => YES.theme.set(null));
  t.eq(await page.evaluate(() => YES.i18n.audit()), {}, 'i18n parity');
}
