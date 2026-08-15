/**
 * End-to-end smoke test: loads demo inventory, runs a live audit with manual
 * counts, and checks that the reconciliation screen classifies a shortage.
 * Exercises the IndexedDB path, which unit tests do not cover.
 *
 *   node scripts/smoke.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const baseUrl = process.argv[2] ?? 'http://localhost:4173';
const shots = 'artifacts';
mkdirSync(shots, { recursive: true });

// The preinstalled Chromium may not match this Playwright build's expected
// revision, so point at it explicitly rather than downloading another copy.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
});
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
const failures = [];

const check = (name, condition) => {
  if (condition) console.log(`  ok   ${name}`);
  else {
    console.log(`  FAIL ${name}`);
    failures.push(name);
  }
};

page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));

await page.goto(baseUrl);
await page.getByRole('button', { name: 'Load demo data' }).click();
await page.getByText(/Loaded \d+ demo packages/).waitFor();
check('demo inventory loads into IndexedDB', true);

await page.getByRole('button', { name: 'Live mode' }).click();
await page.selectOption('select', 'vault-a');
await page.screenshot({ path: `${shots}/1-setup.png` });

await page.getByRole('button', { name: 'Start session' }).click();
await page.getByText('Blue Dream · 3.5g Jar').waitFor();
check('session starts and shows zone packages', true);
await page.screenshot({ path: `${shots}/2-session.png` });

// Count one package short and one exactly right.
await page.getByText('Blue Dream · 3.5g Jar').click();
await page.getByPlaceholder(/Count in/).fill('19');
await page.screenshot({ path: `${shots}/3-count.png` });
await page.getByRole('button', { name: 'Record count' }).click();

await page.getByText('Sour Diesel · 1g Cart').click();
await page.getByPlaceholder(/Count in/).fill('40');
await page.getByRole('button', { name: 'Record count' }).click();

check('counted packages are marked', (await page.getByText('counted').count()) >= 2);

await page.getByRole('button', { name: /Review/ }).click();
await page.getByText('Variances').waitFor();

const banner = await page.getByText(/reportable variance/).count();
check('shortage of 5 is escalated to reportable', banner > 0);

const rows = await page.locator('tbody tr').count();
check('every expected package appears in the report', rows === 4);

const firstRow = await page.locator('tbody tr').first().innerText();
check('most severe variance sorts to the top', firstRow.includes('Blue Dream'));
check('variance is signed', firstRow.includes('-5'));

await page.screenshot({ path: `${shots}/4-review.png`, fullPage: true });

await browser.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\nsmoke: all checks passed');
