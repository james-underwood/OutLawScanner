/**
 * Loads the single-file build over file:// with no network at all, then repeats
 * the run with IndexedDB forcibly broken to exercise the in-memory fallback.
 * Whether a given engine blocks IndexedDB on file:// varies, so the fallback is
 * triggered explicitly rather than assumed.
 */
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const file = `file://${resolve('dist-single/outlawscanner.html')}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
});
const failures = [];
const check = (name, ok) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) failures.push(name);
};

async function runAudit({ breakIndexedDb }) {
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
  page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => failures.push(`external request: ${r.url().slice(0, 80)}`));

  if (breakIndexedDb) {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        get: () => {
          throw new Error('IndexedDB blocked by policy');
        },
      });
    });
  }

  await page.goto(file);
  await page.getByRole('button', { name: 'Load demo data' }).waitFor({ timeout: 20000 });

  const warned = (await page.getByText(/blocking local storage/i).count()) > 0;
  check(
    breakIndexedDb ? 'warns the operator when storage is in-memory' : 'no false storage warning',
    breakIndexedDb ? warned : !warned,
  );

  await page.getByRole('button', { name: 'Load demo data' }).click();
  await page.getByText(/Loaded \d+ demo packages/).waitFor();

  await page.getByRole('button', { name: 'Live mode' }).click();
  await page.selectOption('select', 'vault-a');
  await page.getByRole('button', { name: 'Start session' }).click();
  await page.getByText('Blue Dream · 3.5g Jar').waitFor({ timeout: 15000 });
  check(`packages render (${breakIndexedDb ? 'memory' : 'persistent'} storage)`, true);

  await page.getByText('Blue Dream · 3.5g Jar').click();
  await page.getByPlaceholder(/Count in/).fill('19');
  await page.getByRole('button', { name: 'Record count' }).click();

  await page.getByRole('button', { name: /Review/ }).click();
  await page.getByText('Variances').waitFor();
  check(
    `reconciliation runs end to end (${breakIndexedDb ? 'memory' : 'persistent'})`,
    (await page.getByText(/reportable variance/).count()) > 0,
  );

  if (!breakIndexedDb) {
    await page.screenshot({ path: 'artifacts/5-singlefile.png', fullPage: true });
  }
  await page.close();
}

await runAudit({ breakIndexedDb: false });
await runAudit({ breakIndexedDb: true });
await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nsingle-file smoke: all checks passed');
