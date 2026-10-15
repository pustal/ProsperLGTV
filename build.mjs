/**
 * Build script for Prosper LG TV.
 *
 * Bundles `src/main.js` and `src/styles/app.css` with esbuild into `dist/`,
 * transpiled down to Chromium 53 so the app runs on webOS 4.x (2018) TVs and
 * newer. Static files (index.html, appinfo.json, icons) are copied as-is.
 *
 * Usage:
 *   node build.mjs                 production build (minified)
 *   node build.mjs --dev           unminified build with inline source maps
 *   node build.mjs --dev --watch   rebuild on every change
 */
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

const dev = process.argv.includes('--dev');
const watch = process.argv.includes('--watch');

/**
 * Oldest browser engine we support. webOS 4.x ships Chromium 53; webOS 3.x
 * (Chromium 38) lacks fetch and other APIs the app relies on.
 */
const TARGET = ['chrome53'];

const appinfo = JSON.parse(readFileSync('appinfo.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (appinfo.version !== pkg.version) {
  console.warn(`! appinfo.json version (${appinfo.version}) differs from package.json (${pkg.version})`);
}

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

/** Copies the files that don't need bundling into dist/. */
function copyStatic() {
  for (const f of ['index.html', 'appinfo.json']) cpSync(f, `dist/${f}`);
  // assets/icons/source holds the editable originals; only generated sizes ship.
  cpSync('assets/icons', 'dist/icons', { recursive: true, filter: (src) => !/[\\/]source([\\/]|$)/.test(src) });
}

/** esbuild plugin that re-copies static files after every (re)build. */
const staticPlugin = {
  name: 'static',
  setup(build) {
    build.onEnd((result) => {
      copyStatic();
      if (result.errors.length === 0) console.log(`[${new Date().toLocaleTimeString()}] built dist/`);
    });
  },
};

const options = {
  entryPoints: { app: 'src/main.js', style: 'src/styles/app.css' },
  bundle: true,
  outdir: 'dist',
  target: TARGET,
  format: 'iife',
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  legalComments: 'none',
  loader: { '.woff2': 'file' },
  assetNames: 'fonts/[name]-[hash]',
  define: {
    __APP_VERSION__: JSON.stringify(appinfo.version),
    __APP_ID__: JSON.stringify(appinfo.id),
    __DEV__: String(dev),
  },
  logLevel: 'warning',
  plugins: [staticPlugin],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('watching for changes…');
} else {
  await esbuild.build(options);
}
