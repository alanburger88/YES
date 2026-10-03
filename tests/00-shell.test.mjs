// Shell, offline operation, navigation, language switch, integrity gate.
export const meta = { name: 'shell', viewports: ['desktop', 'mobile'] };

export default async function (t) {
  const { page } = t;

  t.step('boot');
  t.assert(await page.evaluate(() => YES.integrity.ok), 'statement reconciles');
  t.assert(await page.locator('.demo-badge').first().isVisible(), 'demo badge is visible');
  t.eq(await page.evaluate(() => document.documentElement.lang), 'en', 'html lang');
  t.assert((await page.title()).includes('YES'), 'document title names YES');

  t.step('i18n parity');
  const missing = await page.evaluate(() => YES.i18n.audit());
  t.eq(missing, {}, 'every string exists in both languages');

  t.step('navigation');
  for (const v of ['transactions', 'understand', 'help', 'overview']) {
    await page.click(`.nav__link[data-nav="${v}"]`);
    await page.waitForFunction((v) => location.hash.startsWith('#/' + v), v);
    t.assert(await page.evaluate((v) => !document.getElementById('view-' + v).hidden, v), `view ${v} shown`);
    t.eq(await page.locator('.nav__link[aria-current="page"]').getAttribute('data-nav'), v, 'aria-current follows view');
  }

  t.step('language switch');
  await page.click('[data-lang="es"]');
  t.eq(await page.evaluate(() => document.documentElement.lang), 'es', 'html lang es');
  t.eq((await page.locator('.nav__link[data-nav="transactions"]').innerText()).trim(), 'Movimientos', 'nav translated');
  t.eq(await page.locator('[data-lang="es"]').getAttribute('aria-pressed'), 'true', 'es pressed');
  await page.click('[data-lang="en"]');
  t.eq(await page.evaluate(() => document.documentElement.lang), 'en', 'back to en');

  t.step('userway graceful offline');
  await page.waitForFunction(() => ['unavailable', 'loaded', 'host', 'disabled'].includes(YES.userway.status), null, { timeout: 12000 });
  t.eq(await page.evaluate(() => YES.userway.status), 'unavailable', 'widget unavailable offline');
  t.assert(t.external.length <= 1, 'at most one external request (UserWay)');

  t.step('integrity gate');
  await t.goto('#/overview?simulate=mismatch');
  t.assert(await page.locator('#withheld-title').isVisible(), 'withheld state shown on mismatch');
  t.assert(!(await page.locator('#main').isVisible()), 'statement content suppressed on mismatch');
  await t.shot('withheld');
}
