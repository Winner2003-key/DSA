#!/usr/bin/env node
// DSA — shared screenshot harness.
//
// Serves an Expo web export, drives it through a small JSON scenario and writes
// screenshots plus a screens.md index. No Docker, no browser download: it uses
// playwright-core with the system Chrome.
//
//   cd apps/mobile && npx expo export -p web
//   node tools/screens/capture.mjs --scenario tools/screens/scenarios/accueil.json \
//        --out docs/sessions/reports/S10-screens
//
// See tools/screens/README.md. Keep to 8 shots, one theme, scale 1 (CHECKS.md §4).

import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';

const REPO = resolve(dirname(new URL(import.meta.url).pathname), '../..');

// ---------------------------------------------------------------- arguments
function parseArgs(argv) {
  const out = {
    scenario: null,
    out: null,
    dist: join(REPO, 'apps/mobile/dist'),
    scale: 1,
    width: 390,
    height: 844,
    theme: null, // scenario decides unless forced here
    port: 0,
    keepOpen: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[(i += 1)];
    if (a === '--scenario') out.scenario = next();
    else if (a === '--out') out.out = next();
    else if (a === '--dist') out.dist = next();
    else if (a === '--scale') out.scale = Number(next());
    else if (a === '--width') out.width = Number(next());
    else if (a === '--height') out.height = Number(next());
    else if (a === '--theme') out.theme = next();
    else if (a === '--port') out.port = Number(next());
    else if (a === '--keep-open') out.keepOpen = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

const HELP = `
tools/screens/capture.mjs

  --scenario <file.json>   required; see tools/screens/scenarios/
  --out <dir>              required; docs/sessions/reports/S<NN>-screens
  --dist <dir>             the Expo web export (default apps/mobile/dist)
  --scale <n>              device scale factor (default 1; use 2 only for detail)
  --width / --height       viewport (default 390 x 844)
  --theme light|dark       force a theme for every shot
  --port <n>               static server port (default: a free one)
  --keep-open              leave the browser open at the end (debugging)
`;

// -------------------------------------------------------- playwright-core
function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_DIR && join(process.env.PLAYWRIGHT_DIR, 'package.json'),
    join(REPO, 'node_modules/playwright-core/package.json'),
    ...(process.env.NODE_PATH || '')
      .split(':')
      .filter(Boolean)
      .map((p) => join(p, 'playwright-core/package.json')),
  ].filter(Boolean);

  for (const pkg of candidates) {
    if (!existsSync(pkg)) continue;
    const require = createRequire(pkg);
    // playwright-core is CommonJS: its exports land on `default` under import().
    return import(require.resolve('playwright-core')).then((m) => m.chromium ? m : m.default);
  }
  throw new Error(
    'playwright-core not found. Install it in your scratchpad (not the repo):\n' +
      '  npm i --prefix "$SCRATCH" --no-save playwright-core\n' +
      '  PLAYWRIGHT_DIR="$SCRATCH/node_modules/playwright-core" node tools/screens/capture.mjs ...',
  );
}

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
].filter(Boolean);

async function launch(chromium) {
  const executablePath = CHROME_PATHS.find((p) => existsSync(p));
  const args = ['--hide-scrollbars', '--force-prefers-reduced-motion'];
  if (executablePath) return chromium.launch({ executablePath, args });
  return chromium.launch({ channel: 'chrome', args }); // playwright finds it
}

// ----------------------------------------------------------- static server
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function serve(dist, port) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = join(dist, decodeURIComponent(url.pathname));
    if (!existsSync(file) || file.endsWith('/')) {
      const asHtml = `${file.replace(/\/$/, '')}.html`;
      file = existsSync(asHtml) ? asHtml : join(dist, 'index.html'); // SPA fallback
    }
    try {
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

// ----------------------------------------------------------------- actions
async function runAction(page, action) {
  if (typeof action === 'number') return page.waitForTimeout(action);

  const [kind, value] = Object.entries(action)[0];
  switch (kind) {
    case 'click': {
      const target =
        typeof value === 'string'
          ? page.getByText(value, { exact: false }).first()
          : value.testId
            ? page.getByTestId(value.testId)
            : page.getByLabel(value.label).first();
      await target.click({ timeout: 10_000 });
      return page.waitForTimeout(150);
    }
    case 'fill': {
      const field = value.testId
        ? page.getByTestId(value.testId)
        : page.getByLabel(value.label).first();
      return field.fill(value.value);
    }
    case 'press':
      return page.keyboard.press(value);
    case 'wait':
      return page.waitForTimeout(value);
    case 'waitFor':
      return page.getByText(value, { exact: false }).first().waitFor({ timeout: 15_000 });
    case 'eval':
      return page.evaluate(value);
    default:
      throw new Error(`Unknown action "${kind}"`);
  }
}

// -------------------------------------------------------------------- main
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.scenario || !args.out) {
    console.log(HELP);
    process.exit(args.help ? 0 : 1);
  }
  if (!existsSync(args.dist)) {
    throw new Error(`No web export at ${args.dist}. Run: cd apps/mobile && npx expo export -p web`);
  }

  const scenario = JSON.parse(readFileSync(resolve(args.scenario), 'utf8'));
  const shots = scenario.shots ?? [];
  if (shots.length > 8) {
    console.warn(`! ${shots.length} shots. CHECKS.md §4 asks for at most 8 — trim the scenario.`);
  }

  const { chromium } = await loadPlaywright();
  const server = await serve(args.dist, args.port);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launch(chromium);
  await mkdir(resolve(args.out), { recursive: true });

  const problems = [];
  const index = [];

  for (const shot of shots) {
    const theme = args.theme ?? shot.theme ?? scenario.theme ?? 'light';
    const context = await browser.newContext({
      viewport: { width: args.width, height: args.height },
      deviceScaleFactor: args.scale,
      colorScheme: theme,
      locale: 'fr-FR',
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`[${shot.name}] console: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`[${shot.name}] page: ${e.message}`));
    page.on('response', (r) => {
      if (r.status() >= 400) problems.push(`[${shot.name}] ${r.status()} ${r.url()}`);
    });

    try {
      await page.goto(base + (shot.path ?? scenario.path ?? '/'), { waitUntil: 'networkidle' });
      for (const action of shot.actions ?? []) await runAction(page, action);
      await page.waitForTimeout(shot.settle ?? 250);

      const file = join(resolve(args.out), `${shot.name}.png`);
      await page.screenshot({ path: file, fullPage: shot.fullPage ?? false });
      index.push({ name: shot.name, theme, note: shot.note ?? '' });
      console.log(`  ✓ ${shot.name}.png  (${theme})`);
    } catch (err) {
      // Keep going: 7 good screenshots and a clear note beat nothing at all.
      problems.push(`[${shot.name}] FAILED: ${err.message.split('\n')[0]}`);
      console.log(`  ✗ ${shot.name}: ${err.message.split('\n')[0]}`);
    } finally {
      await context.close();
    }
  }

  const md = [
    `# Screens — ${scenario.title ?? args.out}`,
    '',
    `Captured by \`tools/screens/capture.mjs\` from the Expo web export, ` +
      `${args.width}×${args.height} @${args.scale}×, locale fr-FR, reduced motion.`,
    '',
    '| Image | Theme | What it shows |',
    '|---|---|---|',
    ...index.map((s) => `| \`${s.name}.png\` | ${s.theme} | ${s.note} |`),
    '',
    problems.length
      ? `**${problems.length} console/page errors:**\n\n` +
        problems.map((p) => `- ${p}`).join('\n')
      : '**0 page errors, 0 console errors.**',
    '',
  ].join('\n');
  await writeFile(join(resolve(args.out), 'screens.md'), md, 'utf8');

  console.log(`\n${index.length} screenshots → ${args.out}`);
  console.log(problems.length ? `${problems.length} errors (see screens.md)` : '0 errors');

  if (!args.keepOpen) await browser.close();
  server.close();
  if (problems.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\n${err.message}\n`);
  process.exit(1);
});
