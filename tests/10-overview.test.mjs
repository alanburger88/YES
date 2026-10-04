// Overview: first screen, balance card, statement details, balance journey,
// running-balance chart, fees/insight, and the "Your statement in 60 seconds"
// player (PRD 4, 5.1, 5.2, 5.7).
import { fileURLToPath } from 'node:url';

export const meta = { name: 'overview', viewports: ['desktop', 'mobile', 'narrow'] };

const BAD = ['serious', 'critical'];
// Amounts use a non-breaking space before the unit; compare on plain spaces.
const norm = (s) => String(s).replace(/\u00a0/g, ' ');
const settle = (page) => page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));

async function noHorizontalOverflow(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const offenders = [];
    document.querySelectorAll('#view-overview *').forEach((el) => {
      // SVG internals are clipped by their own viewport, and the video's picture
      // by its stage; check the <svg> and the stage boxes themselves.
      if (el.closest('.sr-only') || el.ownerSVGElement || el.closest('.vp-stage *') || !el.getClientRects().length) return;
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > vw + 1 || r.left < -1)) offenders.push((el.className && el.className.baseVal === undefined ? el.className : el.tagName) + ' ' + Math.round(r.left) + '→' + Math.round(r.right));
    });
    return { scroll: document.documentElement.scrollWidth <= vw, offenders: offenders.slice(0, 6) };
  });
}

/** Journey layout facts: active layout, labels broken inside words, colliding values, text spilling out of a step. */
async function journeyLayout(page) {
  return page.evaluate(() => {
    const jr = document.querySelector('#ov-journey-body .jr');
    const layout = getComputedStyle(jr).getPropertyValue('--jr-layout').trim();
    const broken = [...jr.querySelectorAll('.jr-step .jr-label > span:last-child')]
      .filter((e) => {
        // A label wrapped inside a word renders more lines than it has words.
        const lh = parseFloat(getComputedStyle(e).lineHeight) || 16;
        return Math.round(e.getBoundingClientRect().height / lh) > e.textContent.trim().split(/\s+/).length;
      })
      .map((e) => e.textContent.trim());
    const vals = [...jr.querySelectorAll('.jr-step .jr-value')].map((e) => e.getBoundingClientRect());
    const overlaps = [];
    for (let i = 0; i < vals.length; i++)
      for (let j = i + 1; j < vals.length; j++) {
        const a = vals[i];
        const b = vals[j];
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlaps.push(i + '/' + j);
      }
    const spill = [...jr.querySelectorAll('.jr-step')]
      .filter((s) => {
        const p = s.getBoundingClientRect();
        return [...s.querySelectorAll('.jr-value, .jr-label, .jr-sub')].some((c) => {
          const r = c.getBoundingClientRect();
          return r.left < p.left - 0.5 || r.right > p.right + 0.5 || c.scrollWidth > c.clientWidth + 1;
        });
      })
      .map((s) => s.dataset.step);
    const valueTops = layout === 'waterfall' ? [...new Set(vals.map((r) => Math.round(r.top)))] : [];
    return { layout, broken, overlaps, spill, valueRows: valueTops.length, width: document.getElementById('ov-journey-body').clientWidth };
  });
}

/** Rendered x-axis date labels of the running-balance chart that collide. */
async function axisCollisions(page) {
  return page.evaluate(() => {
    const svg = document.querySelector('.ov-chart__svg');
    if (!svg) return ['no chart'];
    const labels = [...svg.querySelectorAll('text.c-tick[text-anchor="middle"]')].map((tx) => tx.getBoundingClientRect());
    labels.sort((a, b) => a.left - b.left);
    const out = [];
    for (let i = 1; i < labels.length; i++) if (labels[i].left < labels[i - 1].right + 2) out.push(i);
    return out;
  });
}

/** The video stage's colours: its greeting's contrast on the stage colour, and that colour's luminance. */
async function stageFacts(page) {
  return page.evaluate(() => {
    const vp = document.querySelector('.vp');
    const ctx = document.createElement('canvas').getContext('2d');
    const rgb = (c) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const lum = (c) => {
      const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const probe = document.createElement('span');
    vp.appendChild(probe);
    const tok = (name) => {
      probe.style.color = 'var(' + name + ')';
      return getComputedStyle(probe).color;
    };
    const bg = lum(rgb(tok('--vs-bg')));
    const deep = lum(rgb(tok('--vs-deep')));
    probe.remove();
    const ink = lum(rgb(getComputedStyle(vp.querySelector('.vs-greet__hello')).color));
    const c = (x, y) => Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 10) / 10;
    return { contrast: Math.min(c(bg, ink), c(deep, ink)), bg: Math.round(bg * 100) / 100 };
  });
}

/** Elements whose text wraps inside a word (more rendered lines than words). */
async function brokenWords(page, sel) {
  return page.$$eval(sel, (els) =>
    els
      .filter((e) => e.getClientRects().length)
      .filter((e) => {
        const lh = parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.5;
        return Math.round(e.getBoundingClientRect().height / lh) > e.textContent.trim().split(/\s+/).length;
      })
      .map((e) => e.textContent.trim())
  );
}

async function spy(page) {
  await page.evaluate(() => {
    window.__calls = [];
    const fk = (o) => (o && o.trigger && o.trigger.getAttribute ? o.trigger.getAttribute('data-fk') : null);
    // list: the ids Previous / Next stay within (null: the explorer's default).
    YES.explorer.openTx = (id, o) => __calls.push({ fn: 'openTx', id, fk: fk(o), list: (o && o.list) || null });
    YES.explorer.applyFilter = (f, o) => __calls.push({ fn: 'applyFilter', f, o });
    YES.explorer.showRows = (ids, label) => __calls.push({ fn: 'showRows', ids, label });
    YES.assistant.open = (ctx) => __calls.push({ fn: 'assistant', topic: ctx.topic, id: ctx.id || null });
    YES.understand.openTopic = (id) => __calls.push({ fn: 'openTopic', id });
  });
}
const calls = (page) => page.evaluate(() => window.__calls.splice(0));

async function shot(t, name, opts) {
  await settle(t.page);
  await t.page.waitForTimeout(350); // let smooth scrolling finish
  await t.shot(name, opts);
}

async function fresh(t, hash) {
  await t.goto(hash);
  await t.page.reload();
  await t.page.waitForFunction(() => window.YES && window.YES.ready === true);
}

async function axeOk(t, sel, label) {
  const v = await t.axe(sel);
  const bad = v.filter((x) => BAD.includes(x.impact));
  t.eq(bad, [], `axe serious/critical (${label})`);
  return v;
}

/** Phones have no tab row: the sections and the language switch are in the masthead's Menu. */
const phoneMenu = (page) =>
  page.evaluate(() => {
    const b = document.querySelector('#masthead [data-mast-menu]');
    return !!b && b.getClientRects().length > 0;
  });

/** Go to a view the way a visitor does: the section tabs, or on phones the Menu. */
async function navTo(page, view) {
  if (await phoneMenu(page)) {
    await page.click('#masthead [data-mast-menu]');
    await page.click(`#mast-menu [data-nav="${view}"]`);
  } else {
    await page.click(`.nav__link[data-nav="${view}"]`);
  }
  await page.waitForFunction((v) => YES.state.view === v, view);
}

/** Switch language with the masthead's switch (the only one), or on phones in the Menu. */
async function switchLang(page, lang) {
  if (await phoneMenu(page)) {
    await page.click('#masthead [data-mast-menu]');
    await page.click(`#mast-menu [data-lang="${lang}"]`);
    await page.keyboard.press('Escape');
  } else {
    await page.click(`#masthead .mast-wide [data-lang="${lang}"]`);
  }
  await page.waitForFunction((l) => YES.i18n.lang === l && document.documentElement.lang === l, lang);
}

/**
 * Colours the overview paints, next to the theme tokens they should follow
 * (resolved through a probe element, so the test never hard-codes a token).
 */
async function paints(page) {
  return page.evaluate(() => {
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    const tok = (name) => {
      probe.style.color = 'var(' + name + ')';
      return getComputedStyle(probe).color;
    };
    const cs = (sel) => getComputedStyle(document.querySelector(sel));
    const out = {
      theme: document.documentElement.getAttribute('data-theme'),
      card: [cs('.ov-balance').backgroundColor, tok('--surface')],
      hero: [cs('.ov-hero__num').color, tok('--ink')],
      bar: [cs('.jr-step--out .jr-bar').backgroundColor, tok('--out')],
      line: [cs('.ov-chart__svg .c-line').stroke, tok('--total')],
      marker: [cs('.ov-chart__svg .ov-mk--in').fill, tok('--in')],
      grid: [cs('.ov-chart__svg .c-grid').stroke, tok('--grid')]
    };
    probe.remove();
    return out;
  });
}
/** Every painted colour equals its token. */
const followsTokens = (p) => ['card', 'hero', 'bar', 'line', 'marker', 'grid'].every((k) => p[k][0] === p[k][1]);

/**
 * Sideways overflow with very large text: the page width, elements and text
 * runs past the viewport. Data tables may scroll inside their own .table-wrap
 * (WCAG 1.4.10 exception), so the wrapper must fit but its table may not.
 */
async function reflowFacts(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    const skip = (el) => el.closest('.sr-only') || el.ownerSVGElement || el.closest('.vp-stage *') || (el.closest('.table-wrap') && !el.classList.contains('table-wrap'));
    document.querySelectorAll('#view-overview *').forEach((el) => {
      if (skip(el) || !el.getClientRects().length) return;
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > vw + 1 || r.left < -1)) out.push((typeof el.className === 'string' && el.className ? el.className : el.tagName) + ' ' + Math.round(r.left) + '→' + Math.round(r.right));
    });
    const walker = document.createTreeWalker(document.getElementById('view-overview'), NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim() || skip(n.parentElement)) continue;
      range.selectNodeContents(n);
      const right = [...range.getClientRects()].reduce((m, x) => Math.max(m, x.right), 0);
      if (right > vw + 1) out.push('text "' + n.textContent.trim().slice(0, 30) + '" →' + Math.round(right));
    }
    // Pairs that must not overlap: a group's label and total.
    const hit = (a, b) => a && b && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
    const box = (el) => el && el.getBoundingClientRect();
    const collide = [];
    document.querySelectorAll('.jr-group').forEach((g) => {
      if (hit(box(g.querySelector('.jr-group__label')), box(g.querySelector('.jr-group__value')))) collide.push('group ' + g.dataset.group);
    });
    // Inline lists clip their items' leading separators; an item must never be clipped itself.
    const clipped = [...document.querySelectorAll('#view-overview .ov-seps')]
      .filter((w) => getComputedStyle(w).display !== 'contents')
      .filter((w) => {
        const r = w.getBoundingClientRect();
        return [...w.querySelectorAll('.ov-seps__in > :not(.sr-only)')].some((it) => it.getBoundingClientRect().right > r.right + 0.5);
      })
      .map((w) => w.textContent.trim().slice(0, 30));
    return { scroll: document.documentElement.scrollWidth <= vw, out: out.slice(0, 8), collide, clipped };
  });
}

export default async function (t) {
  const { page } = t;
  const vp = t.viewport;
  const wide = vp === 'desktop';

  // Collect runtime warnings (missing i18n keys only warn) from a fresh load.
  const warnings = [];
  page.on('console', (m) => {
    if (m.type() === 'warning' && /\[i18n\]|overview/i.test(m.text())) warnings.push(m.text());
  });
  await fresh(t, '#/overview');

  /* ------------------------------------------------------------ first screen */
  t.step('heading and handshake');
  t.eq(await page.locator('#view-overview h1').count(), 1, 'exactly one h1 in the overview');
  const h1 = page.locator('#h-overview');
  t.eq(await h1.getAttribute('class'), 'view-title', 'h1 class');
  t.assert((await h1.getAttribute('tabindex')) === '-1' && (await h1.getAttribute('data-view-heading')) !== null, 'h1 is the focusable view heading');
  t.eq(norm(await h1.innerText()).trim(), 'Your September 2026 statement', 'h1 names the statement period');
  const expectedHandshake = await page.evaluate(
    () =>
      'Hello, ' +
      YES.data.statement.customer.firstName +
      '. Here is your YES activity for ' +
      YES.fmt.range(YES.data.statement.periodStart, YES.data.statement.periodEnd) +
      '. Start with the highlights, then explore any movement you would like to understand. If something does not look right, we are here to help.'
  );
  t.eq(norm(await page.locator('.ov-handshake').innerText()).trim(), expectedHandshake, 'PRD handshake, verbatim, with first name and period');

  t.step('balance card');
  t.eq(norm(await page.locator('.ov-hero__num').innerText()).trim(), '1,147.50', 'hero shows the closing balance');
  t.eq(norm(await page.locator('.ov-hero__sym').innerText()).trim(), 'EXUSD', 'asset symbol next to the hero');
  const heroStyle = await page.locator('.ov-hero__num').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { size: parseFloat(cs.fontSize), nums: cs.fontVariantNumeric };
  });
  t.assert(heroStyle.size >= 48, 'hero figure is at least 48px (got ' + heroStyle.size + ')');
  t.assert(!/tabular/.test(heroStyle.nums), 'hero uses proportional figures');
  t.assert(norm(await page.locator('.ov-hero .sr-only').innerText()).includes('token units'), 'hero spoken text names token units');
  t.assert(norm(await page.locator('#ov-balance-title').innerText()).includes('Statement balance'), 'labelled "Statement balance"');
  t.assert(norm(await page.locator('.ov-hero__unit').innerText()).includes('token units'), 'unit label shown');
  const asOf = norm(await page.locator('.ov-asof').innerText());
  t.assert(/As of Sep 30, 2026, 11:59\sPM EDT \(America\/New_York\)/.test(asOf), 'as-of date, time and timezone: ' + asOf);
  const fiat = norm(await page.locator('.ov-fiat').innerText());
  t.assert(fiat.includes('USD 1,147.50') && fiat.includes('Illustrative') && fiat.includes('1.0000') && fiat.includes('Illustrative demo rate') && /not a guarantee of value/.test(fiat), 'USD equivalent with rate, source, time and no-guarantee wording');
  t.assert(norm(await page.locator('.ov-fiat__meta').innerText()).includes('Sep 30, 2026'), 'fiat timestamp shown');
  const change = norm(await page.locator('.ov-change').innerText());
  t.assert(change.includes('+147.50 EXUSD') && change.includes('1,000.00 EXUSD'), 'signed net change since opening: ' + change);
  t.eq(await page.locator('.ov-change__value .dir--in').count(), 1, 'direction icon on the net change');
  // A positive change takes the upward trend glyph, never the downward "received" tray arrow.
  const netIcon = await page.evaluate(() => {
    const parse = (name) => {
      const box = document.createElement('div');
      box.innerHTML = YES.ui.icon(name);
      return box.querySelector('svg').innerHTML;
    };
    const inner = document.querySelector('.ov-change__value .dir svg').innerHTML;
    return { up: inner === parse('trend-up'), arrowIn: inner === parse('arrow-in') };
  });
  t.eq(netIcon, { up: true, arrowIn: false }, 'net change +147.50 uses the trend-up glyph');
  const netFit = await page.evaluate(() => {
    const side = document.querySelector('.ov-balance__side').getBoundingClientRect();
    const parts = [...document.querySelectorAll('.ov-change__value > *')].map((e) => e.getBoundingClientRect());
    return parts.every((r) => r.right <= side.right + 0.5 && r.left >= side.left - 0.5);
  });
  t.assert(netFit, 'net change stays inside its column');

  t.step('first screen');
  const fold = await page.evaluate(() => ({
    actions: Math.round(Math.max(...[...document.querySelectorAll('.ov-actions .btn')].map((b) => b.getBoundingClientRect().bottom + scrollY))),
    journey: Math.round(document.getElementById('ov-journey-title').getBoundingClientRect().top + scrollY),
    vh: innerHeight
  }));
  if (vp === 'mobile') t.assert(fold.actions <= fold.vh, 'both primary actions are on the first screen of a 390×844 phone (bottom ' + fold.actions + ')');
  if (wide) t.assert(fold.journey + 32 <= fold.vh, 'the balance journey starts on the first screen at 1280×900 (heading at ' + fold.journey + ')');
  const sf = await stageFacts(page);
  t.assert(sf.contrast >= 4.5, 'video poster text contrast: ' + sf.contrast);
  // No choice yet: the device setting (light, or dark with tests/run.mjs --color-scheme dark).
  t.eq(await page.evaluate(() => [YES.theme.get(), YES.theme.effective() === YES.theme.device()]), [null, true], 'no theme choice yet: follows the device');
  const devicePaint = await paints(page);
  t.assert(followsTokens(devicePaint), 'card, hero, journey bars, chart line, markers and grid are painted from the tokens: ' + JSON.stringify(devicePaint));

  t.step('not-in-balance notice');
  const notin = norm(await page.locator('.ov-notin').innerText());
  t.assert(notin.includes('1 pending transaction (−30.00 EXUSD) is not included in this balance.'), 'pending notice: ' + notin);
  t.assert(notin.includes('Pending'), 'status chip with label');
  t.assert(notin.includes('Redemption request awaiting bank settlement · initiated Sep 30, 2026'), 'detail names the date with the "Initiated" field name used elsewhere: ' + notin);
  await spy(page);
  await page.click('[data-fk="ov-notin-view"]');
  t.eq(await calls(page), [{ fn: 'openTx', id: 'TX-260930-2247', fk: 'ov-notin-view', list: null }], 'pending notice opens the pending transaction (a single transaction: no list of its own)');
  // Several transactions outside the balance: "Show them in Transactions" hands
  // the explorer a localised chip label, so the chip follows a language switch.
  await page.evaluate(() => {
    window.__orig = YES.data;
    const copy = JSON.parse(JSON.stringify(YES.data));
    const extra = Object.assign(JSON.parse(JSON.stringify(copy.transactions.find((x) => x.status === 'pending'))), { id: 'TX-260930-2350', seq: 17, status: 'failed', reference: 'REF-T3ST-0002' });
    copy.transactions.push(extra);
    YES.data = copy;
    YES.renderAll();
  });
  t.assert(norm(await page.locator('.ov-notin').innerText()).includes('2 transactions that are not posted (−60.00 EXUSD in total)'), 'notice counts both');
  await spy(page);
  await page.click('[data-fk="ov-notin-all"]');
  t.eq(
    (await calls(page))[0],
    { fn: 'showRows', ids: ['TX-260930-2247', 'TX-260930-2350'], label: { en: 'Not included in this balance', es: 'No incluidos en este saldo' } },
    'Show them in Transactions passes the ids and a { en, es } label'
  );
  await page.evaluate(() => {
    YES.data = window.__orig;
    YES.renderAll();
  });
  await navTo(page, 'overview');

  t.step('statement details');
  const details = page.locator('.ov-details');
  t.eq(await details.evaluate((d) => d.open), false, 'details collapsed by default (secondary)');
  await page.click('[data-fk="ov-details"]');
  t.eq(await details.evaluate((d) => d.open), true, 'details open');
  const dtext = norm(await details.innerText());
  for (const s of ['YES-STM-202609-000184', '1.0', 'Original', 'Period start', 'Period end', 'Statement as of', 'Generated', 'Timezone', 'EDT (America/New_York)', '•••• 7316', '0x5A…E19C', 'Masked', 'Posted date', 'Dates and totals use the posted date.', 'masked to protect your account']) {
    t.assert(dtext.includes(s), 'details include ' + s);
  }
  const masked = await page.$$eval('.ov-details dd .mono', (els) =>
    els.map((e) => ({ hidden: (e.querySelector('[aria-hidden="true"]') || {}).textContent || null, spoken: (e.querySelector('.sr-only') || {}).textContent || null }))
  );
  t.eq(masked[1], { hidden: '•••• 7316', spoken: 'ending in 7316' }, 'masked account number: bullets hidden from assistive technology, "ending in 7316" spoken');
  t.eq(await page.evaluate(() => YES.state.overview.details), true, 'details open state kept in YES.state');
  t.assert(!(await page.locator('.ov-details [data-reveal], .ov-details button').count()), 'no reveal control (feature flag off)');
  await shot(t, 'details', { fullPage: false });

  t.step('primary actions');
  await spy(page);
  await page.click('[data-ov-explore]');
  t.eq((await calls(page))[0], { fn: 'applyFilter', f: {}, o: { reset: true } }, 'Explore transactions resets filters');
  t.eq(await page.evaluate(() => YES.state.view), 'transactions', 'Explore transactions navigates to Transactions');
  await navTo(page, 'overview');
  await page.click('[data-fk="ov-explain-balance"]');
  t.eq(await calls(page), [{ fn: 'assistant', topic: 'balance', id: null }], 'Explain this balance opens the assistant on topic balance');
  t.assert((await page.locator('[data-fk="ov-explain-balance"]').getAttribute('aria-label')).startsWith('Explain this balance'), 'accessible name contains the visible label');

  /* ------------------------------------------------------------ journey */
  t.step('journey values');
  const steps = await page.$$eval('.jr [data-step]', (els) => els.map((e) => ({ id: e.dataset.step, value: +e.dataset.value, tag: e.tagName })));
  t.eq(
    steps.map((s) => s.id),
    ['opening', 'deposits', 'transfers_in', 'transfers_out', 'redemptions', 'fees', 'closing'],
    'seven steps in order'
  );
  t.eq(
    steps.map((s) => s.value),
    [100000, 50000, 20000, -45000, -10000, -250, 114750],
    'step values (minor units)'
  );
  const fromCalc = await page.evaluate(() => YES.calc.journey().map((s) => s.value));
  t.eq(steps.map((s) => s.value), fromCalc, 'values come from YES.calc.journey()');
  t.eq(steps.filter((s) => s.tag === 'BUTTON').length, 5, 'each category step is a button');
  const visible = await page.$$eval('.jr [data-step] .jr-value .ov-num > [aria-hidden="true"]', (els) => els.map((e) => e.textContent.trim()));
  t.eq(visible, ['1,000.00', '+500.00', '+200.00', '−450.00', '−100.00', '−2.50', '1,147.50'], 'exact token values with sign');
  t.eq(await page.locator('.jr [data-ov-step]').evaluateAll((els) => els.every((e) => e.getAttribute('aria-pressed') === 'false')), true, 'all toggles start unpressed');
  const groups = await page.$$eval('.jr-group', (els) => els.map((e) => ({ id: e.dataset.group, value: +e.dataset.value, text: e.innerText.replace(/\s+/g, ' ').trim() })));
  t.eq(groups.map((g) => [g.id, g.value]), [['incoming', 70000], ['outgoing', -55250]], 'two groups with totals');
  t.assert(groups[0].text.includes('Incoming activity') && groups[0].text.includes('+700.00'), 'incoming group label/value');
  t.assert(groups[1].text.includes('Outgoing activity and fees') && groups[1].text.includes('−552.50'), 'outgoing group label/value');
  t.eq(await page.locator('.jr-step--in .jr-dir, .jr-step--out .jr-dir').count(), 5, 'icons accompany direction (not colour alone)');
  t.assert(norm(await page.locator('[data-ov-step="transfers_out"] .sr-only').first().innerText()).includes('minus 450.00 EXUSD'), 'spoken amount says minus');
  // Steps are grouped by type: the levels between them are subtotals, not balances
  // the account held (the ledger never went above 1,250.00).
  const stepText = norm(await page.locator('[data-ov-step="transfers_in"]').innerText());
  t.assert(stepText.includes('Running subtotal after this step: 1,700.00 EXUSD') && !/balance after/i.test(stepText), 'intermediate level is a running subtotal: ' + stepText);
  t.eq(
    await page.$$eval('#view-overview', (els) => (els[0].textContent.match(/Balance after this step|Balance after step/g) || []).length),
    0,
    'no "balance after" label on journey subtotals'
  );
  t.assert(norm(await page.locator('.ov-sechead .ov-legend').innerText()).includes('Opening and closing balance'), 'dark bars keyed as opening and closing balance');
  const layout0 = await journeyLayout(page);
  t.eq(layout0.layout, wide ? 'waterfall' : 'list', 'journey layout for a ' + layout0.width + 'px column');
  t.eq([layout0.broken, layout0.overlaps, layout0.spill], [[], [], []], 'labels wrap between words, values neither collide nor spill');
  if (wide) t.eq(layout0.valueRows, 1, 'waterfall values share one baseline');
  t.eq(
    await page.evaluate(() => [getComputedStyle(document.querySelector('.jr-label')).overflowWrap, getComputedStyle(document.querySelector('.jr-sub')).whiteSpace]),
    ['break-word', 'normal'],
    'labels never break anywhere; counts may wrap (text spacing)'
  );

  t.step('select outgoing transfers with the keyboard');
  const histBefore = await page.evaluate(() => history.length);
  await page.focus('[data-ov-step="transfers_out"]');
  await page.keyboard.press('Enter');
  t.eq(await page.evaluate(() => YES.state.journeyStep), 'transfers_out', 'state.journeyStep set');
  // PRD 5.2: selecting a step filters the transaction explorer to exactly its transactions.
  t.eq(
    await page.evaluate(() => YES.state.filters),
    await page.evaluate(() => Object.assign(YES.defaultFilters(), { step: 'transfers_out' })),
    'the explorer filter follows the selected step (fresh filter, step only)'
  );
  t.eq(await page.evaluate(() => history.length), histBefore + 1, 'selecting from the full journey adds a history entry (Back clears it)');
  t.eq(await page.getAttribute('[data-ov-step="transfers_out"]', 'aria-pressed'), 'true', 'pressed');
  t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-fk')), 'ov-step-transfers_out', 'focus stays on the toggle');
  t.eq(await page.evaluate(() => location.hash), '#/overview/transfers_out', 'deep link reflects the selection');
  const panel = page.locator('#ov-panel-section');
  t.assert(await panel.isVisible(), 'transactions panel visible');
  t.eq(norm(await page.locator('#ov-panel-title').innerText()).trim(), 'Outgoing transfers', 'panel heading names the step');
  const rowIds = await page.$$eval('#ov-panel-section [data-ov-tx]', (els) => els.map((e) => e.getAttribute('data-ov-tx')));
  const expectIds = await page.evaluate(() => YES.calc.category('transfers_out').txIds);
  t.eq(rowIds.length, 5, 'exactly 5 rows');
  t.eq(rowIds, expectIds, 'exactly the step transactions, chronological');
  const rowTexts = await page.$$eval('#ov-panel-section .ov-tx', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  rowTexts.forEach((r, i) => (rowTexts[i] = norm(r)));
  t.assert(rowTexts[0].includes('Sep 3, 2026') && rowTexts[0].includes('Sent') && rowTexts[0].includes('Daniel K.') && rowTexts[0].includes('−120.00'), 'row shows posted date, type label, counterparty and signed amount: ' + rowTexts[0]);
  t.eq(await page.getAttribute('.ov-sum', 'data-sum'), '-45000', 'sum of rows equals the step value');
  const sumText = norm(await page.locator('.ov-sum').innerText());
  t.assert(sumText.includes('−450.00 EXUSD') && sumText.includes('Matches Outgoing transfers in the journey'), 'sum line proves the rows add up: ' + sumText);
  t.eq(await page.locator('.ov-sum--ok').count(), 1, 'sum marked as matching');
  t.eq(norm(await page.locator('.ov-sum__math').innerText()).trim(), '−120.00 − 200.00 − 60.00 − 45.50 − 24.50 = −450.00 EXUSD', 'row arithmetic shown');
  t.assert(norm(await page.locator('#live-polite').innerText()).length >= 0, 'live region exists');
  await page.waitForFunction(() => document.getElementById('live-polite').textContent.includes('Outgoing transfers selected'));
  t.assert(norm(await page.locator('#live-polite').innerText()).includes('5 transactions'), 'selection announced with result count');
  t.eq(await page.locator('.jr-step.is-dim').count(), 6, 'other steps recede');
  t.eq(await page.locator('#ov-panel-section.is-anim').count(), 1, 'panel slides in (motion allowed)');
  if (!wide) {
    // Narrow layout: the panel follows the selected row.
    t.eq(await page.evaluate(() => document.querySelector('[data-step="transfers_out"]').nextElementSibling.id), 'ov-panel', 'panel sits right after the selected row');
  } else {
    t.eq(await page.evaluate(() => document.getElementById('ov-panel').previousElementSibling.classList.contains('jr')), true, 'panel sits below the waterfall');
  }
  await shot(t, 'journey-selected');

  t.step('row opens the transaction');
  await spy(page);
  await page.click('#ov-panel-section [data-ov-tx="TX-260909-2051"]');
  t.eq(await calls(page), [{ fn: 'openTx', id: 'TX-260909-2051', fk: 'ov-tx-TX-260909-2051', list: expectIds }], 'openTx called with id, trigger and the step’s rows in display order');

  t.step('panel actions');
  await page.click('[data-fk="ov-panel-explain"]');
  t.eq(await calls(page), [{ fn: 'assistant', topic: 'step', id: 'transfers_out' }], 'Explain with AI carries the step');
  await page.click('[data-ov-show="transfers_out"]');
  t.eq((await calls(page))[0], { fn: 'applyFilter', f: { step: 'transfers_out' }, o: { reset: true } }, 'Show in Transactions filters to the step');
  t.eq(await page.evaluate(() => YES.state.view), 'transactions', 'navigated to Transactions');
  await navTo(page, 'overview');
  t.eq(await page.evaluate(() => YES.state.journeyStep), 'transfers_out', 'selection survives navigation');

  t.step('clear selection');
  await page.click('[data-ov-clear]');
  t.eq(await page.evaluate(() => YES.state.journeyStep), null, 'cleared');
  t.eq(await page.evaluate(() => YES.state.filters.step), null, 'clearing the step restores the full ledger in the explorer');
  t.eq(await page.locator('#ov-panel-section').count(), 0, 'panel removed');
  t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-fk')), 'ov-step-transfers_out', 'focus returns to the step');
  t.eq(await page.evaluate(() => location.hash), '#/overview', 'deep link cleared');

  t.step('group selection');
  await page.focus('[data-ov-step="outgoing"]');
  await page.keyboard.press('Space');
  t.eq(await page.getAttribute('[data-ov-step="outgoing"]', 'aria-pressed'), 'true', 'group pressed');
  t.eq(await page.locator('#ov-panel-section [data-ov-tx]').count(), 9, 'outgoing group lists 9 rows (5 transfers, 1 redemption, 3 fees)');
  t.eq(await page.getAttribute('.ov-sum', 'data-sum'), '-55250', 'group sum −552.50');
  t.eq(await page.evaluate(() => YES.state.filters.step), 'outgoing', 'a group filters the explorer too');
  const panelFacts = await page.evaluate(() => {
    const sum = document.querySelector('.ov-sum__label');
    const lh = parseFloat(getComputedStyle(sum).lineHeight);
    const jr = document.querySelector('.jr').getBoundingClientRect();
    const panel = document.getElementById('ov-panel-section').getBoundingClientRect();
    const seps = [...document.querySelectorAll('#ov-panel-section .ov-seps')];
    const lineStartsClipped = seps.every((w) => {
      if (getComputedStyle(w).display === 'contents') return true; // table-like row: no separators
      const wl = w.getBoundingClientRect().left;
      let top = null;
      return [...w.querySelectorAll('.ov-seps__in > :not(.sr-only)')].every((it) => {
        const r = it.getBoundingClientRect();
        const starts = top === null || r.top > top + 2;
        top = r.top;
        // An item that starts a line sits one separator left of the wrapper: its "·" is clipped.
        return !starts || r.left + parseFloat(getComputedStyle(it).paddingLeft) <= wl + 0.5;
      });
    });
    return {
      sumOneLine: sum.getBoundingClientRect().height < lh * 1.6,
      textDots: seps.some((w) => /·/.test(w.textContent)),
      lineStartsClipped,
      fullWidth: Math.abs(panel.left - jr.left) < 1
    };
  });
  t.eq([panelFacts.sumOneLine, panelFacts.textDots, panelFacts.lineStartsClipped], [true, false, true], 'panel: "Sum of these rows" on one line; separators drawn by CSS and hidden at line starts');
  if (vp === 'narrow') t.assert(panelFacts.fullWidth, 'phones: the panel uses the full card width (no group indent)');
  t.eq(await page.locator('.jr-step.is-member').count(), 3, 'member steps highlighted');
  t.eq(await page.locator('.jr-check:visible').count(), 1, 'check icon marks the pressed toggle');
  await page.click('[data-ov-step="incoming"]');
  t.eq(await page.getAttribute('[data-ov-step="outgoing"]', 'aria-pressed'), 'false', 'previous group released');
  t.eq(await page.locator('#ov-panel-section [data-ov-tx]').count(), 6, 'incoming group lists 6 rows');
  t.eq(await page.getAttribute('.ov-sum', 'data-sum'), '70000', 'incoming sum +700.00');
  await shot(t, 'journey-group');
  await page.click('[data-ov-step="incoming"]');
  t.eq(await page.evaluate(() => YES.state.journeyStep), null, 'pressing again toggles off');

  t.step('language switch preserves the selection');
  await page.click('[data-ov-step="transfers_out"]');
  await switchLang(page, 'es');
  t.eq(await page.evaluate(() => YES.state.journeyStep), 'transfers_out', 'state kept');
  t.eq(await page.getAttribute('[data-ov-step="transfers_out"]', 'aria-pressed'), 'true', 'still pressed after re-render');
  t.eq(norm(await page.locator('#ov-panel-title').innerText()).trim(), 'Transferencias enviadas', 'panel heading in Spanish');
  t.assert(norm(await page.locator('#ov-panel-section').innerText()).includes('450,00'), 'Spanish number format 450,00');
  t.eq(await page.locator('#ov-panel-section [data-ov-tx]').count(), 5, 'same 5 rows');
  t.assert(norm(await page.locator('#h-overview').innerText()).includes('septiembre de 2026'), 'h1 in Spanish');
  t.eq(
    norm(await page.locator('.ov-handshake').innerText()).trim(),
    'Hola, Sam. Aquí tienes tu actividad de YES del 1 al 30 de septiembre de 2026. Empieza por lo esencial y explora cualquier movimiento que quieras entender mejor. Si algo no te cuadra, estamos aquí para ayudarte.',
    'Spanish handshake reads naturally ("del 1 al 30 de septiembre")'
  );
  t.assert(norm(await page.locator('[data-ov-step="transfers_in"]').innerText()).includes('Subtotal acumulado tras este paso: 1.700,00 EXUSD'), 'Spanish subtotal wording');
  t.assert(norm(await page.locator('.ov-hero__num').innerText()).includes('147,50'), 'hero in Spanish format');
  t.eq(await page.evaluate(() => YES.state.overview.details), true, 'details disclosure state survives');
  t.eq(await page.locator('.ov-details').evaluate((d) => d.open), true, 'details still open');
  t.eq(await page.evaluate(() => YES.i18n.audit()), {}, 'i18n parity');
  const untranslated = await page.evaluate(() => {
    const keys = Object.keys(YES.i18n.dict.en).filter((k) => k.startsWith('overview.'));
    return keys.filter((k) => YES.i18n.dict.es[k] === YES.i18n.dict.en[k] && !/^(Original)$/.test(YES.i18n.dict.en[k]));
  });
  t.eq(untranslated, [], 'every Spanish overview string is translated');
  await page.click('[data-fk="ov-jtable"]');
  await page.click('[data-fk="ov-ctable"]');
  const ovEs = await noHorizontalOverflow(page);
  t.assert(ovEs.scroll, 'no horizontal scroll in Spanish');
  t.eq(ovEs.offenders, [], 'nothing overflows in Spanish');
  t.eq(
    await page.$$eval('.ov-tablebox .table-wrap', (els) => els.map((w) => Math.max(0, w.scrollWidth - w.clientWidth))),
    [0, 0],
    'the journey and running-balance tables fit their width in Spanish (no sideways scroll, down to 320px)'
  );
  t.eq(await brokenWords(page, '.ov-jtable th[scope="row"] .ov-table__label, .ov-jtable th[scope="row"] .ov-table__sub'), [], 'table row headers wrap between words in Spanish');
  const esJourney = await journeyLayout(page);
  t.eq([esJourney.broken, esJourney.overlaps, esJourney.spill], [[], [], []], 'Spanish journey: no broken labels, collisions or spills');
  await page.click('[data-fk="ov-jtable"]');
  await page.click('[data-fk="ov-ctable"]');
  await shot(t, 'spanish');
  await switchLang(page, 'en');
  t.eq(await page.getAttribute('[data-ov-step="transfers_out"]', 'aria-pressed'), 'true', 'still selected after switching back');

  t.step('equation and table view');
  t.eq(await page.getAttribute('.jr-eq', 'data-equation'), '1,000.00 + 500.00 + 200.00 − 450.00 − 100.00 − 2.50 = 1,147.50 EXUSD', 'equation text built from data');
  const spoken = norm(await page.locator('.jr-eq .sr-only').innerText());
  t.assert(spoken.includes('Opening balance 1,000.00 EXUSD') && spoken.includes('minus Outgoing transfers 450.00 EXUSD') && spoken.includes('equals Closing balance 1,147.50 EXUSD'), 'spoken equation: ' + spoken);
  await page.click('[data-fk="ov-jtable"]');
  const table = await page.$$eval('.ov-jtable tbody tr', (rows) => rows.map((r) => Array.from(r.children).map((c) => (c.querySelector('.ov-table__label, [aria-hidden="true"]') || c).textContent.trim())));
  t.eq(
    table,
    [
      ['Opening balance', '—', '1,000.00', '—'],
      ['Deposits', '+500.00', '1,500.00', '3'],
      ['Incoming transfers', '+200.00', '1,700.00', '3'],
      ['Outgoing transfers', '−450.00', '1,250.00', '5'],
      ['Redemptions', '−100.00', '1,150.00', '1'],
      ['Fees', '−2.50', '1,147.50', '3'],
      ['Closing balance', '—', '1,147.50', '—']
    ],
    'journey table: step, change, balance after, count'
  );
  t.assert(norm(await page.locator('.ov-jtable caption').innerText()).includes('Balance journey'), 'table has a caption');
  t.eq(await page.$$eval('.ov-jtable thead th', (ths) => ths.map((th) => th.getAttribute('scope'))), ['col', 'col', 'col', 'col'], 'column headers scoped');

  /* ------------------------------------------------------------ chart */
  t.step('running-balance chart');
  t.eq(await page.locator('.ov-chart__svg').count(), 1, 'chart drawn');
  t.eq(await page.locator('.ov-chart__svg').getAttribute('aria-hidden'), 'true', 'SVG decorative; text alternative carries meaning');
  t.eq(await page.locator('[data-ov-pt]').count(), 15, 'one keyboard point per posted transaction');
  const summary = norm(await page.locator('#ov-chart-summary').innerText());
  t.assert(summary.includes('highest at 1,250.00 EXUSD on September 1, 2026') && summary.includes('lowest at 974.00 EXUSD on September 9, 2026') && summary.includes('1,147.50 EXUSD'), 'summary sentence: ' + summary);
  t.eq(await page.locator('[data-ov-pt][tabindex="0"]').count(), 1, 'roving tabindex: one tab stop');
  const svgBox = await page.locator('.ov-chart__svg').boundingBox();
  const plotBox = await page.locator('#ov-chart-plot').boundingBox();
  t.assert(Math.abs(svgBox.width - plotBox.width) <= 2, 'chart drawn at the container width');
  await page.focus('[data-ov-pt="0"]');
  t.assert(await page.locator('.ov-tip').isVisible(), 'tooltip on focus');
  await page.keyboard.press('ArrowRight');
  t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-ov-pt')), '1', 'arrow key moves to the next point');
  t.assert(norm(await page.locator('.ov-tip').innerText()).includes('1,130.00 EXUSD'), 'tooltip shows balance after the second transaction');
  t.assert(norm(await page.locator('[data-ov-pt="1"]').getAttribute('aria-label')).includes('Balance after: 1,130.00 EXUSD'), 'point has a full accessible name');
  const ptLabels = await page.$$eval('[data-ov-pt]', (els) => els.map((e) => e.getAttribute('aria-label')));
  t.eq(ptLabels.filter((l) => /\.\.|•/.test(l)), [], 'point names: no doubled full stop ("Daniel K.."), masked ids spoken, not bullets');
  t.assert(norm(ptLabels[1]).includes('Daniel K. Balance after') && ptLabels.some((l) => /ending in 4821/.test(l)), 'abbreviated name ends the clause once; masked id read as "ending in"');
  t.eq(await axisCollisions(page), [], 'x-axis date labels do not collide');
  const dodge = await page.evaluate(() => {
    // Same-time markers (a movement and its fee) must not sit on top of each other.
    const at = {};
    document.querySelectorAll('.ov-chart__svg .ov-mk').forEach((mk) => {
      const i = +mk.getAttribute('data-i');
      const b = document.querySelector('[data-ov-pt="' + i + '"]');
      const r = mk.getBoundingClientRect();
      const label = b.getAttribute('aria-label');
      const key = label.slice(0, label.indexOf(': ')); // the date and time
      (at[key] = at[key] || []).push(r.left + r.width / 2);
    });
    return Object.values(at)
      .filter((xs) => xs.length > 1)
      .map((xs) => Math.round(Math.abs(xs[1] - xs[0])));
  });
  t.eq(dodge.length, 3, 'three same-time pairs (Sep 9, 12 and 20)');
  t.assert(dodge.every((d) => d >= 6), 'same-time markers are dodged so both show: ' + dodge.join(', '));
  await page.keyboard.press('End');
  t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-ov-pt')), '14', 'End moves to the last point');
  // Previous / Next in the detail follow the chart: every posted transaction, oldest first.
  const chartOrder = await page.evaluate(() => YES.calc.posted().map((x) => x.id));
  await spy(page);
  await page.keyboard.press('Enter');
  t.eq(await calls(page), [{ fn: 'openTx', id: 'TX-260929-1952', fk: 'ov-pt-TX-260929-1952', list: chartOrder }], 'activating a point opens that transaction within the chart’s order');
  if (wide) {
    const pt = await page.locator('[data-ov-pt="3"]').boundingBox();
    await page.mouse.move(pt.x + pt.width / 2 + 3, pt.y + 40);
    await page.waitForTimeout(50);
    t.assert(await page.locator('.ov-cross').isVisible(), 'crosshair on hover');
    t.assert(norm(await page.locator('.ov-tip').innerText()).includes('975.00 EXUSD'), 'hover snaps to the nearest transaction (movement before its fee)');
    t.assert(norm(await page.locator('.ov-tip').innerText()).includes('+1 more at the same time'), 'tooltip notes same-time transactions');
    await shot(t, 'chart-hover');
    await page.mouse.click(pt.x + pt.width / 2 + 3, pt.y + 40);
    const plotCall = (await calls(page))[0];
    t.eq([plotCall.id, plotCall.list], ['TX-260909-2051', chartOrder], 'clicking the plot opens the nearest transaction, within the chart’s order');
    await page.mouse.move(5, 5);
  }
  await page.click('[data-fk="ov-ctable"]');
  const crow = await page.$$eval('.ov-ctable tbody tr', (rows) => rows.length);
  t.eq(crow, 16, 'chart table: opening row + 15 posted rows');
  await page.click('.ov-ctable [data-ov-tx="TX-260912-0806"]');
  const tableCall = (await calls(page))[0];
  t.eq([tableCall.id, tableCall.list], ['TX-260912-0806', chartOrder], 'table rows open their transaction, within the same order');
  await page.click('[data-fk="ov-chart-explain"]');
  t.eq((await calls(page))[0], { fn: 'assistant', topic: 'chart', id: null }, 'chart Explain with AI');

  t.step('fees and insight');
  const fees = norm(await page.locator('.ov-fees').innerText());
  t.assert(fees.includes('−2.50 EXUSD') && fees.includes('3 fees') && fees.includes('Fees in other assets: none'), 'fees summary: ' + fees);
  t.eq(await page.locator('.ov-fees [data-ov-tx]').count(), 3, 'three fee lines');
  const feeIds = await page.$$eval('.ov-fees [data-ov-tx]', (els) => els.map((e) => e.getAttribute('data-ov-tx')));
  await page.click(`.ov-fees [data-ov-tx="${feeIds[1]}"]`);
  t.eq((await calls(page))[0], { fn: 'openTx', id: feeIds[1], fk: 'ov-fee-' + feeIds[1], list: feeIds }, 'a fee line opens within the fee lines');
  await page.click('[data-fk="ov-fees-explain"]');
  t.eq((await calls(page))[0], { fn: 'assistant', topic: 'fees', id: null }, 'fees Explain with AI');
  const insight = norm(await page.locator('.ov-insight').innerText());
  const largest = await page.evaluate(() => YES.calc.largest().id);
  t.assert(insight.includes('+250.00 EXUSD') && insight.includes('September 1, 2026'), 'insight from calc.largest(): ' + insight);
  t.eq(await page.locator('.ov-insight, .ov-education, [class*="promo"]').count(), 1, 'at most one insight card');
  await page.click('[data-fk="ov-insight-view"]');
  t.eq((await calls(page))[0], { fn: 'openTx', id: largest, fk: 'ov-insight-view', list: null }, 'insight opens the largest transaction (no list of its own)');
  await page.click('[data-fk="ov-insight-learn"]');
  t.eq(await calls(page), [{ fn: 'openTopic', id: 'token_units' }], 'education link opens token units');
  await page.click('[data-fk="ov-fees-show"]');
  t.eq(await page.evaluate(() => YES.state.journeyStep), 'fees', 'Show fees selects the fees step');
  t.eq(await page.evaluate(() => document.activeElement.id), 'ov-panel-title', 'focus moves to the panel heading');
  t.eq(await page.locator('#ov-panel-section [data-ov-tx]').count(), 3, 'three fee rows');

  t.step('order of content');
  const order = await page.evaluate(() => ['.ov-balance', '.ov-journey', '.ov-why', '.ov-video'].map((s) => document.querySelector(s).getBoundingClientRect().top + scrollY));
  t.assert(order[0] < order[1] && order[1] < order[2] && order[2] < order[3], 'balance, journey, why, then video (below essential facts)');

  t.step('selectStep / clearStep API');
  await page.evaluate(() => YES.nav.go('help'));
  await page.evaluate(() => YES.overview.selectStep('redemptions'));
  t.eq(await page.evaluate(() => YES.state.view), 'overview', 'selectStep navigates to Overview');
  t.eq(await page.getAttribute('[data-ov-step="redemptions"]', 'aria-pressed'), 'true', 'step pressed via API');
  t.eq(await page.evaluate(() => document.activeElement.id), 'ov-panel-title', 'API selection focuses the panel heading');
  t.eq(await page.locator('#ov-panel-section [data-ov-tx]').count(), 1, 'one redemption row (the pending one is excluded)');
  t.eq(await page.evaluate(() => YES.overview.selectStep('nope')), false, 'unknown step ignored');
  await page.evaluate(() => YES.overview.clearStep());
  t.eq(await page.evaluate(() => YES.state.journeyStep), null, 'clearStep clears');
  await t.goto('#/overview/deposits');
  t.eq(await page.getAttribute('[data-ov-step="deposits"]', 'aria-pressed'), 'true', 'hash change selects a step');
  await fresh(t, '#/overview/deposits');
  t.eq(await page.getAttribute('[data-ov-step="deposits"]', 'aria-pressed'), 'true', 'deep link selects a step on load');
  t.eq(await page.locator('#ov-panel-section [data-ov-tx]').count(), 3, 'deep-linked panel rows');

  /* ------------------------------------------------------------ layout & a11y */
  t.step('no horizontal scroll');
  await page.evaluate(() => YES.overview.selectStep('outgoing'));
  const ov = await noHorizontalOverflow(page);
  t.assert(ov.scroll, 'page does not scroll horizontally');
  t.eq(ov.offenders, [], 'no element overflows the viewport');

  t.step('axe');
  await settle(page);
  await axeOk(t, '#view-overview', 'overview with selection and tables open');
  await shot(t, 'full', { fullPage: true });

  t.step('touch targets');
  const small = await page.$$eval('#view-overview button:not(.ov-pt):not(.ov-table__tx), #view-overview summary', (els) =>
    els
      .filter((e) => e.getClientRects().length)
      .map((e) => [e.getAttribute('data-fk'), Math.round(e.getBoundingClientRect().height), Math.round(e.getBoundingClientRect().width)])
      .filter((x) => x[1] < 44 || x[2] < 44)
  );
  t.eq(small, [], 'interactive controls are at least 44px');

  /* ------------------------------------------------------------ data branches */
  t.step('low-data branch');
  await page.evaluate(() => {
    window.__orig = YES.data;
    const copy = JSON.parse(JSON.stringify(YES.data));
    const keep = copy.transactions.filter((x) => x.status === 'posted').slice(0, 2);
    copy.transactions = keep;
    copy.statement.closing = keep[keep.length - 1].balanceAfter;
    YES.data = copy;
    YES.set({ journeyStep: null });
    YES.renderAll();
  });
  t.assert(await page.evaluate(() => YES.calc.reconcile().ok), 'low-data copy reconciles');
  t.eq(await page.locator('.ov-chart__svg').count(), 0, 'no chart with fewer than 3 transactions');
  t.eq(await page.locator('.ov-lowlist li').count(), 2, 'simple list instead');
  t.assert(norm(await page.locator('.ov-lowdata').innerText()).includes('With only 2 transactions'), 'low-data explanation');
  t.eq(await page.locator('.jr [data-step]').count(), 7, 'journey still renders');
  t.eq(await page.getAttribute('.jr-eq', 'data-equation'), '1,000.00 + 250.00 + 0.00 − 120.00 + 0.00 + 0.00 = 1,130.00 EXUSD', 'equation follows the data');
  await page.click('[data-ov-step="transfers_in"]');
  t.assert(norm(await page.locator('#ov-panel-section').innerText()).includes('No transactions contributed'), 'empty step explained');
  await shot(t, 'low-data');

  t.step('mismatch branch: exception instead of journey');
  await page.evaluate(() => {
    YES.data = YES.calc.simulateMismatch(window.__orig);
    YES.set({ journeyStep: null });
    YES.renderAll();
  });
  t.eq(await page.locator('.jr').count(), 0, 'no journey drawn for a non-reconciling statement');
  t.eq(await page.locator('.ov-chart__svg').count(), 0, 'no chart either');
  t.assert(norm(await page.locator('.ov-exception').innerText()).includes('can’t be shown'), 'exception message shown');
  t.eq(await page.locator('.ov-exception[role="alert"]').count(), 1, 'exception is announced');
  await page.evaluate(() => {
    YES.data = window.__orig;
    YES.renderAll();
  });
  t.eq(await page.locator('.jr [data-step]').count(), 7, 'journey restored');

  /* ------------------------------------------------------------ motion & dark */
  t.step('reduced motion');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fresh(t, '#/overview');
  t.assert(await page.evaluate(() => YES.ui.reducedMotion()), 'reduced motion detected');
  await page.click('[data-ov-step="deposits"]');
  t.eq(await page.locator('#ov-panel-section.is-anim, .jr-step.is-anim').count(), 0, 'no selection animation under reduced motion');
  t.eq(await page.locator('#ov-panel-section [data-ov-tx]').count(), 3, 'content identical without motion');
  const anims = await page.evaluate(() => document.getAnimations().filter((a) => a.effect && a.effect.getTiming().duration > 1).length);
  t.eq(anims, 0, 'no running animations');

  t.step('runtime warnings');
  t.eq(warnings, [], 'no missing i18n keys or overview warnings at runtime');

  /* ------------------------------------------------------------ light / dark */
  // The theme is the device setting until the visitor chooses (masthead toggle,
  // or the phone Menu); a choice wins on any device, and print is always light.
  t.step('light colour scheme: a light device, no choice (the reference)');
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await fresh(t, '#/overview/transfers_out');
  t.eq(await page.evaluate(() => [YES.theme.get(), YES.theme.effective()]), [null, 'light'], 'no choice: follows the light device');
  const p0 = await stageFacts(page);
  t.assert(p0.contrast >= 4.5 && p0.bg > 0.05, 'light video stage: the brand colour (luminance ' + p0.bg + ') with readable text (' + p0.contrast + ')');
  const lightPaint = await paints(page);
  t.assert(followsTokens(lightPaint), 'light: card, hero, journey bars, chart line, markers and grid follow the tokens: ' + JSON.stringify(lightPaint));

  t.step('dark colour scheme: a dark device, no choice');
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await fresh(t, '#/overview/transfers_out');
  t.eq(await page.evaluate(() => [YES.theme.get(), YES.theme.effective()]), [null, 'dark'], 'no choice: follows the dark device');
  await axeOk(t, '#view-overview', 'dark scheme');
  const pd = await stageFacts(page);
  t.assert(pd.contrast >= 4.5 && pd.bg < 0.2, 'dark video stage stays deep (luminance ' + pd.bg + ') with readable text (' + pd.contrast + ')');
  t.assert(pd.bg !== p0.bg && pd.contrast !== p0.contrast, `the dark stage differs from the light one (luminance ${pd.bg} vs ${p0.bg}, contrast ${pd.contrast} vs ${p0.contrast})`);
  const darkPaint = await paints(page);
  t.assert(followsTokens(darkPaint), 'dark: card, hero, journey bars, chart line, markers and grid follow the tokens: ' + JSON.stringify(darkPaint));
  t.assert(['card', 'hero', 'bar', 'line', 'marker'].every((k) => darkPaint[k][0] !== lightPaint[k][0]), 'and they are the dark colours, not the light ones');
  await shot(t, 'dark');
  if (wide) {
    await page.evaluate(() => document.getElementById('ov-why-title').scrollIntoView());
    await shot(t, 'dark-why');
  }

  t.step('light choice on a dark device: the light video stage, journey and chart, live');
  const chartEl = await page.evaluate(() => (window.__chart = document.querySelector('.ov-chart__svg')) && true);
  await page.evaluate(() => YES.theme.set('light'));
  t.eq(await page.evaluate(() => [YES.theme.effective(), document.documentElement.getAttribute('data-theme')]), ['light', 'light'], 'light chosen on a dark device');
  const lp = await stageFacts(page);
  t.eq([lp.bg, lp.contrast], [p0.bg, p0.contrast], 'the video stage is the light one (as on a light device), not the dark one');
  t.eq(await paints(page), lightPaint, 'every overview colour is the light one');
  t.assert(chartEl && (await page.evaluate(() => document.querySelector('.ov-chart__svg') === window.__chart)), 'the chart recolours through its tokens, without being redrawn');
  await axeOk(t, '#view-overview', 'light choice on a dark device');
  await shot(t, 'light-choice-dark-device', { fullPage: false });

  t.step('dark choice on a light device (the masthead toggle): dark live, after a reload and in the video');
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  if (await phoneMenu(page)) {
    await page.click('#masthead [data-mast-menu]');
    await page.click('#mast-menu [data-theme-toggle]');
    await page.keyboard.press('Escape');
  } else {
    await page.click('#masthead .mast-wide [data-theme-toggle]');
  }
  t.eq(await page.evaluate(() => [YES.theme.get(), YES.theme.effective()]), ['dark', 'dark'], 'the toggle records a dark choice');
  const dl = await stageFacts(page);
  t.eq([dl.bg, dl.contrast], [pd.bg, pd.contrast], 'the video stage is the dark one, as on a dark device');
  t.eq(await paints(page), darkPaint, 'every overview colour is the dark one, as on a dark device');
  await fresh(t, '#/overview/transfers_out');
  t.eq(await page.evaluate(() => YES.theme.effective()), 'dark', 'the choice survives a reload');
  t.eq(await paints(page), darkPaint, 'and the overview is dark from the first paint after it');
  await page.evaluate(() => YES.overview.video.seek(22.5));
  await page.evaluate(() => document.querySelector('.ov-video').scrollIntoView({ block: 'center' }));
  await axeOk(t, '.ov-video', 'video card, dark choice');
  await shot(t, 'dark-video', { fullPage: false });

  t.step('print is always light, even with a dark choice on a dark device');
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark', media: 'print' });
  t.eq(await page.evaluate(() => document.querySelector('.vp').getClientRects().length), 0, 'print: the player is not printed (the statement of record is)');
  // 90-print.css sets its own paper ink and surfaces; the data marks keep the light tokens.
  const printPaint = await paints(page);
  const marks = (p) => ['bar', 'line', 'marker', 'grid'].map((k) => p[k][0]);
  t.assert(followsTokens(printPaint), 'print: the overview follows the print tokens: ' + JSON.stringify(printPaint));
  t.eq(marks(printPaint), marks(lightPaint), 'print: journey and chart marks in the light colours, not the dark ones');
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light', media: 'screen' });
  await page.evaluate(() => YES.theme.set(null));
  t.eq(await page.evaluate(() => [YES.theme.get(), YES.theme.effective()]), [null, 'light'], 'choice cleared: follows the device again');
  /* ------------------------------------------------------------ history */
  t.step('browser Back clears the selection instead of leaving the statement');
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto('about:blank');
  await t.goto('#/overview');
  const len0 = await page.evaluate(() => history.length);
  await page.click('[data-ov-step="transfers_out"]');
  await page.click('[data-ov-step="deposits"]');
  t.eq(await page.evaluate(() => [location.hash, history.length]), ['#/overview/deposits', len0 + 1], 'one entry for the selection; moving between steps replaces it');
  await page.goBack();
  await page.waitForFunction(() => YES.state.journeyStep === null);
  t.eq(
    await page.evaluate(() => [location.protocol, location.hash, YES.state.view, YES.state.filters.step, !!document.getElementById('ov-panel-section')]),
    ['file:', '#/overview', 'overview', null, false],
    'Back restores the full journey and the full ledger, still inside the statement'
  );
  await page.waitForFunction(() => /Selection cleared/.test(document.getElementById('live-polite').textContent));
  await page.goForward();
  await page.waitForFunction(() => YES.state.journeyStep === 'deposits');
  await page.waitForFunction(() => /Deposits selected/.test(document.getElementById('live-polite').textContent));
  t.eq(await page.evaluate(() => YES.state.filters.step), 'deposits', 'Forward selects the step again (and filters again)');
  await page.click('[data-ov-clear]');
  await page.waitForFunction(() => location.hash === '#/overview');
  t.eq(await page.evaluate(() => history.length), len0 + 1, 'Clear steps back through the same entry, so history does not grow');
  t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-fk')), 'ov-step-deposits', 'focus returns to the step');
  await page.click('[data-ov-step="fees"]');
  await navTo(page, 'transactions');
  await page.goBack();
  await page.waitForFunction(() => YES.state.view === 'overview');
  t.eq(await page.evaluate(() => YES.state.journeyStep), 'fees', 'Back from Transactions returns to the selected step');
  await page.goBack();
  await page.waitForFunction(() => YES.state.journeyStep === null);
  t.eq(await page.evaluate(() => location.protocol), 'file:', 'and the next Back returns to the full journey');

  /* ------------------------------------------------------------ text spacing */
  t.step('WCAG 1.4.12 text spacing');
  await fresh(t, '#/overview');
  await page.addStyleTag({
    content: '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }'
  });
  await page.waitForTimeout(150);
  const hidden = await page.evaluate(() =>
    [...document.querySelectorAll('.jr-sub')]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        const plot = e.closest('.jr-step').querySelector('.jr-plot').getBoundingClientRect();
        const underBar = r.right > plot.left + 0.5 && r.left < plot.right - 0.5 && r.bottom > plot.top + 0.5 && r.top < plot.bottom - 0.5;
        return e.scrollWidth > e.clientWidth + 1 || underBar;
      })
      .map((e) => e.textContent)
  );
  t.eq(hidden, [], 'step counts wrap instead of running under the bar');

  /* ------------------------------------------------------------ forced colours */
  t.step('forced colours: the legend matches the bars');
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark', forcedColors: 'active' });
  await fresh(t, '#/overview');
  const paint = (sel) =>
    page.evaluate((s) => {
      const cs = getComputedStyle(document.querySelector(s));
      return cs.backgroundImage !== 'none' ? 'stripes' : cs.backgroundColor;
    }, sel);
  const keys = { in: await paint('.ov-key--in'), out: await paint('.ov-key--out'), total: await paint('.ov-key--total') };
  const bars = { in: await paint('.jr-step--in .jr-bar'), out: await paint('.jr-step--out .jr-bar'), total: await paint('.jr-step--total .jr-bar') };
  t.eq(bars, keys, 'each bar looks like its legend key');
  t.eq(new Set(Object.values(keys)).size, 3, 'adds, reduces and balance are three different marks');
  t.eq(keys.out, 'stripes', 'reduces is a pattern, not only a colour');
  await page.click('[data-ov-step="transfers_out"]');
  const dim = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.jr-step.is-dim .jr-bar'));
    return { opacity: cs.opacity, outline: /inset/.test(cs.boxShadow) };
  });
  t.eq(dim, { opacity: '1', outline: true }, 'receding steps stay visible as outlines');
  await shot(t, 'forced-colors');
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light', forcedColors: 'none' });

  /* ------------------------------------------------------------ 200% text */
  t.step('WCAG 1.4.4 / 1.4.10: 200% text reflows (no sideways scroll, nothing clipped or colliding)');
  for (const lang of ['en', 'es']) {
    await fresh(t, '#/overview/transfers_out');
    if (lang === 'es') await switchLang(page, 'es');
    await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
    await page.waitForTimeout(250); // container queries, resize observer, rAF
    const f = await reflowFacts(page);
    t.eq([f.scroll, f.out, f.collide, f.clipped], [true, [], [], []], `200% text, ${lang}: no sideways scroll, nothing past the edge, no collisions, no clipped list items`);
    const hero = await page.evaluate(() => {
      const num = document.querySelector('.ov-hero__num');
      const r = num.getBoundingClientRect();
      const col = document.querySelector('.ov-balance__main').getBoundingClientRect();
      return { fits: r.right <= col.right + 0.5, size: parseFloat(getComputedStyle(num).fontSize), body: parseFloat(getComputedStyle(document.body).fontSize) };
    });
    t.assert(hero.fits && hero.size >= hero.body * 1.5, `200% text, ${lang}: the closing balance fits its column and stays the largest figure (${hero.size}px, body ${hero.body}px)`);
    const L = await journeyLayout(page);
    t.eq([L.overlaps, L.spill], [[], []], `200% text, ${lang}: journey values neither collide nor spill (${L.width}px column, ${L.layout})`);
    await page.evaluate(() => document.querySelector('.jr-group[data-group="outgoing"]').scrollIntoView());
    await shot(t, 'text-200-' + lang, { fullPage: false });
    await page.evaluate(() => document.querySelector('.ov-video').scrollIntoView());
    await shot(t, 'text-200-video-' + lang, { fullPage: false });
    await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
  }
  await switchLang(page, 'en');
  t.step('at 100% the hero keeps its design size');
  const hero100 = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.ov-hero__num')).fontSize));
  t.assert(hero100 >= 48, 'hero figure ≥48px at 100% text (got ' + hero100 + ')');

  /* ------------------------------------------------------------ container layout */
  if (wide) {
    t.step('journey and balance card lay out for the width they have (docked assistant, narrow windows)');
    const cases = [
      [1100, true, 'en'],
      [1280, true, 'en'],
      [1280, true, 'es'],
      [1440, true, 'en'],
      [900, false, 'en'],
      [900, false, 'es'],
      [1024, false, 'es'],
      [860, false, 'en'],
      [800, false, 'es'],
      [768, false, 'en'],
      [720, false, 'es']
    ];
    for (const [w, docked, lang] of cases) {
      await page.setViewportSize({ width: w, height: 900 });
      await fresh(t, '#/overview/transfers_out');
      if (lang === 'es') await switchLang(page, 'es');
      await page.evaluate((d) => document.documentElement.classList.toggle('assistant-docked', d), docked);
      await page.waitForTimeout(200); // resize observer + rAF
      const L = await journeyLayout(page);
      const where = `${w}px${docked ? ' docked' : ''} ${lang} (${L.width}px column, ${L.layout})`;
      t.eq([L.broken, L.overlaps, L.spill], [[], [], []], 'no broken labels, collisions or spills at ' + where);
      if (L.layout === 'waterfall') t.eq(L.valueRows, 1, 'one value baseline at ' + where);
      t.eq(L.layout, L.width >= 880 ? 'waterfall' : 'list', 'the waterfall only when its column can hold it at ' + where);
      const placed = await page.evaluate(() => (document.getElementById('ov-panel').parentElement.classList.contains('jr') ? 'list' : 'waterfall'));
      t.eq(placed, L.layout, 'the panel sits where the layout puts it at ' + where);
      const card = await page.evaluate(() => {
        const inside = (sel, outer) => [...document.querySelectorAll(sel)].every((e) => e.getBoundingClientRect().right <= outer.right + 0.5);
        const box = document.querySelector('.ov-balance').getBoundingClientRect();
        const side = document.querySelector('.ov-balance__side').getBoundingClientRect();
        return inside('.ov-hero > :not(.sr-only), .ov-notin__actions .btn, .ov-fiat__line', box) && inside('.ov-change__value > *, .ov-actions .btn', side);
      });
      t.assert(card, 'balance card figures and actions stay inside the card at ' + where);
      t.eq(await axisCollisions(page), [], 'chart axis labels do not collide at ' + where);
    }
    t.step('the narrowest waterfall (a 55rem column) keeps every label whole');
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const lang of ['en', 'es']) {
      await fresh(t, '#/overview/transfers_out');
      if (lang === 'es') await switchLang(page, 'es');
      await page.evaluate(() => (document.getElementById('ov-journey-body').style.width = '55rem'));
      await page.waitForTimeout(200);
      const L = await journeyLayout(page);
      // spill: a label wider than its step's column would run into the next step.
      t.eq([L.layout, L.broken, L.overlaps, L.spill, L.valueRows], ['waterfall', [], [], [], 1], `${lang}, ${L.width}px column: no broken labels, collisions or spills`);
      if (lang === 'es') {
        await page.evaluate(() => document.getElementById('ov-journey-title').scrollIntoView());
        await shot(t, 'waterfall-narrowest-es', { fullPage: false });
      }
    }

    t.step('docking while the panel has focus keeps focus');
    await page.setViewportSize({ width: 1280, height: 900 });
    await fresh(t, '#/overview/transfers_out');
    await page.focus('[data-fk="ov-panel-clear"]');
    await page.evaluate(() => document.documentElement.classList.add('assistant-docked'));
    await page.waitForFunction(() => document.getElementById('ov-panel').parentElement.classList.contains('jr'));
    t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-fk')), 'ov-panel-clear', 'focus stays on the same control when the panel moves');
    await shot(t, 'docked-list');
    await page.evaluate(() => document.documentElement.classList.remove('assistant-docked'));
    await page.waitForFunction(() => !document.getElementById('ov-panel').parentElement.classList.contains('jr'));
    t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-fk')), 'ov-panel-clear', 'and when it moves back below the waterfall');
  }

  /* ------------------------------------------------------------ video */
  // Last: it installs a page clock and a voice stub for the rest of the page's life.
  await videoSuite(t);
}

/* ====================================================================== */
/* "Your statement in 60 seconds": the animated, narrated player          */
/* ====================================================================== */
const SCREENS = fileURLToPath(new URL('../test-results/screens/', import.meta.url));

/**
 * Device voice stub (speechSynthesis): records what is spoken, in which
 * language and voice, and every cancel; an utterance ends 40 ms after it
 * starts. sessionStorage 'ovtest.tts' picks 'voices' (en-US and es-ES, local),
 * 'remote' (network voices only) or 'none' (the device has no voice). Full
 * screen requests are recorded.
 */
const TTS_STUB = `(() => {
  const mode = sessionStorage.getItem('ovtest.tts');
  if (!mode) return;
  window.__tts = { spoken: [], cancels: 0 };
  const voices = mode === 'none' ? [] : mode === 'remote' ? [
    { name: 'Stub Online English', lang: 'en-US', localService: false, default: true, voiceURI: 'stub-online-en' },
    { name: 'Stub Online Español', lang: 'es-ES', localService: false, default: false, voiceURI: 'stub-online-es' }
  ] : [
    { name: 'Stub English (remote)', lang: 'en-GB', localService: false, default: false, voiceURI: 'stub-en-gb' },
    { name: 'Stub English', lang: 'en-US', localService: true, default: true, voiceURI: 'stub-en' },
    { name: 'Stub Español', lang: 'es-ES', localService: true, default: false, voiceURI: 'stub-es' }
  ];
  class Utterance {
    constructor(text) { this.text = text; this.lang = ''; this.voice = null; this.rate = 1; this.pitch = 1; this.volume = 1; this.onend = null; this.onerror = null; }
  }
  const synth = {
    speaking: false, pending: false, paused: false,
    getVoices: () => voices.slice(),
    speak(u) {
      __tts.spoken.push({ text: u.text, lang: u.lang, voice: u.voice ? u.voice.name : null });
      synth.speaking = true;
      setTimeout(() => { synth.speaking = false; if (u.onend) u.onend({}); }, 40);
    },
    cancel() { __tts.cancels++; synth.speaking = false; },
    pause() {}, resume() {}, addEventListener() {}, removeEventListener() {}
  };
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utterance, configurable: true, writable: true });
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.__fs = [];
  Element.prototype.requestFullscreen = function () { window.__fs.push(String(this.className)); return Promise.resolve(); };
  Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => true, configurable: true });
})();`;

/** Spoken words in a sentence, numbers read in full ("1147.5" → one thousand one hundred forty-seven point five). */
function spokenWords(say) {
  let n = 0;
  for (const tok of say.split(/\s+/).filter(Boolean)) {
    const m = tok.match(/^(\d+)(?:[.,](\d+))?/);
    if (!m) {
      n += 1;
      continue;
    }
    const int = m[1];
    const dec = m[2] || '';
    if (int.length === 4 && /^(19|20)/.test(int) && !dec) {
      n += 3;
      continue;
    }
    const v = +int;
    let w = (v >= 1000 ? 2 : 0) + (Math.floor(v / 100) % 10 ? 2 : 0) + (v % 100 ? 2 : 0) || 1;
    if (dec) w += 1 + dec.length;
    n += w;
  }
  return n;
}

const vstate = (page) => page.evaluate(() => YES.overview.video.state());
const said = (page) => page.evaluate(() => window.__tts.spoken.map((x) => x.text));
const cancels = (page) => page.evaluate(() => window.__tts.cancels);
const caption = (page) =>
  page.evaluate(() => {
    const cc = document.querySelector('[data-vp-cc]');
    return cc && !cc.hidden && cc.getClientRects().length ? cc.textContent.replace(/ /g, ' ') : null;
  });
const runFor = (page, ms) => page.clock.runFor(ms);
/** Stop the page clock a moment from now (time is then advanced only by runFor). */
async function holdClock(page, ahead = 300) {
  for (const ms of [ahead, ahead + 1000, ahead + 3000]) {
    try {
      await page.clock.pauseAt(await page.evaluate(() => Date.now()) + ms);
      break;
    } catch (e) {
      if (!/past/.test(String(e && e.message))) throw e;
    }
  }
  // After a long task in the page (an axe scan) the pause can take effect a
  // little after pauseAt() returns, while the clock still runs: wait until the
  // page clock really stands still, so nothing moves between two steps.
  let prev = await page.evaluate(() => Date.now());
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(50);
    const cur = await page.evaluate(() => Date.now());
    if (cur === prev) return;
    prev = cur;
  }
}
/** axe-core needs real timers: let the page clock run for the scan, then hold it again. */
async function axeLive(t, sel, label) {
  await t.page.clock.resume();
  try {
    await axeOk(t, sel, label);
  } finally {
    await holdClock(t.page);
  }
}

/** Language and section changes without page.waitForFunction (the page clock is paused). */
async function langNow(page, lang) {
  if (await phoneMenu(page)) {
    await page.click('#masthead [data-mast-menu]');
    await page.click(`#mast-menu [data-lang="${lang}"]`);
    await page.keyboard.press('Escape');
  } else await page.click(`#masthead .mast-wide [data-lang="${lang}"]`);
  return page.evaluate(() => YES.i18n.lang);
}
async function viewNow(page, view) {
  if (await phoneMenu(page)) {
    await page.click('#masthead [data-mast-menu]');
    await page.click(`#mast-menu [data-nav="${view}"]`);
  } else await page.click(`.nav__link[data-nav="${view}"]`);
  return page.evaluate(() => YES.state.view);
}

/** One frame of the picture, for review. */
async function frameShot(t, name) {
  await t.page.locator('.vp').screenshot({ path: SCREENS + `overview-${t.viewport}-video-${name}.png` });
}
/** The chapters' frames: greeting, balance, largest movement, the detail of a transaction, help. */
const CHAPTER_FRAMES = [5, 23, 33.5, 44.4, 53.5];
async function chapterShots(t, tag) {
  if (t.viewport === 'narrow') return;
  for (let i = 0; i < CHAPTER_FRAMES.length; i++) {
    await t.page.evaluate((s) => YES.overview.video.seek(s), CHAPTER_FRAMES[i]);
    await frameShot(t, `${tag}-ch${i + 1}`);
  }
}

async function videoSuite(t) {
  const { page } = t;
  const wide = t.viewport === 'desktop';
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light', forcedColors: 'none', media: 'screen' });
  await page.evaluate(() => {
    YES.theme.set(null);
    sessionStorage.setItem('yes.lang', 'en');
    sessionStorage.setItem('ovtest.tts', 'voices');
  });
  await page.addInitScript(TTS_STUB);
  await page.clock.install();
  await fresh(t, '#/overview');
  await page.locator('.ov-video').scrollIntoViewIfNeeded();
  await holdClock(page, 500);

  /* -------------------------------------------------- the card and poster */
  t.step('video: a player in the card, never playing on its own');
  t.eq(await page.locator('#view-overview video, #view-overview [autoplay], #view-overview iframe').count(), 0, 'no media file, iframe or autoplay');
  await runFor(page, 5000);
  let st = await vstate(page);
  t.eq([st.playing, st.started, st.t, st.duration], [false, false, 0, 60], 'five seconds after load it is still the poster');
  t.eq(await said(page), [], 'nothing is spoken before Play');
  t.eq(await page.locator('.vp-bar').isVisible(), false, 'the poster has no control bar, only Play');
  const card = norm(await page.locator('.ov-video').innerText());
  for (const s of ['Your statement in 60 seconds', 'Duration 1:00', 'it never plays on its own', 'Illustrative', 'built from this statement’s sample figures', 'device’s built-in voice'])
    t.assert(card.includes(s), 'card says: ' + s);
  t.eq(await page.locator('.ov-video .tag--illustrative').count(), 1, 'the card keeps an Illustrative tag');
  t.eq(await page.locator('[data-vp-note]').isVisible(), false, 'a voice is available: no voiceover note');
  t.eq(
    await page.evaluate(() => {
      const p = document.querySelector('[data-vp-player]');
      return [p.getAttribute('role'), p.getAttribute('aria-label'), p.querySelector('.vp-stage').getAttribute('aria-hidden'), document.querySelector('.vp-big').getAttribute('aria-label')];
    }),
    ['region', 'Video player: Your statement in 60 seconds', 'true', 'Play video: Your statement in 60 seconds (1:00)'],
    'a labelled region; the picture is hidden from assistive technology; a named Play'
  );
  const chapters = await page.$$eval('[data-vp-ch]', (bs) => bs.map((b) => [b.querySelector('.ov-vchap__name').textContent, b.querySelector('.ov-vchap__time').textContent]));
  t.eq(
    chapters,
    [
      ['Personal greeting', '0:00'],
      ['Opening and closing balance', '0:06'],
      ['Largest meaningful movement', '0:24'],
      ['How to inspect a transaction', '0:35'],
      ['Where to get help', '0:50']
    ],
    'five chapters, in storyboard order, with their times'
  );
  const cues = await page.evaluate(() => YES.overview.video.cues());
  t.eq(await page.locator('[data-vp-cue]').count(), cues.length, 'the transcript has every caption cue');
  t.eq(norm(await page.locator('[data-vp-cue="0"]').textContent()), '0:00Hello, Sam.', 'transcript lines carry their time');
  const clear = await page.evaluate(() => {
    const b = document.querySelector('.vp-big').getBoundingClientRect();
    return [...document.querySelectorAll('.vs-greet__hello, .vs-greet__sub, .vs-greet__agenda')]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.left < b.right && b.left < r.right && r.top < b.bottom && b.top < r.bottom;
      })
      .map((e) => e.className);
  });
  t.eq(clear, [], 'the big Play covers none of the greeting');
  await t.shot('video-poster');

  t.step('video: every caption window holds its sentence at about 2.5 words a second, in English and Spanish');
  const tight = (list) => list.filter((c) => spokenWords(c.say) / 2.5 > c.end - c.at + 1e-6).map((c) => c.id + ' ' + c.say);
  t.eq(tight(cues), [], 'English cues fit their windows');
  t.eq(cues.filter((c) => /EXUSD/.test(c.say)).map((c) => c.id), [], 'the voice never spells the symbol');
  t.eq(
    cues.map((c) => c.end > c.at && c.end <= 60),
    cues.map(() => true),
    'cue windows are ordered and inside the video'
  );

  t.step('video: every figure from the same snapshot');
  const fig = await page.evaluate(() => {
    const a = (m, s) => YES.fmt.amount(m, { sign: s || 'auto' });
    const sx = YES.data.statement;
    const g = YES.calc.groups();
    const big = YES.calc.largest();
    return { opening: a(sx.opening), closing: a(sx.closing), inc: a(Math.abs(g.incoming.total)), out: a(Math.abs(g.outgoing.total)), big: a(big.amount, 'always'), bigDate: YES.fmt.date(big.postedAt, 'long'), period: YES.fmt.range(sx.periodStart, sx.periodEnd) };
  });
  const byId = Object.fromEntries(cues.map((c) => [c.id, c]));
  t.eq([norm(fig.opening), norm(fig.inc), norm(fig.out), norm(fig.closing), norm(fig.big)], ['1,000.00 EXUSD', '700.00 EXUSD', '552.50 EXUSD', '1,147.50 EXUSD', '+250.00 EXUSD'], 'YES.calc figures');
  t.eq(
    ['hello', 'period', 'opening', 'incoming', 'outgoing', 'closing', 'largest', 'what'].map((k) => norm(byId[k].text)),
    [
      'Hello, Sam.',
      'This is your YES statement for ' + norm(fig.period) + '.',
      'You started the period with ' + norm(fig.opening) + '.',
      'Incoming activity added ' + norm(fig.inc) + '.',
      'Outgoing activity and fees took away ' + norm(fig.out) + '.',
      'You closed the period with ' + norm(fig.closing) + '.',
      'Your largest single movement was ' + norm(fig.big) + '.',
      'Deposit from linked bank account, posted on ' + fig.bigDate + '.'
    ],
    'captions: greeting, period, opening → incoming → outgoing → closing, the largest movement (calc.largest)'
  );
  t.eq(
    ['period', 'opening', 'outgoing', 'closing', 'largest'].map((k) => byId[k].say),
    [
      'This is your YES statement for September 2026.',
      'You started the period with 1000 tokens.',
      'Outgoing activity and fees took away 552.5.',
      'You closed the period with 1147.5 tokens.',
      'Your largest single movement added 250 tokens.'
    ],
    'the voice reads figures naturally ("tokens", no grouping or trailing zeros)'
  );
  await page.evaluate(() => YES.overview.video.seek(23));
  const bal = norm(await page.locator('.vs-bal__card').innerText());
  t.assert(['1,000.00', '+700.00', '−552.50', '1,147.50 EXUSD', '+147.50 EXUSD'].every((x) => bal.includes(x)), 'the balance chapter draws the same figures: ' + bal);
  await page.evaluate(() => YES.overview.video.seek(33.5));
  const big = norm(await page.locator('.vs-big__tx').innerText());
  t.assert(big.includes('+250.00') && big.includes('Deposit from linked bank account') && big.includes('Sep 1, 2026') && big.includes('REF-D7K2-9QW4'), 'the largest movement card: ' + big);
  const panelOpacity = (sec) =>
    page.evaluate((x) => {
      YES.overview.video.seek(x);
      return +getComputedStyle(document.querySelector('.vs-app__panel')).opacity;
    }, sec);
  t.eq([await panelOpacity(42), await panelOpacity(44.4)], [1, 0], 'the step’s list fades out under the transaction detail (no text shows through it)');
  await page.evaluate(() => YES.overview.video.seek(44.4));
  const sheet = norm(await page.locator('.vs-sheet').innerText());
  t.assert(sheet.includes('Deposit by debit card') && sheet.includes('+100.00 EXUSD') && sheet.includes('REF-C6V3-1KE7') && sheet.includes('−0.50 EXUSD') && sheet.includes('Explain with AI') && sheet.includes('Ask about this transaction'), 'the walkthrough opens a real transaction with its fee: ' + sheet);
  await page.evaluate(() => YES.overview.video.seek(0));
  t.eq(await said(page), [], 'seeking while paused speaks nothing');

  /* -------------------------------------------------------------- play */
  t.step('video: Play starts the picture and the voice');
  await page.evaluate(() => YES.overview.video.pause());
  await page.clock.resume();
  await fresh(t, '#/overview'); // back to the poster
  await holdClock(page, 500);
  await page.locator('.vp-big').click();
  st = await vstate(page);
  t.eq([st.playing, st.started, st.cue], [true, true, 0], 'playing from the start');
  t.eq(await page.evaluate(() => window.__tts.spoken[0]), { text: 'Hello, Sam.', lang: 'en-US', voice: 'Stub English' }, 'the greeting is spoken at once, with the first name, in a local en-US voice');
  t.eq(await page.evaluate(() => document.activeElement.getAttribute('data-fk')), 'vp-toggle', 'focus moves from the big Play to Pause');
  t.eq(await page.getAttribute('[data-fk="vp-toggle"]', 'aria-label'), 'Pause', 'the bar button pauses');
  // Keyboard order follows the bar as it is seen: on a wide player left to right
  // (Play, Mute, the slider, CC, Full screen); on a narrow one the slider row sits above.
  const barOrder = await page.evaluate(() => [...document.querySelectorAll('.vp-bar [data-fk]')].map((e) => [e.getAttribute('data-fk'), e.getBoundingClientRect().left]));
  t.eq(barOrder.map((x) => x[0]), ['vp-toggle', 'vp-mute', 'vp-seek', 'vp-cc', 'vp-fs'], 'bar controls in reading order');
  if (wide) t.assert(barOrder.every((x, i) => i === 0 || x[1] > barOrder[i - 1][1]), 'on a wide player the Tab order runs left to right: ' + JSON.stringify(barOrder));
  t.eq(await page.getAttribute('[data-fk="vp-cc"]', 'aria-pressed'), 'true', 'captions are on by default');
  t.eq(await caption(page), 'Hello, Sam.', 'the caption shows the cue');
  await runFor(page, 2500);
  st = await vstate(page);
  t.assert(Math.abs(st.t - 2.5) < 0.1, 'the playhead follows the clock (2.5 s): ' + st.t);
  t.eq((await said(page))[1], 'This is your YES statement for September 2026.', 'the next cue is spoken when the playhead reaches it');
  t.eq(await caption(page), 'This is your YES statement for ' + norm(fig.period) + '.', 'its caption');
  t.eq([await page.getAttribute('[data-vp-cue="1"]', 'aria-current'), await page.getAttribute('[data-vp-ch="0"]', 'aria-current')], ['true', 'true'], 'the transcript line and the chapter are marked current');
  t.eq(norm(await page.locator('[data-vp-now]').textContent()), '0:02', 'elapsed time');
  if (wide) await t.shot('video-playing');

  t.step('video: chapters seek and play');
  const chs = await page.evaluate(() => YES.overview.video.chapters());
  for (let i = 1; i < chs.length; i++) {
    await page.click(`[data-vp-ch="${i}"]`);
    st = await vstate(page);
    const first = cues.find((c) => c.at === chs[i].at);
    t.eq([st.t, st.playing, st.chapter], [chs[i].at, true, i], `chapter ${i + 1} plays from ${chs[i].at} s`);
    t.eq((await said(page)).slice(-1)[0], first && first.say, `chapter ${i + 1}: its first sentence is spoken`);
    t.eq(await page.getAttribute(`[data-vp-ch="${i}"]`, 'aria-current'), 'true', `chapter ${i + 1} marked current`);
  }

  t.step('video: Pause stops the voice and the picture');
  await page.click('[data-vp-ch="1"]');
  let c0 = await cancels(page);
  let n0 = (await said(page)).length;
  await page.click('[data-fk="vp-toggle"]');
  st = await vstate(page);
  t.assert(!st.playing && (await cancels(page)) > c0, 'paused, and speechSynthesis.cancel() called');
  await runFor(page, 4000);
  t.eq([(await vstate(page)).t, (await said(page)).length], [st.t, n0], 'nothing moves or speaks while paused');
  t.eq(await page.getAttribute('[data-fk="vp-toggle"]', 'aria-label'), 'Play', 'the button plays again');
  t.eq(await caption(page), norm(byId.opening.text), 'the paused frame keeps its caption');

  t.step('video: a resume reads the cue only from its first 40%');
  await page.evaluate(() => YES.overview.video.seek(13.6)); // outgoing: 13.1–18.2
  n0 = (await said(page)).length;
  await page.click('[data-fk="vp-toggle"]');
  t.eq((await said(page)).slice(n0), [byId.outgoing.say], 'resumed early in a cue: it is read');
  await page.click('[data-fk="vp-toggle"]');
  await page.evaluate(() => YES.overview.video.seek(16.5)); // past 40%
  n0 = (await said(page)).length;
  await page.click('[data-fk="vp-toggle"]');
  t.eq((await said(page)).length, n0, 'resumed late in a cue: the voice waits for the next one');
  await runFor(page, 2000);
  t.eq((await said(page)).slice(n0), [byId.closing.say], '…and reads the next cue when it starts');
  await page.click('[data-fk="vp-toggle"]');

  t.step('video: the seek slider by keyboard');
  const range = page.locator('[data-vp-range]');
  await range.focus();
  const at = async () => [Math.round((await vstate(page)).t * 10) / 10, await range.getAttribute('aria-valuetext')];
  await page.keyboard.press('Home');
  t.eq(await at(), [0, '0:00 of 1:00, chapter 1: Personal greeting'], 'Home');
  await page.keyboard.press('ArrowRight');
  t.eq(await at(), [5, '0:05 of 1:00, chapter 1: Personal greeting'], 'ArrowRight +5 s');
  await page.keyboard.press('PageUp');
  t.eq(await at(), [6.6, '0:06 of 1:00, chapter 2: Opening and closing balance'], 'PageUp: next chapter');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight');
  t.eq(await at(), [16.6, '0:16 of 1:00, chapter 2: Opening and closing balance'], 'ArrowUp / ArrowRight +5 s');
  await page.keyboard.press('PageDown');
  t.eq(await at(), [6.6, '0:06 of 1:00, chapter 2: Opening and closing balance'], 'PageDown: start of this chapter');
  await page.keyboard.press('PageDown');
  t.eq(await at(), [0, '0:00 of 1:00, chapter 1: Personal greeting'], 'PageDown at a chapter start: the previous chapter');
  await page.keyboard.press('PageUp');
  await page.keyboard.press('PageUp');
  t.eq(await at(), [24.5, '0:24 of 1:00, chapter 3: Largest meaningful movement'], 'PageUp twice');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowDown');
  t.eq(await at(), [14.5, '0:14 of 1:00, chapter 2: Opening and closing balance'], 'ArrowLeft / ArrowDown −5 s');
  await page.keyboard.press('End');
  st = await vstate(page);
  t.eq([st.t, st.ended, await range.getAttribute('aria-valuetext')], [60, true, '1:00 of 1:00, chapter 5: Where to get help'], 'End: the end');
  t.eq([await page.getAttribute('.vp-big', 'aria-label'), await page.getAttribute('[data-fk="vp-toggle"]', 'aria-label')], ['Replay video: Your statement in 60 seconds', 'Replay'], 'at the end: Replay');
  t.eq(await page.locator('.vp-big').isVisible(), true, 'the big Replay shows on the last frame');
  t.eq(await caption(page), null, 'no caption on the last frame');
  await page.keyboard.press('Home');
  t.eq((await vstate(page)).ended, false, 'Home leaves the end');

  t.step('video: playing to the end, then Replay');
  await page.evaluate(() => YES.overview.video.seek(58, { play: true }));
  await runFor(page, 2500);
  st = await vstate(page);
  t.eq([st.playing, st.ended, st.t], [false, true, 60], 'it stops at 1:00');
  await page.locator('.vp-big').click();
  st = await vstate(page);
  t.eq([st.playing, st.t], [true, 0], 'Replay plays from the start');
  t.eq((await said(page)).slice(-1)[0], 'Hello, Sam.', 'and greets again');

  t.step('video: captions, mute and full screen');
  await page.click('[data-vp-ch="1"]');
  await page.click('[data-fk="vp-cc"]');
  t.eq([await page.getAttribute('[data-fk="vp-cc"]', 'aria-pressed'), await caption(page)], ['false', null], 'CC off hides the captions');
  await page.keyboard.press('c');
  t.eq([await page.getAttribute('[data-fk="vp-cc"]', 'aria-pressed'), await caption(page)], ['true', norm(byId.opening.text)], 'C turns them back on');
  c0 = await cancels(page);
  await page.click('[data-fk="vp-mute"]');
  t.eq(await page.getAttribute('[data-fk="vp-mute"]', 'aria-pressed'), 'true', 'Mute is pressed');
  t.assert((await cancels(page)) > c0, 'muting stops the voice at once');
  n0 = (await said(page)).length;
  await runFor(page, 5300); // through the start of "incoming" (10.5 s), past its first 40%
  t.eq((await said(page)).length, n0, 'muted: no cue is spoken');
  t.assert((await vstate(page)).playing, 'muted, it keeps playing');
  await page.keyboard.press('m');
  t.eq(await page.getAttribute('[data-fk="vp-mute"]', 'aria-pressed'), 'false', 'M unmutes');
  t.eq((await said(page)).length, n0, 'unmuting late in a cue waits for the next one');
  await runFor(page, 1500); // into "outgoing" (13.1 s)
  t.eq((await said(page)).slice(n0), [byId.outgoing.say], 'unmuted, the next cue is spoken');
  await page.click('[data-fk="vp-fs"]');
  await page.keyboard.press('f');
  const fsCalls = await page.evaluate(() => window.__fs);
  t.assert(fsCalls.length === 2 && fsCalls.every((c) => /(^| )vp( |$)/.test(c)), 'the full-screen button and F ask for full screen on the player: ' + JSON.stringify(fsCalls));
  t.eq(await page.getAttribute('[data-fk="vp-fs"]', 'aria-label'), 'Full screen', 'full screen button named');

  t.step('video: player shortcuts');
  await page.focus('[data-fk="vp-toggle"]');
  let t0 = (await vstate(page)).t;
  await page.keyboard.press('k');
  t.eq((await vstate(page)).playing, false, 'K pauses');
  await page.keyboard.press('l');
  t.eq(Math.round(((await vstate(page)).t - t0) * 10) / 10, 10, 'L: +10 s');
  await page.keyboard.press('j');
  await page.keyboard.press('ArrowRight');
  t.eq(Math.round(((await vstate(page)).t - t0) * 10) / 10, 5, 'J: −10 s, ArrowRight: +5 s');
  await page.keyboard.press('Space');
  t.eq((await vstate(page)).playing, true, 'Space on the focused Play button plays (once)');
  await page.keyboard.press('K');
  t.eq((await vstate(page)).playing, false, 'K again pauses');

  if (wide) {
    t.step('video: the bar fades while playing untouched, and stays for the keyboard');
    await page.evaluate(() => document.activeElement.blur()); // no keyboard focus left in the player
    await page.click('[data-fk="vp-toggle"]');
    const box = await page.locator('.vp-stage').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
    await runFor(page, 3500);
    await page.waitForTimeout(300); // the bar's own fade
    t.eq(await page.evaluate(() => [document.querySelector('.vp').classList.contains('is-idle'), getComputedStyle(document.querySelector('.vp-bar')).opacity]), [true, '0'], 'idle while playing: the bar fades');
    await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 3 + 10);
    await page.waitForTimeout(300);
    t.eq(await page.evaluate(() => getComputedStyle(document.querySelector('.vp-bar')).opacity), '1', 'a pointer move brings it back');
    await page.keyboard.press('Tab'); // keyboard focus inside the player
    await runFor(page, 3500);
    await page.waitForTimeout(300);
    t.eq(await page.evaluate(() => getComputedStyle(document.querySelector('.vp-bar')).opacity), '1', 'with keyboard focus in the player, it stays');
    const capLow = await page.evaluate(() => document.querySelector('.vp-cc').getBoundingClientRect().bottom <= document.querySelector('[data-fk="vp-toggle"]').getBoundingClientRect().top + 1);
    t.assert(capLow, 'captions sit above the shown bar’s controls');
    await page.click('[data-fk="vp-toggle"]');
  }

  /* --------------------------------------------- frames, light, English */
  await chapterShots(t, 'en-light');

  // Scans happen on frames that stay still for a few seconds (the balance
  // chapter once built, the detail of a transaction): the clock runs meanwhile.
  t.step('video: axe, paused and playing (light)');
  await page.evaluate(() => YES.overview.video.seek(20.4));
  await axeLive(t, '.ov-video', 'video paused, light');
  await page.evaluate(() => YES.overview.video.seek(20.4, { play: true }));
  await axeLive(t, '.ov-video', 'video playing, light');

  t.step('video: switching to Spanish while playing pauses, keeps the place and re-renders in Spanish');
  await page.evaluate(() => YES.overview.video.seek(19.2));
  st = await vstate(page);
  t.eq(st.playing, true, 'playing before the switch');
  c0 = await cancels(page);
  t.eq(await langNow(page, 'es'), 'es', 'Spanish');
  const es = await vstate(page);
  // (Playwright's clicks on the phone's Menu advance the held page clock by a frame or two before the switch.)
  t.assert(!es.playing && Math.abs(es.t - st.t) < 0.1 && (await cancels(page)) > c0, `paused at the same place (${st.t} → ${es.t}) and the voice stopped`);
  t.eq(await caption(page), 'Cerraste el período con 1.147,50 EXUSD.', 'the caption is in Spanish, with Spanish figures');
  t.eq(norm(await page.locator('[data-vp-cue="5"] .ov-vtr__text').textContent()), 'Cerraste el período con 1.147,50 EXUSD.', 'the transcript is in Spanish');
  t.eq(await page.$$eval('[data-vp-ch] .ov-vchap__name', (els) => els.map((e) => e.textContent)), ['Saludo personal', 'Saldo inicial y final', 'El movimiento más relevante', 'Cómo revisar un movimiento', 'Dónde obtener ayuda'], 'chapters in Spanish');
  t.eq([await page.getAttribute('[data-fk="vp-toggle"]', 'aria-label'), await page.getAttribute('[data-vp-range]', 'aria-valuetext')], ['Reproducir', '0:19 de 1:00, capítulo 2: Saldo inicial y final'], 'controls in Spanish');
  t.eq(norm(await page.locator('.vs-bal__card .vs-row--closing').innerText()).replace(/\s+/g, ' ').trim(), 'Saldo final 1.147,50 EXUSD', 'the picture is in Spanish');
  const esCues = await page.evaluate(() => YES.overview.video.cues());
  t.eq(tight(esCues), [], 'Spanish cues fit their windows');
  t.eq(esCues.filter((c) => /EXUSD/.test(c.say)).map((c) => c.id), [], 'the Spanish voice never spells the symbol');
  n0 = (await said(page)).length;
  await page.click('[data-fk="vp-toggle"]');
  t.eq(await page.evaluate((n) => window.__tts.spoken.slice(n), n0), [{ text: 'Cerraste el período con 1147,5 unidades de token.', lang: 'es-ES', voice: 'Stub Español' }], 'Play resumes in a Spanish voice');
  await page.click('[data-fk="vp-toggle"]');
  const esClear = await page.evaluate(() => {
    YES.overview.video.seek(0);
    const b = document.querySelector('.vp-big');
    return b.getClientRects().length === 0;
  });
  t.assert(esClear, 'once started, the big Play stays away until the end');
  await chapterShots(t, 'es-light');

  t.step('video: dark scheme (Spanish, then English)');
  await page.evaluate(() => YES.theme.set('dark'));
  await chapterShots(t, 'es-dark');
  await page.evaluate(() => YES.overview.video.seek(44.4));
  await axeLive(t, '.ov-video', 'video paused, dark');
  t.eq(await langNow(page, 'en'), 'en', 'English again');
  await chapterShots(t, 'en-dark');
  await page.evaluate(() => YES.overview.video.seek(20.4, { play: true }));
  await axeLive(t, '.ov-video', 'video playing, dark');
  const ds = await stageFacts(page);
  t.assert(ds.contrast >= 4.5 && ds.bg < 0.2, 'dark stage: deep, with readable text (' + ds.bg + ', ' + ds.contrast + ')');
  await page.evaluate(() => YES.theme.set(null));
  t.eq((await vstate(page)).playing, true, 'a theme switch does not interrupt playback');

  t.step('video: leaving the Overview, or hiding the page, pauses');
  st = await vstate(page);
  c0 = await cancels(page);
  t.eq(await viewNow(page, 'transactions'), 'transactions', 'to Transactions');
  t.assert(!(await vstate(page)).playing && (await cancels(page)) > c0, 'leaving the Overview pauses and silences');
  t.eq(await viewNow(page, 'overview'), 'overview', 'back');
  t.assert(Math.abs((await vstate(page)).t - st.t) < 0.1, 'the playhead is kept');
  await page.evaluate(() => YES.overview.video.play());
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  t.eq((await vstate(page)).playing, false, 'a hidden page pauses');
  await page.evaluate(() => delete document.hidden);
  await page.evaluate(() => YES.overview.video.play());
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  t.eq((await vstate(page)).playing, false, 'leaving the page pauses');

  t.step('video: reduced motion: fades and cuts, no movement');
  const frame = () =>
    page.evaluate(() => {
      const out = {};
      YES.overview.video.seek(6.95);
      out.card = document.querySelector('.vs-bal__card').style.transform;
      YES.overview.video.seek(7.5);
      out.bar = document.querySelector('.vs-bar').style.getPropertyValue('--p');
      YES.overview.video.seek(35.0 + 1.3); // the pointer half-way to the journey step
      const p = document.querySelector('.vs-pointer');
      out.ptr = [p.style.left, p.style.top];
      return out;
    });
  const moving = await frame();
  t.assert(/translate/.test(moving.card) && +moving.bar > 0 && +moving.bar < 1 && moving.ptr[0] !== '72%', 'with motion: entrances move, bars grow, the pointer glides: ' + JSON.stringify(moving));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const still = await frame();
  t.eq([still.card, still.bar, still.ptr], ['', '1', ['72%', '82%']], 'reduced motion: no movement, bars appear whole, the pointer cuts');
  await page.evaluate(() => YES.overview.video.seek(10, { play: true }));
  await runFor(page, 1000);
  st = await vstate(page);
  t.assert(st.playing && Math.abs(st.t - 11) < 0.1, 'reduced motion still plays: ' + st.t);
  await page.evaluate(() => YES.overview.video.pause());
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  t.step('video: no sideways scroll, 44 px controls');
  await page.evaluate(() => {
    document.querySelector('.ov-vtr').open = true;
    YES.overview.video.seek(30);
  });
  const ov = await noHorizontalOverflow(page);
  t.eq([ov.scroll, ov.offenders], [true, []], 'the player, chapters and open transcript fit the width');
  const small = await page.$$eval('.ov-video button', (els) =>
    els
      .filter((e) => e.getClientRects().length)
      .map((e) => [e.getAttribute('data-fk'), Math.round(e.getBoundingClientRect().height), Math.round(e.getBoundingClientRect().width)])
      .filter((x) => x[1] < 44 || x[2] < 44)
  );
  t.eq(small, [], 'every player, chapter and transcript control is at least 44 px');
  await page.click('[data-vp-cue="6"]');
  t.eq([(await vstate(page)).t, (await vstate(page)).playing], [byId.largest.at, true], 'a transcript line plays from its time');
  await page.evaluate(() => YES.overview.video.pause());
  await t.shot('video-transcript', { fullPage: false });

  /* ---------------------------------------------------- the logo slot */
  t.step('video: the [YES_LOGO] slot in the picture');
  const logos = () =>
    page.evaluate(() => {
      const stage = document.querySelector('.vp-stage');
      const greet = stage.querySelector('.vs-greet__logo .vs-logo');
      const art = greet.querySelector('svg, img');
      const r = art && art.getBoundingClientRect();
      return {
        placeholders: stage.querySelectorAll('.vs-logo.yes-logo--placeholder').length,
        art: stage.querySelectorAll('.vs-logo.yes-logo--art').length,
        hidden: [...stage.querySelectorAll('.vs-logo')].every((l) => l.getAttribute('aria-hidden') === 'true' && !l.hasAttribute('role')),
        kind: art ? art.tagName.toLowerCase() : null,
        height: r ? Math.round((r.height / stage.clientWidth) * 1000) / 10 : null,
        ratio: r ? Math.round((r.width / r.height) * 10) / 10 : null,
        ink: greet.classList.contains('yes-logo--art') ? getComputedStyle(greet).color === getComputedStyle(stage.querySelector('.vs-greet__hello')).color : null
      };
    });
  t.eq(await logos(), { placeholders: 3, art: 0, hidden: true, kind: null, height: null, ratio: null, ink: null }, 'without artwork: the text placeholder (greeting, corner, closing card)');
  const before = t.external.length;
  await page.evaluate(() => {
    YES.config.slots.YES_LOGO.svg = '<svg viewBox="0 0 120 40" aria-hidden="true" focusable="false"><rect width="120" height="40" rx="8" fill="currentColor"/></svg>';
    YES.renderAll();
    YES.overview.video.seek(5);
  });
  t.eq(await logos(), { placeholders: 0, art: 3, hidden: true, kind: 'svg', height: 4.8, ratio: 3, ink: true }, 'approved SVG: in every place, 4.8% of the picture high, 3:1 kept, in the stage ink');
  if (t.viewport !== 'narrow') await frameShot(t, 'logo-art');
  await page.evaluate(() => {
    delete YES.config.slots.YES_LOGO.svg;
    YES.config.slots.YES_LOGO.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 90 30%22%3E%3Crect width=%2290%22 height=%2230%22 fill=%22%23fff%22/%3E%3C/svg%3E';
    YES.renderAll();
  });
  const dataLogo = await logos();
  t.eq([dataLogo.art, dataLogo.kind, dataLogo.height], [3, 'img', 4.8], 'a data: image is drawn the same way');
  await page.evaluate(() => {
    YES.config.slots.YES_LOGO.src = 'https://cdn.example.com/logo.png';
    YES.renderAll();
  });
  t.eq((await logos()).placeholders, 3, 'an image URL that would fetch is ignored: the placeholder stays');
  await page.evaluate(() => {
    delete YES.config.slots.YES_LOGO.src;
    YES.renderAll();
  });
  t.eq(t.external.slice(before).filter((u) => /example\.com/.test(u)), [], 'no request for a logo URL');

  /* ------------------------------------------- an approved recording */
  t.step('video: an approved recording plays instead of the device voice, in step with the picture');
  await page.evaluate(() => {
    // A silent 61-second WAV (8 kHz, 8-bit mono), packaged as a data: URI.
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
    YES.config.slots.VIDEO_VOICEOVER.en = 'data:audio/wav;base64,' + btoa(bin);
    YES.renderAll();
  });
  t.eq(await page.locator('.ov-video audio[data-vp-audio]').count(), 1, 'one <audio> element for the recording');
  t.eq(await page.evaluate(() => [YES.overview.video.state().mode, document.querySelector('audio[data-vp-audio]').preload]), ['recorded', 'auto'], 'recorded mode, preloaded');
  t.assert(norm(await page.locator('.ov-video__honest').innerText()).includes('narrated by the approved recording'), 'the card says the narration is the approved recording');
  n0 = (await said(page)).length;
  await page.evaluate(() => YES.overview.video.seek(12, { play: true }));
  await page.waitForTimeout(400); // the media element starts on its own clock
  const audio = () => page.evaluate(() => ({ paused: document.querySelector('audio[data-vp-audio]').paused, time: document.querySelector('audio[data-vp-audio]').currentTime, muted: document.querySelector('audio[data-vp-audio]').muted, mode: YES.overview.video.state().mode }));
  let a = await audio();
  t.assert(!a.paused && a.mode === 'recorded' && Math.abs(a.time - 12) < 1, 'the recording plays from the playhead: ' + JSON.stringify(a));
  await page.evaluate(() => YES.overview.video.seek(30));
  a = await audio();
  t.assert(Math.abs(a.time - 30) < 0.35, 'a seek moves the recording with it (currentTime ' + a.time + ')');
  t.eq((await said(page)).length, n0, 'the device voice is not used');
  await page.click('[data-fk="vp-mute"]');
  t.eq((await audio()).muted, true, 'Mute mutes the recording');
  await page.click('[data-fk="vp-mute"]');
  await page.evaluate(() => YES.overview.video.pause());
  t.eq((await audio()).paused, true, 'Pause pauses the recording');
  await page.evaluate(() => {
    YES.config.slots.VIDEO_VOICEOVER.en = null;
    YES.renderAll();
  });
  t.eq(await page.locator('.ov-video audio').count(), 0, 'no recording: no <audio>');

  /* ------------------------------------------- no voice on the device */
  t.step('video: no voice for the language: it plays silently, captions on, mute off, and says so');
  await page.clock.resume();
  await page.evaluate(() => sessionStorage.setItem('ovtest.tts', 'none'));
  await fresh(t, '#/overview');
  await holdClock(page, 2000); // past the voices' grace period
  t.eq(await page.evaluate(() => YES.overview.video.state().mode), 'none', 'no voice');
  t.eq(norm(await page.locator('[data-vp-note]').innerText()), 'Voiceover isn’t available in this language on this device — captions are on.', 'the note');
  t.eq(await page.locator('[data-vp-note]').isVisible(), true, 'the note is shown');
  t.eq(norm(await page.locator('[data-vp-honest]').innerText()), 'An animated walkthrough built from this statement’s sample figures, with captions.', 'the card no longer promises a voice');
  await page.locator('.vp-big').click();
  t.eq([await page.getAttribute('[data-fk="vp-cc"]', 'aria-pressed'), await page.locator('[data-fk="vp-mute"]').isDisabled()], ['true', true], 'captions on, mute disabled');
  await runFor(page, 3000);
  st = await vstate(page);
  t.assert(st.playing && Math.abs(st.t - 3) < 0.1, 'it plays silently: ' + st.t);
  t.eq(await said(page), [], 'nothing is spoken');
  t.eq(await caption(page), 'This is your YES statement for ' + norm(fig.period) + '.', 'captions carry the narration');
  await page.evaluate(() => YES.overview.video.pause());
  await axeLive(t, '.ov-video', 'video without a voice');
  if (t.viewport !== 'narrow') await frameShot(t, 'no-voice');
  await page.clock.resume();

  t.step('video: network voices only: never used (they would send the statement’s figures off the device)');
  await page.evaluate(() => sessionStorage.setItem('ovtest.tts', 'remote'));
  await fresh(t, '#/overview');
  t.eq(await page.evaluate(() => YES.overview.video.state().mode), 'none', 'only online voices: treated as no voice');
  t.eq(await page.locator('[data-vp-note]').isVisible(), true, 'the no-voice note is shown');
  await page.locator('.vp-big').click();
  t.eq(await said(page), [], 'nothing is sent to an online voice');
  await page.evaluate(() => YES.overview.video.pause());
}
