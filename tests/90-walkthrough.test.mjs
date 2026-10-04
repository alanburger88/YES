// PRD §8 showcase walkthrough, end to end, driven through the real UI, plus the
// §9 Phase A acceptance rows that the walkthrough touches (single-file offline
// operation, trust in numbers, discoverability, explanation, inquiry,
// localization with context preserved, accessibility, claims).
//
// Only clicks, taps and keys change the page. page.evaluate is used to READ
// state (YES.state, YES.data, YES.integrity) and to instrument the browser
// (window.print is replaced by a counter so no system dialog opens). On phones
// the sections, the language switch and the theme are reached through the
// masthead's Menu, exactly as a visitor would.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export const meta = { name: 'walkthrough', viewports: ['desktop', 'mobile'] };

const CLOSING = '1,147.50';
const NORTHSIDE = 'TX-260924-1327';
const TRANSFERS_OUT = ['TX-260903-1127', 'TX-260909-2051', 'TX-260918-2011', 'TX-260924-1327', 'TX-260929-1952'];
const PENDING = 'TX-260930-2247';
const BAD = ['serious', 'critical'];

// Amounts use a no-break space before the unit; compare with plain spaces.
const nb = (s) => String(s).replace(/\u00a0/g, ' ');

export default async function (t) {
  const { page } = t;
  const mobile = t.viewport !== 'desktop';

  /* ------------------------------------------------------------ helpers */
  const text = async (sel) => nb(await page.locator(sel).first().innerText());
  const state = (fn, arg) => page.evaluate(fn, arg);
  const dialogOpen = (id) => state((i) => document.getElementById(i).open, id);
  const waitFor = (fn, arg, ms = 4000) => page.waitForFunction(fn, arg, { timeout: ms });
  const settle = async () => {
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));
    await page.waitForTimeout(120);
  };
  // A real page load (a hash-only goto would be a same-document navigation).
  const fresh = async (hash = '') => {
    await page.goto('about:blank');
    await t.goto(hash);
  };
  const axeDoc = async (label) => {
    // Start at the top so the sticky masthead does not overlap what is measured.
    await page.evaluate(() => window.scrollTo(0, 0));
    const v = await t.axe();
    const bad = v.filter((x) => BAD.includes(x.impact)).map((x) => `${x.id}/${x.impact}: ${x.nodes.join(' ; ')}`);
    t.eq(bad, [], `axe serious/critical on the whole document (${label})`);
  };
  // Phones: the sections, Download or print, language and theme live in the Menu.
  const openMenu = async () => {
    if (!mobile) return;
    if ((await page.getAttribute('#masthead [data-mast-menu]', 'aria-expanded')) !== 'true') await page.click('#masthead [data-mast-menu]');
    await page.locator('#mast-menu').waitFor({ state: 'visible' });
  };
  const closeMenu = async () => {
    if (mobile && (await page.getAttribute('#masthead [data-mast-menu]', 'aria-expanded')) === 'true') await page.keyboard.press('Escape');
  };
  const go = async (view) => {
    await openMenu();
    await page.click(mobile ? `#mast-menu [data-nav="${view}"]` : `.nav__link[data-nav="${view}"]`);
    await waitFor((v) => YES.state.view === v, view);
  };
  // The language switch must be operable by its accessible name (screen readers,
  // voice control). Assert that, then press the control a sighted user sees so
  // the rest of the walkthrough still runs if the name is missing. The masthead
  // (the phone Menu) is the only language switch in the statement.
  const switchLang = async (lang, name) => {
    await openMenu();
    const byRole = page.getByRole('button', { name, exact: true });
    t.eq(await byRole.count(), 1, `language button exposes the accessible name "${name}"`);
    if ((await byRole.count()) === 1) await byRole.click();
    else await page.click(`${mobile ? '#mast-menu' : '#masthead'} [data-lang="${lang}"]`);
    await waitFor((l) => document.documentElement.lang === l && YES.i18n.lang === l, lang);
    await closeMenu();
    await settle();
  };
  const closeAssistantIfModal = async () => {
    // Under 1100px the drawer is modal (a full-screen sheet on phones), so the
    // masthead behind it is inert: close it with its own visible button first.
    const docked = await state(() => document.documentElement.classList.contains('assistant-docked'));
    if (!docked && (await state(() => !!(YES.state.assistant && YES.state.assistant.open)))) {
      await page.click('#assistant-root [data-asst-close]');
      await waitFor(() => !YES.state.assistant.open);
    }
  };

  /* ================================================================== */
  t.step('1. open the statement (single file, offline)');
  t.assert(await state(() => YES.integrity && YES.integrity.ok === true), 'statement reconciles (release gate passed)');
  t.assert(await page.locator('.demo-badge').first().isVisible(), '"Illustrative demo data" badge visible');
  t.eq((await text('.demo-badge')).trim(), 'Illustrative demo data', 'demo badge wording');
  t.assert(await page.locator('#h-overview').isVisible(), 'Overview heading visible on the first screen');
  t.eq(await state(() => YES.state.view), 'overview', 'first screen is Overview');
  t.eq(await page.locator('script[src], link[rel="stylesheet"], img[src^="http"], iframe').count() - (await page.locator('script[src*="userway"]').count()), 0, 'no external script/style/image/frame besides the UserWay loader');

  t.step('2. understand the closing balance');
  t.eq((await text('.ov-hero__num')).trim(), CLOSING, 'hero shows the closing balance 1,147.50');
  t.assert((await text('#ov-balance-title')).includes('Statement balance'), 'hero is labelled "Statement balance"');
  t.assert((await text('.ov-hero__sym')).includes('EXUSD'), 'hero names the asset');
  t.assert((await text('.ov-asof')).includes('As of Sep 30, 2026'), 'statement as-of time shown');
  const hero = await page.locator('.ov-hero__num').boundingBox();
  t.assert(hero && hero.y + hero.height <= (mobile ? 844 : 900), 'closing balance is above the fold on load');
  const ledger = await state(() => {
    const d = YES.data;
    const posted = d.transactions.filter((x) => x.status === 'posted');
    const byCat = {};
    d.categories.forEach((c) => {
      byCat[c.id] = posted.filter((x) => c.types.includes(x.type)).reduce((s, x) => s + x.amount, 0);
    });
    let bal = d.statement.opening;
    const running = posted
      .slice()
      .sort((a, b) => (a.postedAt < b.postedAt ? -1 : a.postedAt > b.postedAt ? 1 : a.seq - b.seq))
      .map((x) => {
        bal += x.amount;
        return { id: x.id, bal, after: x.balanceAfter };
      });
    return { opening: d.statement.opening, closing: d.statement.closing, net: posted.reduce((s, x) => s + x.amount, 0), byCat, running, n: d.transactions.length };
  });
  t.eq(ledger.opening + ledger.net, ledger.closing, 'ledger: opening + signed posted movements = closing');
  t.eq(ledger.closing, 114750, 'ledger closing is 1,147.50');
  t.eq(ledger.n, 16, '16 transactions in the statement');
  t.assert(ledger.running.every((r) => r.bal === r.after), 'every balance-after reconciles in posted order');

  t.step('2b. every shown total and chart value reconciles to the ledger');
  const steps = await page.$$eval('.jr [data-step]', (els) => els.map((e) => [e.getAttribute('data-step'), +e.getAttribute('data-value')]));
  const stepVal = Object.fromEntries(steps);
  t.eq(stepVal.opening, ledger.opening, 'journey opening = statement opening');
  t.eq(stepVal.closing, ledger.closing, 'journey closing = statement closing');
  for (const c of Object.keys(ledger.byCat)) t.eq(stepVal[c], ledger.byCat[c], `journey step ${c} = sum of its posted transactions`);
  const groups = Object.fromEntries(await page.$$eval('.jr [data-group]', (els) => els.map((e) => [e.getAttribute('data-group'), +e.getAttribute('data-value')])));
  t.eq(groups.incoming, ledger.byCat.deposits + ledger.byCat.transfers_in, 'incoming group = deposits + incoming transfers');
  t.eq(groups.outgoing, ledger.byCat.transfers_out + ledger.byCat.redemptions + ledger.byCat.fees, 'outgoing group = transfers out + redemptions + fees');
  await page.click('[data-fk="ov-ctable"]');
  const chartRows = await page.$$eval('.ov-ctable tbody tr', (rows) => rows.map((r) => r.lastElementChild.textContent.trim()));
  const expectRows = [ledger.opening, ...ledger.running.map((r) => r.bal)].map((m) => (m / 100).toFixed(2));
  t.eq(
    chartRows.map((s) => s.replace(/[^\d.]/g, '')),
    expectRows,
    'running-balance chart table = opening + running balance after each posted transaction'
  );
  await page.click('[data-fk="ov-ctable"]');
  // No conflicting balance labels anywhere in the statement (labels, not prose:
  // the Understand page may explain what a live "current balance" would be).
  const labelClash = [];
  for (const v of ['overview', 'transactions', 'understand', 'help']) {
    const labels = await state(
      (id) =>
        [...document.getElementById('view-' + id).querySelectorAll('h1,h2,h3,h4,dt,th,caption,legend,summary,label,[class*="label"],[class*="title"]')]
          .map((e) => e.textContent.trim())
          .filter((s) => s.length < 80),
      v
    );
    const m = labels.filter((s) => /\b(total balance|available balance|current balance|ending balance|account balance)\b/i.test(s));
    if (m.length) labelClash.push(v + ': ' + m.join(', '));
  }
  t.eq(labelClash, [], 'no competing balance labels (only statement/opening/closing balance and balance after)');

  t.step('2c. first screen has no serious accessibility violations');
  await axeDoc('first screen');

  /* ================================================================== */
  t.step('3. select Outgoing transfers in the balance journey');
  const stepBtn = page.locator('[data-fk="ov-step-transfers_out"]');
  t.eq(await stepBtn.getAttribute('aria-pressed'), 'false', 'step starts unselected');
  await stepBtn.click();
  await waitFor(() => YES.state.journeyStep === 'transfers_out');
  await settle();
  t.eq(await stepBtn.getAttribute('aria-pressed'), 'true', 'step is pressed (state not shown by colour alone)');
  t.assert((await stepBtn.innerText()).includes('5 transactions'), 'step names its transaction count');

  t.step('4. see the 5 matching ledger rows');
  const panelIds = await page.$$eval('#ov-panel [data-ov-tx]', (els) => els.map((e) => e.getAttribute('data-ov-tx')));
  t.eq(panelIds, TRANSFERS_OUT, 'exactly the five outgoing transfers, in posted order');
  const panel = await text('#ov-panel');
  t.assert(panel.includes('Outgoing transfers') && panel.includes('5 transactions') && panel.includes('−450.00 EXUSD'), 'panel names the step, count and total');
  t.assert(panel.includes('Northside Market'), 'the Northside Market payment is one of the rows');
  t.assert(await page.locator(`#ov-panel [data-ov-tx="${NORTHSIDE}"]`).isVisible(), 'rows are visible');
  await waitFor(() => /Outgoing transfers selected: 5 transactions/.test(document.getElementById('live-polite').textContent));
  await t.shot('04-step-rows');

  /* ================================================================== */
  t.step('5. open one transaction');
  await page.click(`#ov-panel [data-ov-tx="${NORTHSIDE}"]`);
  await waitFor(() => document.getElementById('tx-dialog').open);
  t.eq(await state(() => YES.state.selectedTx), NORTHSIDE, 'selected transaction in state');
  t.eq((await text('#tx-dialog-title')).trim(), 'Payment to a YES merchant', 'detail title');
  const detail = await text('#tx-dialog');
  for (const s of ['−45.50 EXUSD', 'Northside Market', 'REF-M8Q2-4DK9', 'TX-260924-1327', 'Posted', '1,097.00 EXUSD', 'EDT']) t.assert(detail.includes(s), 'detail shows ' + s);
  t.assert(await page.locator('#tx-dialog [data-txd-close]').isVisible(), 'visible close control');

  t.step('5b. dialogs keep the language chosen in the header (the only switch); the selection survives a switch');
  // The masthead is the one language switch. A dialog keeps the language that
  // was chosen before it opened: to change it the visitor closes the dialog,
  // switches in the header, and the same transaction is still selected.
  t.eq(await page.locator('#tx-dialog [data-lang]').count(), 0, 'the transaction detail has no language switch of its own');
  await page.click('#tx-dialog [data-txd-close]');
  await waitFor(() => !document.getElementById('tx-dialog').open);
  await switchLang('es', 'Español');
  t.eq(await state(() => YES.state.journeyStep), 'transfers_out', 'the selected step is kept after switching');
  await page.click(`#ov-panel [data-ov-tx="${NORTHSIDE}"]`);
  await waitFor(() => document.getElementById('tx-dialog').open);
  t.eq(await state(() => YES.state.selectedTx), NORTHSIDE, 'same transaction reopened');
  t.assert(nb(await text('#tx-dialog')).includes('−45,50 EXUSD'), 'detail in Spanish, the language chosen in the header');
  t.eq(await page.locator('#tx-dialog [data-lang]').count(), 0, 'still no language switch in the dialog');
  await page.click('#tx-dialog [data-txd-close]');
  await waitFor(() => !document.getElementById('tx-dialog').open);
  await switchLang('en', 'English');
  await page.click(`#ov-panel [data-ov-tx="${NORTHSIDE}"]`);
  await waitFor((id) => document.getElementById('tx-dialog').open && YES.state.selectedTx === id, NORTHSIDE);
  t.eq((await text('#tx-dialog-title')).trim(), 'Payment to a YES merchant', 'back in English');

  /* ================================================================== */
  t.step('6. Explain with AI');
  await page.click('#tx-dialog [data-fk="txd-explain"]');
  await waitFor(() => YES.state.assistant && YES.state.assistant.open && document.querySelector('#assistant-root .asst-ans'));
  await settle();
  t.assert(!(await dialogOpen('tx-dialog')), 'detail hands over to the assistant');
  t.assert(await page.locator('#assistant-root').getByText('Demo explanation').first().isVisible(), '"Demo explanation" label visible');
  const ctxChip = await text('#assistant-root [data-asst-ctx]');
  t.assert(ctxChip.includes('Payment to a YES merchant') && ctxChip.includes('−45.50 EXUSD'), 'context chip names the selected fact: ' + ctxChip);
  const answer = await text('#assistant-root .asst-ans');
  t.assert(answer.includes('Payment to a YES merchant'), 'answer names the selected transaction');
  t.assert(answer.includes('1,142.50 EXUSD') && answer.includes('1,097.00 EXUSD'), 'answer states the balance before and after from the ledger');
  t.assert(answer.includes('REF-M8Q2-4DK9') && answer.includes('Northside Market'), 'answer shows the figures used');
  const supporting = await page.$$eval('#assistant-root .asst-ans [data-asst-tx]', (els) => els.map((e) => e.getAttribute('data-asst-tx')));
  t.eq(supporting, [NORTHSIDE], 'answer points to the exact supporting row');
  t.assert(await page.locator('#assistant-root .asst-ans [data-asst-rows]').isVisible(), '"Show these rows in Transactions" offered');
  t.assert(await page.locator('#assistant-root [data-asst-talk]').first().isVisible(), 'human-help route offered');
  t.eq(await page.locator('#assistant-root [data-lang]').count(), 0, 'the Ask YES drawer has no language switch of its own');
  if (!mobile) {
    const balanceCovered = await state(() => {
      const d = document.getElementById('assistant-drawer') || document.querySelector('#assistant-root [role="dialog"], #assistant-root dialog');
      const p = document.querySelector('#ov-panel');
      if (!d || !p) return null;
      const a = d.getBoundingClientRect();
      const b = p.getBoundingClientRect();
      return b.right > a.left + 1;
    });
    t.eq(balanceCovered, false, 'docked drawer does not cover the selected rows');
    const broken = await page.$$eval('.jr-step .jr-label > span:last-child', (els) =>
      els
        .filter((e) => {
          // A label that wraps inside a word renders more lines than it has words.
          const lh = parseFloat(getComputedStyle(e).lineHeight) || 16;
          const lines = Math.round(e.getBoundingClientRect().height / lh);
          return lines > e.textContent.trim().split(/\s+/).length;
        })
        .map((e) => e.textContent.trim())
    );
    t.eq(broken, [], 'journey step labels do not break inside words while the drawer is docked');
  }
  await axeDoc('assistant open');
  await t.shot('06-explain');

  /* ================================================================== */
  t.step('7. start a demo inquiry from the supporting row');
  await page.click(`#assistant-root .asst-ans [data-asst-tx="${NORTHSIDE}"]`);
  await waitFor(() => document.getElementById('tx-dialog').open);
  await page.click('#tx-dialog [data-txd-ask]');
  await waitFor(() => document.getElementById('inquiry-dialog').open);
  const inq1 = await text('#inquiry-dialog');
  t.assert(inq1.includes('REF-M8Q2-4DK9') && inq1.includes('Northside Market'), 'transaction reference carried into the inquiry');
  t.assert(inq1.includes('Demo only'), 'inquiry marked demo only');
  t.eq(await page.locator('#inquiry-dialog [data-lang]').count(), 0, 'the inquiry uses the language already chosen: no switch of its own');
  await page.click('#inquiry-dialog [data-inq-next]');
  await waitFor(() => YES.state.inquiry && YES.state.inquiry.step === 'details');

  t.step('7b. missing answers give an accessible error');
  await page.click('#inquiry-dialog [data-inq-next]');
  await waitFor(() => !!document.querySelector('#inquiry-dialog [data-fk="inq-errors"]'));
  const errs = page.locator('#inquiry-dialog [data-fk="inq-errors"]');
  // The summary takes focus and is named by its heading and described by the error
  // list (a focused role=alert would announce twice), and the count is announced.
  await waitFor(() => document.activeElement && document.activeElement.getAttribute('data-fk') === 'inq-errors');
  t.eq(await state(() => document.activeElement.getAttribute('data-fk')), 'inq-errors', 'focus moves to the error summary');
  t.assert(!!(await errs.getAttribute('aria-labelledby')) && !!(await errs.getAttribute('aria-describedby')), 'error summary is named and described');
  t.assert((await errs.innerText()).includes('Choose what your inquiry is about.'), 'reason error named');
  t.eq(await state(() => YES.state.inquiry.step), 'details', 'stays on the details step');

  t.step('7c. enter a reason, review, submit');
  await page.click('label[for="inq-reason-amount"]');
  await page.locator('#inquiry-dialog [data-inq-desc]').fill('I expected 45.00 for groceries.');
  await page.click('label[for="inq-channel-in_app"]');
  t.eq(await page.locator('#inquiry-dialog input[type="email"], #inquiry-dialog input[type="tel"]').count(), 0, 'no contact details requested');
  await page.click('#inquiry-dialog [data-inq-next]');
  await waitFor(() => YES.state.inquiry.step === 'review');
  const review = await text('#inquiry-dialog');
  t.assert(review.includes('The amount looks wrong') && review.includes('I expected 45.00 for groceries.') && review.includes('In-app message'), 'review repeats the answers');
  t.assert(review.includes('nothing will be sent'), 'review says nothing will be sent');
  await page.click('#inquiry-dialog [data-inq-submit]');
  await waitFor(() => YES.state.inquiry.status === 'submitted');

  t.step('8. unmistakable no-send confirmation');
  t.eq((await text('#inquiry-dialog-title')).trim(), 'Demo only — no inquiry was sent', 'confirmation heading is exact');
  const ref = await state(() => YES.state.inquiry.ref);
  t.assert(/^DEMO-INQ-[A-Z0-9]{4,}$/.test(ref || ''), 'fictional local reference: ' + ref);
  t.assert((await text('#inquiry-dialog')).includes('Fictional — not a case number'), 'reference marked fictional');
  await waitFor(() => [...document.querySelectorAll('#inquiry-dialog [aria-live], #live-polite, #live-assertive')].some((e) => /Demo only — no inquiry was sent/.test(e.textContent)));
  t.assert(t.external.every((u) => /cdn\.userway\.org/.test(u)), 'submitting made no network request');
  await t.shot('08-confirmation');
  await page.click('#inquiry-dialog [data-fk="inq-done"]');
  await waitFor(() => !document.getElementById('inquiry-dialog').open);

  /* ================================================================== */
  t.step('9. switch to Spanish without losing context');
  await closeAssistantIfModal();
  const before = await state(() => ({ view: YES.state.view, step: YES.state.journeyStep, filters: YES.state.filters, inquiry: YES.state.inquiry, thread: YES.state.assistant.thread.map((e) => e.id), open: YES.state.assistant.open }));
  await switchLang('es', 'Español');
  t.eq(await state(() => YES.state.view), before.view, 'same section');
  t.eq(await state(() => YES.state.journeyStep), 'transfers_out', 'same journey step selected');
  t.eq(await state(() => YES.state.filters), before.filters, 'same filters');
  t.eq(await state(() => YES.state.inquiry), before.inquiry, 'inquiry (submitted, same reference) kept');
  t.eq(await state(() => YES.state.assistant.thread.map((e) => e.id)), before.thread, 'explanation thread kept');
  t.eq(await page.$$eval('#ov-panel [data-ov-tx]', (els) => els.map((e) => e.getAttribute('data-ov-tx'))), TRANSFERS_OUT, 'same five rows listed');
  const esPanel = await text('#ov-panel');
  t.assert(esPanel.includes('Transferencias enviadas') && esPanel.includes('−450,00 EXUSD'), 'rows re-rendered in Spanish with Spanish number format');
  t.eq((await text('#h-overview')).trim(), 'Tu estado de cuenta de septiembre de 2026', 'Spanish heading');
  if (!before.open || mobile) {
    await page.click('[data-fk="ask-yes"]');
    await waitFor(() => YES.state.assistant.open && document.querySelector('#assistant-root .asst-ans'));
  }
  const esAnswer = await text('#assistant-root .asst-ans');
  t.assert(esAnswer.includes('Pago a un comercio de YES') && esAnswer.includes('1.097,00 EXUSD'), 'explanation re-rendered in Spanish');
  t.assert((await text('#assistant-root')).includes('Explicación de demostración'), 'Spanish demo label');
  await axeDoc('Spanish, assistant open');
  await t.shot('09-spanish');
  await closeAssistantIfModal();
  // Reopen the transaction: the completed inquiry is remembered in Spanish.
  await page.click(`#ov-panel [data-ov-tx="${NORTHSIDE}"]`);
  await waitFor(() => document.getElementById('tx-dialog').open);
  const esDetail = await text('#tx-dialog');
  t.assert(esDetail.includes(ref) && esDetail.includes('no se envió ninguna consulta'), 'detail remembers the demo inquiry, in Spanish');
  await page.click('#tx-dialog [data-txd-close]');
  await waitFor(() => !document.getElementById('tx-dialog').open);
  t.eq(await state(() => YES.i18n.audit()), {}, 'every string exists in both languages');

  /* ================================================================== */
  t.step('10. inspect the illustrative transparency panel');
  await closeAssistantIfModal();
  await go('understand');
  await page.click('#understand-root a[href="#/understand/transparency"]');
  const tp = page.locator('#und-transparency');
  await tp.waitFor({ state: 'visible' });
  t.assert((await tp.innerText()).includes('Diseño ilustrativo; sin afirmación sobre reservas'), 'Spanish transparency label');
  await switchLang('en', 'English');
  t.eq(await state(() => YES.state.view), 'understand', 'section kept when switching back to English');
  const tpText = nb(await tp.innerText());
  t.assert(tpText.includes('Illustrative layout; no reserve assertion'), 'exact "Illustrative layout; no reserve assertion"');
  t.assert(tpText.includes('Illustrative'), 'panel carries an Illustrative tag');
  t.eq(await page.locator('#und-transparency a[href^="http"], #und-onchain a[href^="http"]').count(), 0, 'no external explorer, report or attestation link');
  t.assert((await text('#und-onchain')).includes('Illustrative reference — no live blockchain verification'), 'on-chain sample labelled illustrative');
  await tp.scrollIntoViewIfNeeded();
  await t.shot('10-transparency');

  /* ================================================================== */
  t.step('11. Download or print: print the statement of record');
  await page.evaluate(() => {
    window.__printCalls = 0;
    window.print = () => {
      window.__printCalls++;
    };
  });
  // The header's "Download or print" leads to the record section in Help.
  await openMenu();
  const recBtn = page.getByRole('button', { name: 'Download or print', exact: true });
  t.eq(await recBtn.count(), 1, 'one "Download or print" button in the header' + (mobile ? ' menu' : ''));
  await recBtn.click();
  await waitFor(() => YES.state.view === 'help' && /#\/help\/record/.test(location.hash));
  const record = page.locator('#help-record');
  await record.waitFor({ state: 'visible' });
  await waitFor(() => document.activeElement && document.activeElement.id === 'help-record-title').catch(() => {});
  t.eq(await state(() => document.activeElement.id), 'help-record-title', 'focus on the "Download or print" section heading');
  t.eq((await text('#help-record-title')).trim(), 'Download or print', 'the section is called "Download or print"');
  await record.getByRole('button', { name: /^Print\b/ }).first().click();
  t.eq(await state(() => window.__printCalls), 1, 'Print opens the print dialog');
  await page.emulateMedia({ media: 'print' });
  t.assert(await page.locator('#print-root').isVisible(), 'statement-of-record view shows in print');
  t.assert(!(await page.locator('#app').isVisible()), 'interactive UI hidden in print');
  const pr = nb(await page.locator('#print-root').innerText());
  t.assert(pr.includes('Statement of record') && pr.includes('YES-STM-202609-000184'), 'record title and statement ID');
  t.assert(pr.includes('Closing balance') && pr.includes('1,147.50 EXUSD'), 'closing balance printed');
  t.assert(/ILLUSTRATIVE DEMO DATA/i.test(pr), 'demo watermark/label printed');
  t.eq(await page.locator('#print-root [data-print-tx]').count(), 15, 'all 15 posted transactions printed');
  t.eq(await page.locator(`#print-root [data-print-pending="${PENDING}"]`).count(), 1, 'pending item printed separately');
  await t.shot('11-print', { fullPage: true });
  await page.emulateMedia({ media: 'screen' });

  t.step('11b. Download or print: download the statement of record as a PDF');
  const pdfBtn = record.getByRole('button', { name: /PDF/ });
  t.eq(await pdfBtn.count(), 1, 'a "Download PDF" button next to Print');
  const [pdfDl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), pdfBtn.first().click()]);
  const pdfName = pdfDl.suggestedFilename();
  t.assert(/^YES-statement-.*202609-000184.*-DEMO\.pdf$/.test(pdfName), 'one-click download, named for the statement and marked DEMO: ' + pdfName);
  const pdfBytes = readFileSync(await pdfDl.path());
  t.eq(pdfBytes.subarray(0, 8).toString('latin1'), '%PDF-1.4', 'a real PDF file (generated in the page, offline)');
  const pdfFile = new URL(`../test-results/walkthrough-${t.viewport}.pdf`, import.meta.url);
  writeFileSync(pdfFile, pdfBytes);
  const info = spawnSync('pdfinfo', [pdfFile.pathname], { encoding: 'utf8' });
  t.eq([info.status, (info.stderr || '').trim()], [0, ''], 'pdfinfo: valid, no errors');
  const pages = +((info.stdout || '').match(/^Pages:\s+(\d+)/m) || [0, 0])[1];
  t.assert(pages >= 1, 'pdfinfo counts the pages: ' + pages);
  const marks = (pdfBytes.toString('latin1').match(/\(ILLUSTRATIVE DEMO DATA[^)]*\) Tj/g) || []).length;
  t.assert(marks >= pages, `every page carries the demo watermark (${marks} on ${pages} pages)`);
  t.assert(/^Title:\s+\S/m.test(info.stdout || ''), 'the PDF has a title');
  const pdfText = nb(spawnSync('pdftotext', ['-layout', '-enc', 'UTF-8', pdfFile.pathname, '-'], { encoding: 'utf8' }).stdout || '');
  t.assert(pdfText.includes('YES-STM-202609-000184') && pdfText.includes('1,147.50 EXUSD'), 'selectable text: statement ID and closing balance');
  const refs = await state(() => YES.data.transactions.map((x) => x.reference));
  t.eq(refs.filter((r) => !pdfText.includes(r)), [], 'every transaction reference is in the PDF (posted and not in balance)');
  t.eq(t.external.filter((u) => !/cdn\.userway\.org/.test(u)), [], 'making the PDF requested nothing from the network');

  t.step('12. export CSV (complete record and current view)');
  await go('transactions');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.click('[data-fk="tx-csv-all"]')]);
  t.eq(dl.suggestedFilename(), 'YES-STM-202609-000184_complete-record_DEMO.csv', 'complete-record file name');
  const csv = readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '');
  const lines = csv.trim().split('\r\n');
  const head = lines[0].split(',');
  const rows = lines.slice(1).map((l) => l.split(','));
  t.eq(rows.length, 16, 'complete CSV has 16 rows');
  const iAmt = head.indexOf('Amount');
  const iInc = head.indexOf('Included in statement balance');
  const iCls = head.indexOf('Data classification');
  const net = rows.filter((r) => r[iInc] === 'true').reduce((s, r) => s + Math.round(parseFloat(r[iAmt]) * 100), 0);
  t.eq(net, ledger.net, 'CSV posted amounts sum to the net change (+147.50)');
  t.assert(rows.every((r) => r[iCls] === 'ILLUSTRATIVE_DEMO_DATA'), 'every CSV row marked illustrative');
  t.assert(csv.includes(NORTHSIDE) && csv.includes('Northside Market'), 'Northside Market row exported');
  // Current view: apply the journey step through the UI, then export the view.
  await go('overview');
  await page.click('#ov-panel [data-ov-show]');
  await waitFor(() => YES.state.view === 'transactions' && YES.state.filters.step === 'transfers_out');
  t.eq(nb(await text('#tx-results-title')), 'Showing 5 of 16 transactions', 'filter reports its result count');
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.click('[data-fk="tx-csv-view"]')]);
  const csv2 = readFileSync(await dl2.path(), 'utf8').replace(/^﻿/, '');
  t.eq(csv2.trim().split('\r\n').length - 1, 5, 'current-view CSV has the 5 filtered rows');

  t.step('13. UserWay failure does not block anything');
  await waitFor(() => ['unavailable', 'loaded', 'host', 'disabled'].includes(YES.userway.status), null, 12000);
  t.eq(await state(() => YES.userway.status), 'unavailable', 'widget reported unavailable offline');
  t.assert(t.external.length <= 1, 'at most one external request attempted (UserWay)');

  t.step('13b. light/dark: the whole statement reads in dark, chosen in the header');
  await openMenu();
  const darkBtn = page.getByRole('button', { name: 'Dark mode', exact: true });
  t.eq(await darkBtn.count(), 1, 'one "Dark mode" toggle in the header' + (mobile ? ' menu' : ''));
  // A dark device (run.mjs --color-scheme dark) starts dark: choose light first,
  // so it is the header's toggle that turns the statement dark below.
  if ((await state(() => document.documentElement.getAttribute('data-theme'))) === 'dark') {
    await darkBtn.click();
    await waitFor(() => document.documentElement.getAttribute('data-theme') === 'light');
  }
  await darkBtn.click();
  await waitFor(() => document.documentElement.getAttribute('data-theme') === 'dark');
  t.eq(await darkBtn.getAttribute('aria-pressed'), 'true', 'the toggle is pressed');
  await closeMenu();
  for (const v of ['overview', 'transactions', 'understand', 'help']) {
    await go(v);
    await settle();
    await axeDoc('dark theme, ' + v);
    await t.shot('13-dark-' + v);
  }
  await openMenu();
  await darkBtn.click();
  await waitFor(() => document.documentElement.getAttribute('data-theme') === 'light');
  await closeMenu();

  /* ================================================================== */
  // §9 Discoverability: from the first screen, reach EVERY transaction in at most
  // three deliberate interactions. Two independent paths per transaction.
  const all = await state(() =>
    YES.data.transactions.map((x) => ({
      id: x.id,
      status: x.status,
      cat: x.status === 'posted' ? YES.data.categories.find((c) => c.types.includes(x.type)).id : null
    }))
  );
  for (const path of ['journey', 'explore']) {
    t.step(`14. discoverability via ${path}`);
    const misses = [];
    for (const x of all) {
      await fresh();
      let n = 0;
      const act = async (sel) => {
        n++;
        await page.click(sel);
      };
      if (path === 'journey') {
        if (x.status !== 'posted') await act('[data-fk="ov-notin-view"]');
        else {
          await act(`[data-fk="ov-step-${x.cat}"]`);
          await page.locator(`#ov-panel [data-ov-tx="${x.id}"]`).waitFor({ state: 'visible', timeout: 3000 });
          await act(`#ov-panel [data-ov-tx="${x.id}"]`);
        }
      } else {
        await act('[data-ov-explore]');
        await page.locator(`[data-tx-row="${x.id}"]`).waitFor({ state: 'visible', timeout: 3000 });
        await act(`[data-tx-row="${x.id}"]`);
      }
      const ok = await waitFor(
        (id) => document.getElementById('tx-dialog').open && YES.state.selectedTx === id,
        x.id,
        3000
      )
        .then(() => true)
        .catch(() => false);
      if (!ok || n > 3) misses.push(`${x.id} (${n} interactions, opened=${ok})`);
    }
    t.eq(misses, [], `every transaction reachable in ≤3 interactions via ${path}`);
  }

  /* ================================================================== */
  // Keyboard-only core path (desktop; touch devices use the tap path above).
  if (!mobile) {
    t.step('15. keyboard only: step → row → detail → back');
    await fresh();
    let tabs = 0;
    let fk = null;
    while (tabs < 40 && fk !== 'ov-step-transfers_out') {
      await page.keyboard.press('Tab');
      tabs++;
      fk = await state(() => document.activeElement && document.activeElement.getAttribute('data-fk'));
    }
    t.eq(fk, 'ov-step-transfers_out', 'Outgoing transfers step reachable with Tab');
    await page.keyboard.press('Enter');
    await waitFor(() => YES.state.journeyStep === 'transfers_out');
    tabs = 0;
    while (tabs < 10 && fk !== 'ov-tx-' + NORTHSIDE) {
      await page.keyboard.press('Tab');
      tabs++;
      fk = await state(() => document.activeElement && document.activeElement.getAttribute('data-fk'));
    }
    t.eq(fk, 'ov-tx-' + NORTHSIDE, 'panel row reachable with Tab');
    await page.keyboard.press('Enter');
    await waitFor(() => document.getElementById('tx-dialog').open);
    t.eq(await state(() => document.activeElement.id), 'tx-dialog-title', 'focus moves into the detail');
    await page.keyboard.press('Escape');
    await waitFor(() => !document.getElementById('tx-dialog').open);
    await waitFor((k) => document.activeElement && document.activeElement.getAttribute('data-fk') === k, 'ov-tx-' + NORTHSIDE).catch(() => {});
    t.eq(await state(() => document.activeElement.getAttribute('data-fk')), 'ov-tx-' + NORTHSIDE, 'Escape returns focus to the row');
  }
}
