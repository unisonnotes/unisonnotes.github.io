// Copy the site into an output folder and add ?v=<version> to every local module,
// stylesheet and import-map URL. GitHub Pages caches files for 10 minutes; unique
// URLs per deploy mean a browser never mixes old and new modules.
// Usage: node scripts/stamp.mjs <outDir> <version>
import { cpSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";

const [out = "_site", version = Date.now().toString(36)] = process.argv.slice(2);
const v = `v=${version.slice(0, 12)}`;
const SKIP = new Set([".git", ".github", "node_modules", "tests", "scripts", out]);

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const name of readdirSync(".")) if (!SKIP.has(name)) cpSync(name, join(out, name), { recursive: true });

const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const SPEC = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"'?]+?\.m?js)\2/g;

let count = 0;
for (const file of walk(out)) {
  const ext = extname(file);
  if (ext !== ".js" && ext !== ".mjs" && ext !== ".html") continue;
  let src = readFileSync(file, "utf8");
  const before = src;
  src = src.replace(SPEC, (_, kw, q, path) => `${kw}${q}${path}?${v}${q}`);
  if (ext === ".html") {
    src = src
      .replace(/(href|src)="((?:css|js)\/[^"?]+\.(?:css|js))"/g, `$1="$2?${v}"`)
      .replace(/("\.\/vendor\/[^"?]+\.mjs)"/g, `$1?${v}"`);
  }
  if (src !== before) {
    writeFileSync(file, src);
    count++;
  }
}
console.log(`stamped ${count} files with ${v} into ${out}/`);
