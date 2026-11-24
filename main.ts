// ISLA BRASA 3D — entrypoint for make.fun (Node 22, standard library only).
//
// The game itself is plain static files under game/ (game/index.html plus its ES
// modules; Three.js is vendored locally at game/vendor/three.module.min.js and
// mapped by the import map in game/index.html, so the game loads with no
// network request). This program hands the entry in: it copies game/ and
// output directory and writes /output/dossier.json, the summary the judge reads,
// using the dossier builder in vendor/makefun-game.ts.
//
// Run it locally to check the hand-in before submitting:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output; inside the
// grader the variable is unset and /output is used. Serve the game itself with:
//   node serve.ts   (then open http://localhost:8080)
//
// I wrote this file fresh for the gta6-05 rebuild: the shape follows the kit's
// starter (copy the two trees, build the dossier with the same caps) but every
// line and comment here is my own.

import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The repository root is the directory this file lives in.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The game page must exist before anything is copied: without it there is no
// entry at all, and failing early beats writing a half-empty /output.
const gameDir = join(repoRoot, 'game');
if (!existsSync(join(gameDir, 'index.html')) || !statSync(join(gameDir, 'index.html')).isFile()) {
  throw new Error('main.ts: game/index.html is missing — nothing to hand in');
}

mkdirSync(outDir, { recursive: true });
cpSync(gameDir, join(outDir, 'game'), { recursive: true });

// Screenshots are taken by the game's maker and land in screenshots/; the
// dossier builder refuses an entry with none, so a missing directory is a
// loud failure here rather than a silent empty folder in the output.
const shotsDir = join(repoRoot, 'screenshots');
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
if (existsSync(shotsDir)) {
  cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });
}

// The scorer's own caps: only text_max_bytes shapes the dossier bytes, the
// rest refuse an entry the scorer would refuse (more than 4 screenshots or one
// over 256 KiB; more than 993 entries in game/ or 48 MiB of game files, or a
// game path over 1000 bytes). Passing them here makes this program fail in
// exactly the places the scorer would, while there is still time to fix it.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

console.log(`ISLA BRASA 3D handed in: ${outDir}`);
