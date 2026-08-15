/**
 * Inlines the built JS and CSS into one HTML document.
 *
 *   npm run build:single   ->   dist-single/outlawscanner.html
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'dist-single';
rmSync(OUT, { recursive: true, force: true });
execFileSync('npx', ['vite', 'build', '--config', 'vite.singlefile.config.ts'], {
  stdio: 'inherit',
});

const assets = join(OUT, 'assets');
const files = readdirSync(assets);
const scripts = files.filter((f) => f.endsWith('.js'));
const css = files.find((f) => f.endsWith('.css'));

// Multiple chunks mean dynamic imports were not inlined. Inlining only the
// entry would emit a file that loads to a blank screen, so refuse instead.
if (scripts.length !== 1) {
  throw new Error(
    `expected exactly one js chunk, got ${scripts.length}: ${scripts.join(', ')}. ` +
      'Check that inlineDynamicImports is still in effect in vite.singlefile.config.ts.',
  );
}

const script = readFileSync(join(assets, scripts[0]), 'utf8');
const style = css ? readFileSync(join(assets, css), 'utf8') : '';

// The artifact host supplies <!doctype>/<head>/<body>, so emit page content
// only. A </script> inside a string literal would close the tag early.
// The charset meta is not optional: opened over file:// there is no HTTP header
// to declare it, and the browser falls back to Latin-1, mangling every
// non-ASCII character in the UI.
const html = `<meta charset="utf-8" />
<title>OutLawScanner</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<style>${style}</style>
<div id="root"></div>
<script type="module">${script.replace(/<\/script>/gi, '<\\/script>')}</script>
`;

const target = join(OUT, 'outlawscanner.html');
writeFileSync(target, html);
console.log(`\n${target}  ${(Buffer.byteLength(html) / 1024).toFixed(0)} kB`);
