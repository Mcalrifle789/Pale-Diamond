/**
 * Pale Diamond build script (JavaScript).
 *
 * TypeScript is compiled by `tsc` into dist/js. This script assembles the rest
 * of the deployable: static assets, Omaris rule files, and any pre-built WASM
 * artifacts produced from the Rust / C / C++ sources.
 */
import { cp, mkdir, rm, readdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { createReadStream } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const exists = async (p) => access(p, constants.F_OK).then(() => true, () => false);

async function clean() {
  await rm(dist, { recursive: true, force: true });
  console.log('[build] cleaned dist/');
}

async function assemble() {
  await mkdir(dist, { recursive: true });

  // 1. Static shell: index.html, CSS, images, Omaris rule files.
  await cp(path.join(root, 'public'), dist, { recursive: true });
  console.log('[build] copied public/ -> dist/');

  // 2. WASM artifacts built from src/rust, src/c and src/cpp. These are
  //    optional: the TypeScript renderer falls back to a pure-TS path when a
  //    module is missing, so the site always renders.
  const wasmSrc = path.join(root, 'build', 'wasm');
  if (await exists(wasmSrc)) {
    const target = path.join(dist, 'wasm');
    await mkdir(target, { recursive: true });
    await cp(wasmSrc, target, { recursive: true });
    console.log('[build] copied build/wasm -> dist/wasm:', (await readdir(target)).join(', '));
  } else {
    console.log('[build] no build/wasm present — TypeScript fallback renderers will be used');
  }

  // 3. GitHub Pages must not run the output through Jekyll (dirs like _foo).
  await cp(path.join(root, 'public', 'index.html'), path.join(dist, '404.html'));
  console.log('[build] dist/ ready');
}

async function serve(port = 4173) {
  const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm', '.json': 'application/json', '.map': 'application/json',
    '.oma': 'text/plain; charset=utf-8',
  };
  http.createServer(async (req, res) => {
    let rel = decodeURIComponent((req.url || '/').split('?')[0]);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(dist, rel);
    if (!file.startsWith(dist) || !(await exists(file))) {
      res.writeHead(404, { 'content-type': 'text/html' });
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  }).listen(port, () => console.log(`[build] serving dist/ on http://localhost:${port}`));
}

const args = process.argv.slice(2);
if (args.includes('--clean')) { await clean(); }
else { await assemble(); if (args.includes('--serve')) await serve(); }
