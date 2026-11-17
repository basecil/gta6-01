// NEON BAY — the gta6-01 entry program (Node 22, standard library only). The game is this
// directory's game/ folder: plain static files the browser loads as ES modules, three.js
// vendored under game/vendor/three/. This program copies game/ and screenshots/ beside itself
// to /output (or $MAKEFUN_OUTPUT_DIR outside the grader), refuses an entry the scorer would
// refuse, and writes dossier.json with the vendored make.fun library.
//
// It is deliberately dull: no bundling, no network, no Date.now, no Math.random. The only work
// is a scan, a sorted copy, a handful of existence checks and buildDossier, so it finishes well
// inside the grader's ten-second budget and writes the same bytes on every run. The caps below
// are the scorer's (reference/gate.json) and are checked here, before anything is copied, so a
// bad entry fails with one readable line instead of a half-written output directory.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const GAME = join(here, 'game');
const SHOTS = join(here, 'screenshots');

// The scorer's caps, in one place: the dossier's text limit, the screenshot count and per-image
// bytes, and game/ counted the way the platform counts it (files and directories, one entry each).
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
} as const;

const REQUIRED_GAME_FILES = ['index.html', 'main.js'];
const REQUIRED_THREE_FILES = ['three.module.min.js', 'three.core.min.js'];
const MIN_SHOTS = 3;
const SHOT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHOT_EXT = /\.(jpe?g|png)$/i;

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function fail(what: string, needs?: string): never {
  console.error(`NEON BAY: ${what}`);
  if (needs !== undefined) console.error(`  needs: ${needs}`);
  process.exit(1);
}

const within = (child: string, parent: string): boolean => child === parent || child.startsWith(parent + sep);

// ---- output directory: never a place we would overwrite the entry itself -------------------
if (within(here, out)) {
  fail(`output directory ${out} contains the entry; pick a fresh directory beside it`, 'MAKEFUN_OUTPUT_DIR=out');
}
if (within(out, GAME) || within(out, SHOTS)) {
  fail(`output directory ${out} sits inside game/ or screenshots/; pick a directory beside them`);
}

// ---- what the scorer needs to find before anything is copied -------------------------------
for (const file of REQUIRED_GAME_FILES) {
  if (!existsSync(join(GAME, file))) fail(`game/${file} is missing`);
}
for (const file of REQUIRED_THREE_FILES) {
  if (!existsSync(join(GAME, 'vendor', 'three', file))) fail(`game/vendor/three/${file} is missing`);
}
if (!existsSync(SHOTS)) fail('screenshots/ is missing');

// ---- game/: count entries and bytes the way the platform does, then refuse past the caps ----
const files: string[] = [];
const dirs: string[] = [];
let gameBytes = 0;

function scanGame(abs: string, rel: string): void {
  for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) => byName(a.name, b.name))) {
    const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
    const childAbs = join(abs, entry.name);
    if (entry.isSymbolicLink()) {
      fail(`game/${childRel} is a symbolic link; game/ holds plain files and directories only`);
    } else if (entry.isDirectory()) {
      dirs.push(childRel);
    } else if (entry.isFile()) {
      files.push(childRel);
      gameBytes += statSync(childAbs).size;
    } else {
      fail(`game/${childRel} is a special file; game/ holds plain files and directories only`);
    }
    if (files.length + dirs.length > CAPS.game_max_files) {
      fail(`game/ holds more than the ${CAPS.game_max_files} files and directories allowed`, 'trim game/');
    }
    if (gameBytes > CAPS.game_max_bytes) {
      fail(`game/ comes to more than the ${CAPS.game_max_bytes} bytes allowed`, 'trim game/');
    }
    if (entry.isDirectory()) scanGame(childAbs, childRel);
  }
}
scanGame(GAME, '');
files.sort(byName);
dirs.sort(byName);

// ---- screenshots/: 3 or 4 images, each a JPEG or PNG within the per-image cap ----------------
const shots = readdirSync(SHOTS, { withFileTypes: true })
  .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
  .map((entry) => entry.name)
  .filter((name) => SHOT_EXT.test(name))
  .sort(byName);

if (shots.length < MIN_SHOTS || shots.length > CAPS.screenshots.max) {
  fail(
    `screenshots/ holds ${shots.length} image(s); the entry needs ${MIN_SHOTS} or ${CAPS.screenshots.max}`,
    'screenshots/1-drive.jpg, 2-chase.jpg, 3-briefing.jpg, 4-neon.jpg',
  );
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) {
    fail(`screenshots/${name}: a name is letters, digits and . _ -, up to 128 characters`);
  }
  const size = statSync(join(SHOTS, name)).size;
  if (size === 0) fail(`screenshots/${name} is empty`);
  if (size > CAPS.screenshots.max_bytes) {
    fail(`screenshots/${name} is ${size} bytes, over the ${CAPS.screenshots.max_bytes} allowed`, 're-encode at lower JPEG quality');
  }
}

// ---- copy: game/ and screenshots/ sit beside dossier.json in the output directory -----------
// Stale copies are removed first so two runs of the same tree produce the same output, and
// every directory and file is copied in code-unit name order so the order is fixed, not
// whatever the filesystem happens to return.
mkdirSync(out, { recursive: true });
rmSync(join(out, 'game'), { recursive: true, force: true });
rmSync(join(out, 'screenshots'), { recursive: true, force: true });

function copySorted(srcRoot: string, dstRoot: string, entries: readonly string[]): void {
  mkdirSync(dstRoot, { recursive: true });
  for (const entry of entries) {
    mkdirSync(join(dstRoot, entry), { recursive: true });
  }
}

copySorted(GAME, join(out, 'game'), dirs);
for (const file of files) {
  copyFileSync(join(GAME, file), join(out, 'game', file));
}
mkdirSync(join(out, 'screenshots'), { recursive: true });
for (const name of shots) {
  copyFileSync(join(SHOTS, name), join(out, 'screenshots', name));
}

// ---- the dossier: buildDossier reads the copy, so what it records is what ships -------------
let dossier: Uint8Array;
try {
  dossier = buildDossier(out, {
    text_max_bytes: CAPS.text_max_bytes,
    screenshots: { max: CAPS.screenshots.max, max_bytes: CAPS.screenshots.max_bytes },
    game_max_files: CAPS.game_max_files,
    game_max_bytes: CAPS.game_max_bytes,
  });
} catch (error) {
  fail(`the dossier was refused: ${(error as Error).message}`);
}
if (dossier.length === 0) fail('buildDossier returned an empty dossier');
writeFileSync(join(out, 'dossier.json'), dossier);

// One deterministic line: the same tree always prints the same numbers.
console.log(
  `NEON BAY: ${files.length} game file(s) in ${dirs.length} director${dirs.length === 1 ? 'y' : 'ies'}, ` +
    `${gameBytes} bytes; ${shots.length} screenshot(s); dossier ${dossier.length} bytes -> ${relative(here, out) || '.'}/dossier.json`,
);
