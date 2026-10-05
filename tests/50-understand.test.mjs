// Understand view: content records (education/evidence), the seven-topic
// accordion (keyboard, state, statement-specific examples, Explain with AI,
// related transactions), YES.understand.openTopic + #/understand/<topic>
// routes, statement versus live balance, the sample on-chain reference, the
// illustrative reserve/transparency panel and its unavailable state, the
// governance rules, language switch, copy quality (no repeated words, EN + ES),
// accessibility (axe, touch targets), light and dark themes (the masthead
// toggle, or the phone Menu: dark chosen on a light device, light chosen on a
// dark device, following a dark device; every colour in the view follows the
// tokens; axe in each), mobile reflow and the desktop layout (no empty column
// in any state, docked-assistant widths).
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

export const meta = { name: 'understand', viewports: ['desktop', 'mobile'], hash: '#/understand' };

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-results', 'screens');
const TOPICS = {
  token_units: 'Token units',
  usd_equivalent: 'USD equivalent',
  onchain_vs_internal: 'On-chain versus internal transfers',
  tx_status: 'Transaction status',
  fees: 'Fees',
  redemption: 'Redemption',
  statement_vs_live: 'Statement balance versus live balance'
};
const IDS = Object.keys(TOPICS);
const OC_LABEL = 'Illustrative reference — no live blockchain verification';
const TP_LABEL = 'Illustrative layout; no reserve assertion';

export default async function (t) {
  const { page } = t;
  const mobile = t.viewport !== 'desktop';
  mkdirSync(SHOTS, { recursive: true });
  // Intl output uses no-break / narrow spaces; compare with plain spaces.
  const nbsp = (s) => String(s).replace(/[   ]/g, ' ');
  const text = (sel) => page.locator(sel).first().innerText().then(nbsp);
  const activeId = () => page.evaluate(() => document.activeElement && document.activeElement.id);
  const settle = async (ms = 350) => {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.waitForTimeout(ms);
  };
  const focusedIs = async (id, msg) => {
    await page.waitForFunction((x) => document.activeElement && document.activeElement.id === x, id, { timeout: 3000 }).catch(() => {});
    t.eq(await activeId(), id, msg);
  };
  // Element is visible, and its topic or panel is scrolled to just below the part
  // of the sticky masthead that stays pinned (scroll-padding from --masthead-h;
  // on phones the demo badge band scrolls away), not left further down.
  const inView = async (sel, msg) => {
    const ok = await page
      .waitForFunction(
        (s) => {
          const el = document.querySelector(s);
          if (!el) return false;
          const block = el.closest('.und-acc__item, .und-panel') || el;
          const mast = document.getElementById('masthead').getBoundingClientRect();
          const r = el.getBoundingClientRect();
          const b = block.getBoundingClientRect();
          return r.top >= mast.bottom - 1 && r.bottom <= window.innerHeight && b.top >= mast.bottom - 1 && b.top - Math.max(0, mast.bottom) <= 24;
        },
        sel,
        { timeout: 3000 }
      )
      .then(() => true)
      .catch(() => false);
    t.assert(ok, msg);
  };
  const expanded = (id) => page.getAttribute(`#und-btn-${id}`, 'aria-expanded');
  const panelVisible = (id) => page.locator(`#und-panel-${id}`).isVisible();
  const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  // Mobile emulation widens the layout viewport to fit overflowing content, so
  // measure every visible element against the device width instead.
  const overflowAt = (w) =>
    page.$$eval(
      '#understand-root *',
      (els, w) =>
        els
          .filter((e) => {
            const r = e.getBoundingClientRect();
            if (!r.width || e.closest('.sr-only') || e.closest('[hidden]')) return false;
            return r.right > w + 1 || r.left < -1;
          })
          .map((e) => (e.getAttribute('data-fk') || e.className || e.tagName) + '@' + Math.round(e.getBoundingClientRect().right))
          .slice(0, 8),
      w
    );
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
      YES.assistant.open = (ctx) => __calls.push({ fn: 'assistant', topic: ctx.topic, id: ctx.id, trigger: !!ctx.trigger });
      YES.explorer.applyFilter = (f, o) => __calls.push({ fn: 'filter', f, o });
      YES.explorer.openTx = (id, o) => __calls.push({ fn: 'openTx', id, trigger: !!(o && o.trigger) });
      YES.ui.copy = (txt) => __calls.push({ fn: 'copy', txt });
    });
  const calls = () => page.evaluate(() => window.__calls.splice(0));
  const setExpanded = (list) => page.evaluate((l) => YES.set({ understand: Object.assign({}, YES.state.understand, { expanded: l }) }), list);
  // Layout rows: basics and transparency span the layout; the two evidence panels
  // pair up (same top and bottom) or stack. `trailing` is the empty space left at
  // the end of the shorter paired card, the gap a reader would see beside the other.
  const layout = () =>
    page.evaluate(() => {
      const b = (s) => document.querySelector(s).getBoundingClientRect();
      const L = b('.und-layout');
      const live = b('#und-live');
      const oc = b('#und-onchain');
      const tp = b('#und-transparency');
      const trailing = (s) => {
        const c = document.querySelector(s);
        const end = Math.max(...[...c.children].map((k) => k.getBoundingClientRect().bottom));
        return Math.round(c.getBoundingClientRect().bottom - parseFloat(getComputedStyle(c).paddingBottom) - end);
      };
      const tpCols = getComputedStyle(document.querySelector('.und-tp__grid')).gridTemplateColumns.split(' ').map(parseFloat);
      return {
        root: document.getElementById('understand-root').clientWidth,
        basicsFull: Math.abs(b('#und-basics').width - L.width) < 2,
        tpFull: Math.abs(tp.width - L.width) < 2,
        paired: oc.left >= live.right && Math.abs(oc.top - live.top) < 2,
        sameBottom: Math.abs(oc.bottom - live.bottom) < 2,
        stacked: oc.top >= live.bottom && Math.abs(oc.left - live.left) < 2,
        pairW: Math.round(Math.min(live.width, oc.width)),
        tpBelow: tp.top >= Math.max(live.bottom, oc.bottom),
        trailing: Math.max(trailing('#und-live'), trailing('#und-onchain')),
        tpCols
      };
    });
  const checkLayout = async (label) => {
    const l = await layout();
    t.assert(l.basicsFull && l.tpFull, `${label}: basics and transparency span the layout`);
    t.assert(l.tpBelow, `${label}: transparency follows the evidence panels`);
    t.assert(l.paired !== l.stacked, `${label}: evidence panels are either paired or stacked`);
    if (l.paired) {
      t.assert(l.pairW >= 380, `${label}: paired panels get at least 380px (${l.pairW})`);
      t.assert(l.sameBottom, `${label}: paired panels end level`);
      t.assert(l.trailing < 160, `${label}: no large empty area beside the longer panel (${l.trailing}px)`);
    }
    t.assert(l.tpCols.length === 1 || Math.min(...l.tpCols) >= 340, `${label}: transparency columns stay readable (${l.tpCols.map(Math.round).join('/')})`);
    return l;
  };
  // Repeated words within a line ("cuenta cuenta"), across every visible string of the view.
  const doubled = () =>
    page.evaluate(() => [...document.getElementById('understand-root').innerText.matchAll(/(?<![\p{L}\p{N}-])(\p{L}{2,})[ \t\u00a0\u202f]+\1(?![\p{L}\p{N}-])/giu)].map((m) => m[0]));
  const shotEl = async (sel, label) => {
    const h = await page.addStyleTag({ content: '#masthead{visibility:hidden!important}' });
    await page.locator(sel).first().screenshot({ path: join(SHOTS, `understand-${t.viewport}-${label}.png`) });
    await h.evaluate((n) => n.remove());
  };
  // Light/dark. The computed colours of every element (and drawn pseudo-element)
  // in the view, read once transitions settle (buttons fade their colours on a
  // theme switch), with no hover or focus inside the view.
  const colours = async () => {
    await page.mouse.move(0, 0);
    return page.evaluate(async () => {
      if (document.activeElement && document.getElementById('understand-root').contains(document.activeElement)) document.activeElement.blur();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null)));
      const out = {};
      [...document.querySelectorAll('#understand-root, #understand-root *')].forEach((el, i) => {
        const name = i + ':' + (el.getAttribute('data-fk') || el.id || (typeof el.className === 'string' && el.className) || el.tagName);
        for (const pseudo of [null, '::before', '::after']) {
          const cs = getComputedStyle(el, pseudo);
          if (pseudo && (cs.content === 'none' || cs.content === 'normal')) continue;
          const v = { color: cs.color, background: cs.backgroundColor };
          for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
            if (parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== 'none') v[`border${side}`] = cs[`border${side}Color`];
          }
          if (cs.boxShadow !== 'none') v.shadow = cs.boxShadow;
          if (el instanceof SVGElement) Object.assign(v, { stroke: cs.stroke, fill: cs.fill });
          out[name + (pseudo || '')] = v;
        }
      });
      return out;
    });
  };
  const NO_COLOUR = /^(rgba\(0, 0, 0, 0\)|transparent|none)$/;
  // Colours that stayed the same from one theme to the other: a hard-coded colour would.
  const unchanged = (a, b) =>
    Object.keys(a).flatMap((k) =>
      Object.keys(a[k])
        .filter((p) => !NO_COLOUR.test(a[k][p]) && b[k] && a[k][p] === b[k][p])
        .map((p) => `${k} ${p}=${a[k][p]}`)
    );
  const differs = (a, b) =>
    Object.keys(a)
      .flatMap((k) =>
        Object.keys(a[k])
          .filter((p) => !b[k] || a[k][p] !== b[k][p])
          .map((p) => `${k} ${p}: ${a[k][p]} → ${b[k] && b[k][p]}`)
      )
      .slice(0, 8);
  // [choice, effective, <html data-theme>]
  const themeState = () => page.evaluate(() => [YES.theme.get(), YES.theme.effective(), document.documentElement.getAttribute('data-theme')]);
  // The visitor's control: the masthead toggle, or the Dark mode row in the phone Menu.
  const toggleTheme = async () => {
    if (mobile) {
      await page.click('#masthead [data-mast-menu]');
      await page.click('#mast-menu [data-fk="menu-theme"]');
      await page.keyboard.press('Escape');
    } else {
      await page.click('#masthead [data-fk="theme"]');
    }
  };

  /* ------------------------------------------------------------------ */
  t.step('view renders');
  await page.waitForSelector('#h-understand');
  t.assert(await page.locator('#view-understand').isVisible(), 'understand view visible');
  t.eq(await page.locator('#view-understand h1').count(), 1, 'exactly one h1 in the view');
  const h1 = page.locator('#h-understand');
  t.eq((await h1.innerText()).trim(), 'Understand your statement', 'h1 text');
  t.eq(await h1.getAttribute('class'), 'view-title', 'h1 class');
  t.eq(await h1.getAttribute('tabindex'), '-1', 'h1 tabindex');
  t.assert((await h1.getAttribute('data-view-heading')) !== null, 'h1 data-view-heading');
  t.assert((await text('.und-lede')).includes('September 2026'), 'lede names the statement period');
  t.eq(await page.evaluate(() => YES.i18n.audit()), {}, 'i18n parity');
  t.eq(await page.locator('.und-jump').getAttribute('aria-label'), 'On this page', 'in-page navigation is labelled');
  for (const s of ['und-basics', 'und-live', 'und-onchain', 'und-transparency']) {
    t.eq(await page.locator(`#${s}`).getAttribute('aria-labelledby'), `${s}-title`, `${s} labelled by its heading`);
    t.eq(await page.evaluate((x) => document.getElementById(x + '-title').tagName, s), 'H2', `${s} heading is h2`);
  }
  const httpLinks = await page.$$eval('#view-understand a[href^="http"], #view-understand [href^="//"], #view-understand [src^="http"]', (els) => els.length);
  t.eq(httpLinks, 0, 'no a[href^="http"] or external src in the view');
  t.eq(await page.$$eval('#understand-root a', (els) => els.filter((a) => !a.getAttribute('href').startsWith('#/understand')).length), 0, 'every link is a local Understand route');
  const missingFk = await page.$$eval('#understand-root button, #understand-root a, #understand-root summary', (els) =>
    els.filter((e) => !e.getAttribute('data-fk')).map((e) => e.outerHTML.slice(0, 80))
  );
  t.eq(missingFk, [], 'every interactive control has a data-fk');
  t.assert(await noHScroll(), 'no horizontal scroll');
  // Default (all collapsed) state: the reviewer saw a ~1,400px empty column here.
  const l0 = await checkLayout('default state');
  t.assert(mobile ? l0.stacked : l0.paired, mobile ? 'phone: evidence panels stack' : 'desktop: evidence panels sit side by side');
  await settle(200);
  await t.shot('top');

  /* ------------------------------------------------------------------ */
  t.step('content records follow the data contract');
  const contract = await page.evaluate(() => {
    const need = ['copyId', 'locales', 'source', 'date', 'responsibleEntity', 'validity', 'visibility', 'illustrative'];
    const check = (list) =>
      list
        .filter((r) => need.some((k) => r[k] === undefined || r[k] === null) || !r.validity.from || !r.validity.to || !(r.locales.includes('en') && r.locales.includes('es')))
        .map((r) => r.id);
    return {
      edu: YES.content.education.map((r) => r.id),
      eduBad: check(YES.content.education),
      evBad: check(YES.content.evidence),
      ev: YES.content.evidence.map((r) => r.id),
      source: YES.t(YES.content.education[0].source),
      owner: YES.t(YES.content.education[0].responsibleEntity),
      unique: new Set(YES.content.education.concat(YES.content.evidence).map((r) => r.copyId)).size === YES.content.education.length + YES.content.evidence.length,
      illustrative: YES.content.education.concat(YES.content.evidence).filter((r) => r.illustrative).length
    };
  });
  t.eq(contract.edu, IDS, 'one education record per topic, in order');
  t.eq(contract.eduBad, [], 'education records carry every required field');
  t.eq(contract.evBad, [], 'evidence records carry every required field');
  for (const id of ['onchain_reference', 'issuer', 'reserve_report', 'attestation_date', 'redemption_terms', 'source_link', 'attestation_example']) {
    t.assert(contract.ev.includes(id), `evidence record ${id}`);
  }
  t.eq(contract.source, 'Demo copy — pending YES approval', 'source label');
  t.eq(contract.owner, '[YES content owner]', 'responsible entity placeholder');
  t.assert(contract.unique, 'copy IDs are unique');
  t.assert(contract.illustrative >= 13, 'records are flagged illustrative');

  /* ------------------------------------------------------------------ */
  t.step('accordion structure');
  t.eq(await page.locator('.und-acc__item').count(), 7, 'seven topics');
  for (const [id, title] of Object.entries(TOPICS)) {
    const btn = page.locator(`#und-btn-${id}`);
    t.eq(await btn.count(), 1, `${id} toggle present`);
    t.eq(await page.evaluate((x) => document.getElementById('und-btn-' + x).parentElement.tagName, id), 'H3', `${id} toggle sits in an h3`);
    t.assert((await btn.innerText()).includes(title), `${id} toggle names "${title}"`);
    t.eq(await btn.getAttribute('aria-controls'), `und-panel-${id}`, `${id} aria-controls`);
    t.eq(await btn.getAttribute('aria-expanded'), 'false', `${id} starts collapsed`);
    const panel = page.locator(`#und-panel-${id}`);
    t.eq(await panel.getAttribute('role'), 'region', `${id} panel is a region`);
    t.eq(await panel.getAttribute('aria-labelledby'), `und-btn-${id}`, `${id} panel labelled by its toggle`);
    t.assert(!(await panel.isVisible()), `${id} panel hidden while collapsed`);
  }

  /* ------------------------------------------------------------------ */
  t.step('expand and collapse by keyboard');
  for (const id of IDS) {
    await page.focus(`#und-btn-${id}`);
    await page.keyboard.press('Enter');
    t.eq(await expanded(id), 'true', `${id} expands with Enter`);
    t.assert(await panelVisible(id), `${id} panel shown`);
    t.eq(await activeId(), `und-btn-${id}`, `${id} keeps focus after expanding`);
    t.eq(await page.evaluate((x) => YES.state.understand.expanded.includes(x), id), true, `${id} expanded state in YES.state.understand`);
    await page.keyboard.press('Space');
    t.eq(await expanded(id), 'false', `${id} collapses with Space`);
    t.assert(!(await panelVisible(id)), `${id} panel hidden again`);
  }
  await page.focus('#und-btn-token_units');
  await page.keyboard.press('ArrowDown');
  t.eq(await activeId(), 'und-btn-usd_equivalent', 'ArrowDown moves to the next topic');
  await page.keyboard.press('End');
  t.eq(await activeId(), 'und-btn-statement_vs_live', 'End moves to the last topic');
  await page.keyboard.press('ArrowDown');
  t.eq(await activeId(), 'und-btn-token_units', 'ArrowDown wraps to the first topic');
  await page.keyboard.press('ArrowUp');
  t.eq(await activeId(), 'und-btn-statement_vs_live', 'ArrowUp wraps to the last topic');
  await page.keyboard.press('Home');
  t.eq(await activeId(), 'und-btn-token_units', 'Home moves to the first topic');
  // Hash follows the expanded topic.
  await page.keyboard.press('Enter');
  t.eq(await page.evaluate(() => location.hash), '#/understand/token_units', 'expanding a topic updates the deep link');
  await page.keyboard.press('Enter');
  t.eq(await page.evaluate(() => location.hash), '#/understand', 'collapsing it clears the deep link');

  t.step('expand all / collapse all');
  await page.click('[data-und-all]');
  for (const id of IDS) t.eq(await expanded(id), 'true', `${id} expanded by Expand all`);
  t.eq((await text('[data-und-all]')).trim(), 'Collapse all', 'button offers Collapse all');
  await page.waitForFunction(() => document.getElementById('live-polite').textContent === 'All topics expanded', null, { timeout: 2000 }).catch(() => {});
  t.eq(await page.locator('#live-polite').textContent(), 'All topics expanded', 'expand all is announced');
  t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-fk')), 'und-all', 'focus kept on expand-all after re-render');

  /* ------------------------------------------------------------------ */
  t.step('statement-specific examples from YES.calc');
  const expect = await page.evaluate(() => {
    const c = YES.calc;
    const s = YES.data.statement;
    const posted = c.posted();
    const pend = c.notInBalance().filter((x) => x.status === 'pending');
    const tr = (r) => posted.filter((x) => (x.type === 'transfer_in' || x.type === 'transfer_out') && x.rail === r).length;
    const smallest = posted.reduce((a, x) => (!a || Math.abs(x.amount) < Math.abs(a.amount) ? x : a), null);
    return {
      closing: YES.fmt.amount(s.closing),
      smallest: YES.fmt.amount(smallest.amount, { sign: 'always' }),
      fees: YES.fmt.amount(c.feesTotal(), { sign: 'always' }),
      feeCount: c.category('fees').count,
      feeDescs: c.category('fees').txIds.map((id) => YES.L(c.tx(id).description)),
      internal: tr('internal'),
      onchain: tr('onchain'),
      onchainRef: posted.filter((x) => (x.type === 'transfer_in' || x.type === 'transfer_out') && x.rail === 'onchain' && x.onchain).length,
      posted: posted.length,
      pending: YES.fmt.amount(pend.reduce((a, x) => a + x.amount, 0)),
      pendingAbs: YES.fmt.amount(Math.abs(pend.reduce((a, x) => a + x.amount, 0))),
      pendingInitiated: pend.length ? YES.fmt.date(pend[0].initiatedAt, 'medium') : '',
      redeemed: YES.fmt.amount(c.category('redemptions').total, { sign: 'always' }),
      fiat: YES.fmt.fiat(c.fiat(s.closing), 'USD'),
      rateSource: YES.L(c.asset().fiat.source),
      asOf: YES.fmt.date(s.asOf, 'datetime'),
      issuer: YES.L(YES.config.slots.ISSUER_OR_PARTNER),
      product: YES.L(YES.config.slots.PRODUCT_NAME),
      rel: {
        onchain: c.all().filter((x) => x.rail === 'onchain').length,
        internal: c.all().filter((x) => x.rail === 'internal' && (x.type === 'transfer_in' || x.type === 'transfer_out')).length,
        pending: c.all().filter((x) => x.status === 'pending').length,
        fees: c.all().filter((x) => x.type === 'fee').length,
        redemptions: c.all().filter((x) => x.type === 'redemption').length
      }
    };
  });
  // Normalise the expected strings the same way as the page text.
  const norm = (v) => (typeof v === 'string' ? nbsp(v) : Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)])) : v);
  Object.assign(expect, norm(expect));
  const panel = (id) => text(`#und-panel-${id}`);
  const tu = await panel('token_units');
  t.assert(tu.includes(expect.closing) && tu.includes(expect.smallest) && tu.includes(expect.product), 'token units: closing balance, smallest amount, product name');
  const usd = await panel('usd_equivalent');
  t.assert(usd.includes('1 USBC = 1.0000 USD'), 'USD equivalent: illustrative rate');
  t.assert(usd.includes(expect.rateSource) && usd.includes(expect.asOf) && usd.includes('≈ ' + expect.fiat), 'USD equivalent: source, timestamp and converted closing balance');
  t.eq(await page.locator('#und-panel-usd_equivalent .tag--illustrative').count(), 1, 'USD rate tagged illustrative');
  const oc = await panel('onchain_vs_internal');
  t.assert(oc.includes(`${expect.internal} transactions`) && oc.includes(`${expect.onchain} transactions`), `on-chain vs internal: ${expect.internal} internal, ${expect.onchain} on-chain`);
  // Only the sample transfer carries a network and hash; the note must not claim each one does.
  t.assert(expect.onchainRef > 0 && expect.onchainRef < expect.onchain, `data: ${expect.onchainRef} of ${expect.onchain} on-chain transfers carry details`);
  t.eq(
    (await text('#und-panel-onchain_vs_internal .und-fact:nth-child(2) .und-fact__note')).trim(),
    `Network and hash appear only when verified. This demo adds an illustrative sample to ${expect.onchainRef} of ${expect.onchain}.`,
    'on-chain note says which transfers show a network and hash'
  );
  t.assert(!/each has/i.test(oc), 'no claim that every on-chain transfer has a network and hash');
  const ts = await panel('tx_status');
  t.assert(ts.includes(`${expect.posted} transactions`) && ts.includes(`${expect.pending}, not counted`), 'transaction status: posted count and pending amount not counted');
  t.eq(await page.locator('#und-panel-tx_status .status--pending').count(), 1, 'pending shown with a status chip');
  const fees = await panel('fees');
  t.assert(fees.includes(expect.fees) && fees.includes(`${expect.feeCount} fee lines`), `fees: total ${expect.fees} across ${expect.feeCount} lines`);
  for (const d of expect.feeDescs) t.assert(fees.includes(d), `fees list "${d}"`);
  t.eq(await page.locator('#und-panel-fees .und-line').count(), expect.feeCount, 'one row per fee line');
  const red = await panel('redemption');
  t.assert(red.includes(expect.redeemed) && red.includes(expect.pending) && red.includes('Not included in statement balance'), 'redemption: posted amount and excluded pending request');
  t.assert(red.includes(expect.issuer), 'redemption: ISSUER_OR_PARTNER slot shown as placeholder');
  // The pending request has no posted date: it uses the Transactions field name, "Initiated".
  const redPending = await text('#und-panel-redemption .und-line--pending .und-line__meta');
  t.assert(redPending.includes(`Initiated ${expect.pendingInitiated}`) && !/\bStarted\b/.test(red), `pending redemption reads "Initiated ${expect.pendingInitiated}" (${redPending})`);
  const svl = await panel('statement_vs_live');
  t.assert(svl.includes(expect.closing) && svl.includes(expect.pending), 'statement vs live: closing balance and pending item');
  const peg = await page.evaluate(() => document.getElementById('understand-root').innerText);
  t.assert(!/\bpeg\b|guarantee|always worth|profit|price/i.test(peg), 'no peg guarantee, price or performance language');

  t.step('Explain with AI and related transactions');
  await installSpies();
  const explains = await page.$$eval('#understand-root [data-explain]', (els) => els.map((e) => [e.getAttribute('data-explain'), e.getAttribute('data-explain-id')]));
  t.eq(explains.length, 8, 'an Explain button for each topic and the transparency panel');
  t.assert(
    explains.every((e) => e[0] === 'edu'),
    'every Explain button has data-explain="edu"'
  );
  t.eq(explains.map((e) => e[1]).sort(), IDS.concat(['transparency']).sort(), 'Explain buttons carry each topic id');
  t.eq(await page.getAttribute('[data-explain-id="fees"]', 'aria-label'), 'Explain with AI: Fees', 'Explain button names its topic');
  await page.click('[data-explain-id="fees"]');
  t.eq(await calls(), [{ fn: 'assistant', topic: 'edu', id: 'fees', trigger: true }], 'Explain opens the assistant with the edu topic');
  const rel = {
    onchain: [{ rails: ['onchain'] }, 'See on-chain transfers'],
    internal: [{ rails: ['internal'], types: ['transfer_in', 'transfer_out'] }, 'See internal transfers'],
    pending: [{ statuses: ['pending'] }, 'See pending transactions'],
    fees: [{ types: ['fee'] }, 'See fee lines'],
    redemptions: [{ types: ['redemption'] }, 'See redemptions']
  };
  for (const [id, [filter, label]] of Object.entries(rel)) {
    const b = page.locator(`[data-und-rel="${id}"]`).first();
    t.eq((await b.innerText()).trim(), `${label} (${expect.rel[id]})`, `related ${id} label carries the explorer count`);
    await b.click();
    t.eq(await calls(), [{ fn: 'filter', f: filter, o: { reset: true } }], `related ${id} calls explorer.applyFilter with reset`);
  }
  await page.click('[data-fk="und-go-onchain-topic"]');
  await focusedIs('und-onchain-title', 'on-chain topic links to the sample reference panel');
  await page.click('[data-fk="und-go-live-topic"]');
  await focusedIs('und-live-title', 'statement vs live topic links to the comparison panel');

  t.step('content record disclosure');
  const rec = page.locator('#und-panel-fees details.und-meta');
  t.eq(await rec.getAttribute('data-content-record'), 'EDU-005-FEES', 'fees content record id');
  const sum = nbsp(await rec.locator('summary').innerText());
  t.assert(sum.includes('EDU-005-FEES') && sum.includes('Demo copy — pending YES approval'), 'summary shows copy ID and source');
  await rec.locator('summary').click();
  // 'toggle' is dispatched asynchronously after the details element opens.
  await page.waitForFunction(() => YES.state.understand.meta['EDU-005-FEES'] === true, null, { timeout: 2000 }).catch(() => {});
  t.eq(await page.evaluate(() => YES.state.understand.meta['EDU-005-FEES']), true, 'opened record kept in YES.state.understand');
  const recText = await text('#und-panel-fees details.und-meta');
  for (const s of ['[YES content owner]', 'Sep 1, 2026 – Mar 31, 2027', 'Oct 1, 2026', 'Always shown', 'English, Español', 'Illustrative, not approved']) {
    t.assert(recText.includes(s), `content record shows "${s}"`);
  }
  await settle(150);
  await shotEl('#und-topic-fees', 'topic-fees');

  /* ------------------------------------------------------------------ */
  t.step('statement versus live balance');
  const snap = await text('[data-und-area="statement"]');
  t.assert(snap.includes(expect.closing) && snap.includes(expect.asOf) && snap.includes('Statement of record'), 'snapshot: closing balance, as-of time, statement-of-record tag');
  const live = await text('[data-und-area="live"]');
  t.assert(live.includes('Live account data is not connected in this demo.'), 'live area states it is not connected');
  t.assert(live.includes('[Timestamp appears here when connected]') && live.includes('Last updated'), 'live area has a timestamp placeholder');
  t.assert(!live.includes(expect.closing), 'live area shows no balance figure');
  t.eq(await page.evaluate(() => document.querySelector('[data-und-area="statement"]').contains(document.querySelector('[data-und-area="live"]'))), false, 'live area is separate from the statement');
  const diff = await text('#und-live');
  t.assert(diff.includes(`${expect.pendingAbs} lower`), 'explains how the pending item could make them differ');
  await page.click('[data-fk="und-live-opentx"]');
  t.eq(await calls(), [{ fn: 'openTx', id: 'TX-260930-2247', trigger: true }], 'view pending transaction opens it');

  t.step('sample on-chain reference');
  t.eq((await text('[data-und-label="onchain"] strong')).trim(), OC_LABEL, 'exact on-chain label');
  const ocp = await text('#und-onchain');
  t.assert(ocp.includes('Example Network (illustrative)') && ocp.includes('0xDE40…E19C') && ocp.includes('64'), 'network, hash display and confirmations');
  t.assert(ocp.includes('Not verified') && ocp.includes('No link') && ocp.includes('Why there is no explorer link'), 'not verified, no explorer link, and why');
  t.eq(await page.locator('#und-onchain a').count(), 0, 'no link of any kind in the on-chain panel');
  await page.click('[data-und-copy]');
  t.eq(await calls(), [{ fn: 'copy', txt: '0xDE40000000000000000000000000000000000000000000000000000000E19C' }], 'copy button copies the full hash');
  await page.click('[data-und-fullhash]');
  t.eq(await page.getAttribute('[data-und-fullhash]', 'aria-pressed'), 'true', 'show full hash pressed');
  t.eq((await text('#und-hash')).trim(), '0xDE40000000000000000000000000000000000000000000000000000000E19C', 'full hash shown');
  t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-fk')), 'und-full-hash', 'focus kept on the toggle');
  await page.click('[data-fk="und-oc-opentx"]');
  t.eq(await calls(), [{ fn: 'openTx', id: 'TX-260909-2051', trigger: true }], 'open this transaction calls explorer.openTx with a trigger');
  // Status-aware type label (ui.typeLabel(tx)): a request that has not posted never reads as completed.
  const ocType = await page.evaluate(() => {
    const label = () => document.querySelector('#und-onchain .und-oc__txmeta > span').textContent;
    const tx = YES.calc.tx('TX-260909-2051');
    const posted = label();
    tx.status = 'pending';
    YES.renderAll();
    const pending = label();
    tx.status = 'posted';
    YES.renderAll();
    return [posted, pending, label()];
  });
  t.eq(ocType, ['Sent', 'Send requested', 'Sent'], 'on-chain sample type label follows the status ("Send requested" until posted)');

  t.step('illustrative reserve / transparency panel');
  t.eq((await text('[data-und-label="transparency"] strong')).trim(), TP_LABEL, 'exact transparency label');
  const slots = await page.$$eval('.und-slot', (els) => els.map((e) => [e.getAttribute('data-slot-id'), e.getAttribute('data-evidence-state')]));
  t.eq(
    slots,
    ['issuer', 'reserve_report', 'attestation_date', 'redemption_terms', 'source_link'].map((s) => [s, 'illustrative']),
    'five slots, each an illustrative placeholder'
  );
  t.eq(await page.locator('.und-slot .und-ph').count(), 5, 'every slot value is drawn as a placeholder');
  t.assert((await text('[data-slot-id="issuer"]')).includes(expect.issuer), 'issuer slot uses ISSUER_OR_PARTNER');
  t.eq(await page.locator('#und-transparency a').count(), 0, 'no link in the transparency panel');
  const tp = await text('#und-transparency');
  t.assert(tp.includes('Only verified facts are shown, each with its source, date and responsible entity.'), 'production rule: verified facts with provenance');
  t.assert(tp.includes('warning before you leave YES'), 'production rule: external-link warning');
  t.assert(tp.includes('the claim is hidden and this page says the information is unavailable'), 'production rule: hide absent or stale evidence');
  t.eq(await page.getAttribute('[data-und-example="unavailable"]', 'data-evidence-state'), 'unavailable', 'example rendered by the evidence rule');
  t.assert((await text('[data-und-example="unavailable"]')).includes('Information unavailable'), 'rendered unavailable state');
  await page.click('[data-explain-id="transparency"]');
  t.eq(await calls(), [{ fn: 'assistant', topic: 'edu', id: 'transparency', trigger: true }], 'transparency Explain opens the assistant');

  t.step('governance rules hide unavailable content');
  const gov = await page.evaluate(() => {
    const r = YES.content.education.find((x) => x.id === 'fees');
    const old = r.validity.to;
    r.validity.to = '2026-08-31T23:59:59-04:00'; // expired before the statement date
    YES.renderAll();
    const state = YES.understand.contentState('fees');
    const unavailable = !!document.querySelector('#und-panel-fees [data-und-unavailable]');
    const explain = !!document.querySelector('#und-panel-fees [data-explain]');
    r.validity.to = old;
    YES.config.demo = false; // production: no illustrative evidence may show
    YES.renderAll();
    const prod = [YES.understand.evidenceState('issuer'), document.querySelector('[data-slot-id="issuer"]').getAttribute('data-evidence-state'), !!document.querySelector('[data-slot-id="issuer"] .und-ph')];
    const ocGone = !document.querySelector('[data-und-label="onchain"]') && !!document.querySelector('#und-onchain [data-und-unavailable]');
    YES.config.demo = true;
    YES.renderAll();
    return { state, unavailable, explain, prod, ocGone, back: YES.understand.contentState('fees'), ex: YES.understand.evidenceState('attestation_example') };
  });
  t.eq(gov.state, 'unavailable', 'expired copy is unavailable');
  t.assert(gov.unavailable && !gov.explain, 'expired topic shows the unavailable notice instead of the explanation');
  t.eq(gov.prod, ['unavailable', 'unavailable', false], 'outside the showcase, unverified evidence is hidden');
  t.assert(gov.ocGone, 'outside the showcase, the unverified on-chain reference is hidden');
  t.eq(gov.back, 'visible', 'restored copy is visible again');
  t.eq(gov.ex, 'unavailable', 'the example record is unavailable by rule');

  /* ------------------------------------------------------------------ */
  t.step('openTopic and routes');
  await page.goto('about:blank');
  await t.goto('#/overview');
  await page.evaluate(() => YES.understand.openTopic('fees'));
  await page.waitForFunction(() => location.hash === '#/understand/fees');
  t.assert(await page.locator('#view-understand').isVisible(), 'openTopic navigates to Understand');
  t.eq(await expanded('fees'), 'true', 'openTopic expands the topic');
  await focusedIs('und-btn-fees', 'openTopic focuses the topic');
  await inView('#und-btn-fees', 'opened topic is scrolled into view below the masthead');
  await page.goto('about:blank');
  await t.goto('#/understand/redemption'); // fresh load of a deep link
  t.eq(await expanded('redemption'), 'true', '#/understand/redemption expands redemption');
  await focusedIs('und-btn-redemption', 'deep link focuses the topic');
  await inView('#und-btn-redemption', 'deep-linked topic is in view');
  await page.evaluate(() => YES.understand.openTopic('transparency'));
  await focusedIs('und-transparency-title', "openTopic('transparency') focuses the transparency panel");
  await inView('#und-transparency-title', 'transparency panel in view');
  await page.click('[data-und-go="onchain"]');
  await focusedIs('und-onchain-title', 'in-page link focuses the on-chain panel');
  t.eq(await page.evaluate(() => location.hash), '#/understand/onchain', 'in-page link updates the hash');
  await page.evaluate(() => YES.understand.openTopic('nope'));
  await focusedIs('h-understand', 'an unknown topic opens the view at its heading');

  /* ------------------------------------------------------------------ */
  t.step('language switch keeps state');
  await setExpanded(['token_units', 'fees']);
  await page.evaluate(() => YES.set({ understand: Object.assign({}, YES.state.understand, { fullHash: true, meta: { 'EDU-005-FEES': true } }) }));
  await page.focus('#und-btn-fees');
  await page.evaluate(() => YES.setLang('es'));
  t.eq(await page.evaluate(() => document.documentElement.lang), 'es', 'Spanish active');
  t.eq((await h1.innerText()).trim(), 'Entiende tu estado de cuenta', 'h1 in Spanish');
  t.eq(await expanded('token_units'), 'true', 'token units still expanded in Spanish');
  t.eq(await expanded('fees'), 'true', 'fees still expanded in Spanish');
  t.eq(await expanded('redemption'), 'false', 'collapsed topics stay collapsed');
  t.eq(await activeId(), 'und-btn-fees', 'focus stays on the same toggle');
  t.eq(await page.getAttribute('[data-und-fullhash]', 'aria-pressed'), 'true', 'full hash still shown');
  t.assert(await page.locator('#und-panel-fees details.und-meta').evaluate((d) => d.open), 'content record still open');
  t.eq((await text('#und-btn-fees .und-acc__title')).trim(), 'Comisiones', 'topic title translated');
  t.eq((await text('[data-und-label="onchain"] strong')).trim(), 'Referencia ilustrativa — sin verificación en blockchain en vivo', 'on-chain label in Spanish');
  t.eq((await text('[data-und-label="transparency"] strong')).trim(), 'Diseño ilustrativo; sin afirmación sobre reservas', 'transparency label in Spanish');
  const esFees = await text('#und-panel-fees');
  const esExpect = nbsp(await page.evaluate(() => YES.fmt.amount(YES.calc.feesTotal(), { sign: 'always' })));
  t.assert(esFees.includes(esExpect) && esFees.includes('3 líneas de comisión'), 'fees example localised (' + esExpect + ')');
  t.assert((await text('#und-panel-fees details.und-meta')).includes('Texto de demostración — pendiente de aprobación de YES'), 'content record localised');
  t.eq(await page.getAttribute('[data-explain-id="fees"]', 'aria-label'), 'Explicar con IA: Comisiones', 'Explain label localised');
  const esPend = await page.evaluate(() => {
    const x = YES.calc.notInBalance().find((y) => y.type === 'redemption');
    const p = document.querySelector('#und-panel-redemption .und-line--pending .und-line__meta');
    return { want: YES.fmt.date(x.initiatedAt, 'medium'), got: p ? p.textContent : '', oc: document.querySelector('#und-onchain .und-oc__txmeta > span').textContent };
  });
  t.assert(nbsp(esPend.got).includes('Iniciado el ' + nbsp(esPend.want)), `pending redemption reads "Iniciado el …" in Spanish (${nbsp(esPend.got)})`);
  t.eq(esPend.oc, 'Enviado', 'on-chain sample type label localised');
  t.eq(await page.evaluate(() => YES.i18n.audit()), {}, 'i18n parity');
  await checkLayout('Spanish');
  await settle(200);
  if (mobile) await t.shot('es');
  else await shotEl('.und-layout', 'es');
  await page.evaluate(() => YES.setLang('en'));
  t.eq(await expanded('fees'), 'true', 'state survives the switch back');

  t.step('copy reads cleanly in both languages');
  await setExpanded(IDS.slice());
  await page.evaluate(() => document.querySelectorAll('#understand-root details').forEach((d) => (d.open = true)));
  await settle(100);
  t.eq(await doubled(), [], 'no repeated word anywhere in the English view');
  await page.evaluate(() => YES.setLang('es'));
  t.eq(await doubled(), [], 'no repeated word anywhere in the Spanish view');
  t.assert(
    (await text('#und-panel-token_units')).includes('En este estado de cuenta, los tokens se expresan con 2 decimales, así que cada importe es exacto.'),
    'Spanish token-units copy'
  );
  t.eq(
    (await text('#und-panel-onchain_vs_internal .und-fact:nth-child(2) .und-fact__note')).trim(),
    `La red y el hash solo aparecen cuando están verificados. Esta demostración añade un ejemplo ilustrativo a ${expect.onchainRef} de ${expect.onchain}.`,
    'Spanish on-chain note'
  );
  await page.evaluate(() => YES.setLang('en'));
  await setExpanded(['token_units', 'fees']);

  /* ------------------------------------------------------------------ */
  t.step('accessibility');
  await setExpanded(IDS.slice());
  await page.evaluate(() => document.querySelectorAll('#understand-root details').forEach((d) => (d.open = true)));
  await settle(150);
  await seriousAxe('#view-understand', `Understand view (all expanded, ${await page.evaluate(() => YES.theme.effective())})`);
  if (mobile) {
    const small = await page.$$eval('#understand-root button, #understand-root a, #understand-root summary', (els) =>
      els
        .filter((e) => e.offsetParent !== null)
        .map((e) => [e.getAttribute('data-fk'), Math.round(e.getBoundingClientRect().height), Math.round(e.getBoundingClientRect().width)])
        .filter((x) => x[1] < 44 || x[2] < 44)
    );
    t.eq(small, [], 'touch targets are at least 44×44 px');
  }

  /* ------------------------------------------------------------------ */
  t.step('light and dark themes');
  // Start from a light device with no choice, whatever the run's device setting.
  const deviceAtStart = await page.evaluate(() => YES.theme.device());
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => YES.theme.set(null));
  t.eq(await themeState(), [null, 'light', 'light'], 'light device, no choice: light');
  const lightColours = await colours();
  const openRecords = () => page.$$eval('#understand-root details[open]', (d) => d.length);
  const openBefore = await openRecords();

  // Dark chosen with the masthead toggle on a light device.
  await toggleTheme();
  t.eq(await themeState(), ['dark', 'dark', 'dark'], 'the masthead toggle chooses dark on a light device');
  t.eq(await page.evaluate(() => YES.state.understand.expanded.length), IDS.length, 'a theme switch keeps every topic open');
  t.eq(await openRecords(), openBefore, 'a theme switch keeps the open content records');
  const darkColours = await colours();
  t.eq(unchanged(lightColours, darkColours).slice(0, 8), [], 'every colour in the view follows the theme tokens (none is the same in light and dark)');
  await seriousAxe('#view-understand', 'Understand view (all expanded, dark choice)');
  // The focus ring uses the dark focus colour, with a transparent outline for forced colours.
  await page.focus('#und-btn-token_units');
  await page.keyboard.press('ArrowDown');
  const ring = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--focus)';
    document.body.append(probe);
    const focus = getComputedStyle(probe).color;
    probe.remove();
    const cs = getComputedStyle(document.activeElement);
    return { id: document.activeElement.id, ring: cs.boxShadow.includes(focus), outline: [cs.outlineStyle, cs.outlineWidth, cs.outlineColor] };
  });
  t.eq(ring, { id: 'und-btn-usd_equivalent', ring: true, outline: ['solid', '2px', 'rgba(0, 0, 0, 0)'] }, 'dark focus ring on a topic toggle');
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(150);
  await t.shot('dark', { fullPage: !mobile });
  if (!mobile) await shotEl('.und-pair', 'dark-pair');
  else await shotEl('#und-onchain', 'dark-onchain');

  // A dark device with light chosen (data-theme="light") looks exactly like light.
  await page.emulateMedia({ colorScheme: 'dark' });
  t.eq(await themeState(), ['dark', 'dark', 'dark'], 'dark device keeps the dark choice');
  await toggleTheme();
  t.eq(await themeState(), ['light', 'light', 'light'], 'the toggle chooses light on a dark device');
  t.eq(differs(lightColours, await colours()), [], 'light chosen on a dark device: the view is exactly the light theme');
  await seriousAxe('#view-understand', 'Understand view (all expanded, light choice on a dark device)');
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(150);
  await t.shot('dark-os-light');

  // No choice on a dark device: the view follows the device, exactly like the dark choice.
  await page.evaluate(() => YES.theme.set(null));
  t.eq(await themeState(), [null, 'dark', 'dark'], 'no choice on a dark device: dark');
  t.eq(differs(darkColours, await colours()), [], 'following a dark device: the view is exactly the dark theme');

  await page.emulateMedia({ colorScheme: deviceAtStart });
  await page.evaluate(() => YES.theme.set(null));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => YES.understand.openTopic('usd_equivalent'));
  t.eq(await page.locator('#und-panel-usd_equivalent.anim-in').count(), 0, 'no expand animation under reduced motion');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  t.step('layout and reflow');
  t.assert(await noHScroll(), 'no horizontal scroll with every topic expanded');
  if (mobile) {
    t.eq(await overflowAt(390), [], 'nothing overflows at 390px');
    await page.evaluate(() => window.scrollTo(0, 0));
    await t.shot('full', { fullPage: true });
    await page.setViewportSize({ width: 320, height: 640 });
    await settle(250);
    t.eq(await overflowAt(320), [], 'nothing overflows at 320px');
    t.assert(await noHScroll(), 'no horizontal scroll at 320px');
    await shotEl('#und-onchain', 'narrow-onchain');
    await shotEl('#und-transparency', 'narrow-transparency');
    await page.setViewportSize({ width: 390, height: 844 });
  } else {
    t.assert((await checkLayout('all topics expanded')).paired, 'desktop: evidence panels stay side by side with every topic expanded');
    await page.evaluate(() => window.scrollTo(0, 0));
    await t.shot('full', { fullPage: true });
    await shotEl('#und-transparency', 'transparency');
    // The docked assistant (html.assistant-docked, ≥1100px) narrows the page by the
    // drawer's width: the layout follows the width the view actually has.
    await setExpanded([]);
    await page.evaluate(() => document.documentElement.classList.add('assistant-docked'));
    await settle(150);
    const docked = await checkLayout('docked assistant at 1280px');
    t.assert(docked.root < 900, `docked: the view is narrowed (${docked.root}px)`);
    t.eq(await overflowAt(docked.root), [], 'docked: nothing overflows the narrowed view');
    await page.setViewportSize({ width: 1100, height: 900 });
    await settle(250);
    const docked1100 = await checkLayout('docked assistant at 1100px');
    t.assert(docked1100.stacked && docked1100.tpCols.length === 1, 'docked at 1100px: panels stack instead of squeezing into columns');
    t.eq(await overflowAt(docked1100.root), [], 'docked at 1100px: nothing overflows');
    await page.evaluate(() => window.scrollTo(0, 0));
    await t.shot('docked-1100', { fullPage: true });
    await page.evaluate(() => document.documentElement.classList.remove('assistant-docked'));
    await page.setViewportSize({ width: 1280, height: 900 });
  }
}
