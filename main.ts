// token-radar-01: turn the sealed snapshot into the ranked board, the dashboard
// data script, and the make.fun dossier. Standard library only, Node 22.
//
//   node main.ts --input <snapshot.json|directory> --output <dir>
//
// The input defaults to /input (a directory means <dir>/snapshot.json) and the
// output to $MAKEFUN_OUTPUT_DIR, else /output. Everything the dashboard shows
// comes from lib/model.ts; the dossier comes from vendor/makefun-board.ts.

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

// Where this file lives, so dashboard/ and screenshots/ are found no matter
// which working directory the command runs from.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));

const FALLBACK_INPUT = '/input';
const FALLBACK_OUTPUT = '/output';
const SNAPSHOT_NAME = 'snapshot.json';

// A screenshot name the dossier will accept: a letter, digit or _ first, then
// letters, digits and . _ -, 1 to 128 characters in all.
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const MIN_SHOTS = 3;

// The dossier caps the bounty scores with: text plus the screenshot and
// dashboard limits it refuses on, never shapes by.
const DOSSIER_CAPS = {
  text_max_bytes: 65536,
  screenshots: { max: 4, max_bytes: 524288 },
  dashboard: { max_files: 400, max_bytes: 4194304 },
};

/** Complain on stderr and leave with `code`. */
function die(message: string, code: number): never {
  console.error(`token radar: ${message}`);
  process.exit(code);
}

/** Pull --flag value / --flag=value pairs out of argv, keeping last wins. */
function readFlags(argv: string[]): { input: string; output: string } {
  let input = FALLBACK_INPUT;
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? FALLBACK_OUTPUT;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    for (const [flag, set] of [
      ['--input', (v: string) => { input = v; }],
      ['--output', (v: string) => { output = v; }],
    ] as const) {
      if (arg === flag) {
        const next = argv[i + 1];
        if (next === undefined) die(`missing value for ${flag}`, 2);
        set(next);
        i++;
      } else if (arg.startsWith(`${flag}=`)) {
        set(arg.slice(flag.length + 1));
      }
    }
  }
  return { input, output };
}

/** The snapshot file for an --input that may name the file or its directory. */
function snapshotPath(given: string): string {
  if (existsSync(given) && statSync(given).isDirectory()) return join(given, SNAPSHOT_NAME);
  return given;
}

/**
 * Copy one directory's regular files into another, skipping dot-names, and
 * return how many files were copied. `checkNames` also enforces the
 * screenshot-name rule on every copied name.
 */
function copyFlat(fromDir: string, toDir: string, checkNames: boolean): number {
  mkdirSync(toDir, { recursive: true });
  let copied = 0;
  for (const name of readdirSync(fromDir)) {
    if (name.startsWith('.')) continue;
    const src = join(fromDir, name);
    if (!statSync(src).isFile()) continue;
    if (checkNames && !SHOT_NAME.test(name)) die(`screenshot name ${name} is not allowed`, 1);
    copyFileSync(src, join(toDir, name));
    copied++;
  }
  return copied;
}

function main(): void {
  const { input, output } = readFlags(process.argv.slice(2));

  const snapFile = snapshotPath(input);
  if (!existsSync(snapFile)) die(`no snapshot at ${snapFile}`, 2);
  const snapshot = parseSnapshot(readFileSync(snapFile, 'utf8'));

  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) die(`board rejected: ${issue}`, 1);

  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(output, 'data.js'), dataScript(radar));

  const dashFiles = copyFlat(join(repoRoot, 'dashboard'), join(output, 'dashboard'), false);
  const shots = copyFlat(join(repoRoot, 'screenshots'), join(output, 'screenshots'), true);
  if (shots < MIN_SHOTS) die(`only ${shots} screenshot${shots === 1 ? '' : 's'} found, need at least ${MIN_SHOTS}`, 1);

  writeFileSync(join(output, 'dossier.json'), buildDossier(output, DOSSIER_CAPS));

  console.log(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)`,
  );
  console.log(
    `token radar: wrote ${join(output, 'board.json')}, ${join(output, 'data.js')}, ${join(output, 'dashboard')} (${dashFiles} files), ${join(output, 'screenshots')} (${shots} images) and ${join(output, 'dossier.json')}`,
  );
}

try {
  main();
} catch (err) {
  die(err instanceof Error ? err.message : String(err), 1);
}
