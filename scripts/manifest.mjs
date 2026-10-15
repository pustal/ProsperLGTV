#!/usr/bin/env node
/**
 * Writes the Homebrew Channel manifest for the package built by
 * `npm run package`: out/org.prosperlgtv.app.manifest.json.
 *
 * The webOS Homebrew Channel (https://github.com/webosbrew/apps-repo) reads
 * this file from the latest GitHub release to find the current version and
 * its .ipk. Upload both files to the same release:
 *
 *   out/org.prosperlgtv.app_<version>_all.ipk
 *   out/org.prosperlgtv.app.manifest.json
 *
 * `ipkUrl` is relative to the manifest, so it always points at the .ipk of
 * the same release. `ipkHash` is the SHA-256 of that exact file: rebuild the
 * package and the manifest must be written again (`npm run package` does both).
 *
 * Usage: node scripts/manifest.mjs   (or: npm run manifest)
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where the project lives; also the source the store links to. */
const SOURCE_URL = 'https://github.com/pustal/ProsperLGTV';
/** The app icon: a direct link to the image file (not a github.com/.../blob/ page). */
const ICON_URI = 'https://raw.githubusercontent.com/pustal/ProsperLGTV/main/assets/icons/largeIcon.png';
/** One line shown in the Homebrew Channel's list. */
const DESCRIPTION = 'IPTV player for your own M3U playlists, made for the remote';

const appinfo = JSON.parse(readFileSync(join(root, 'appinfo.json'), 'utf8'));
const ipkName = `${appinfo.id}_${appinfo.version}_all.ipk`;
const ipkPath = join(root, 'out', ipkName);
if (!existsSync(ipkPath)) {
  console.error(`${ipkName} not found in out/. Run "npm run package" first.`);
  process.exit(1);
}

const sha256 = createHash('sha256').update(readFileSync(ipkPath)).digest('hex');

// Same fields, in the same order, as the Homebrew Channel's own manifest.
const manifest = {
  id: appinfo.id,
  version: appinfo.version,
  type: appinfo.type,
  title: appinfo.title,
  appDescription: DESCRIPTION,
  iconUri: ICON_URI,
  sourceUrl: SOURCE_URL,
  // Runs as a normal app; its network helper is an ordinary JS service.
  rootRequired: false,
  ipkUrl: ipkName,
  ipkHash: { sha256 },
};

const outPath = join(root, 'out', `${appinfo.id}.manifest.json`);
writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote out/${appinfo.id}.manifest.json for ${ipkName} (sha256 ${sha256.slice(0, 12)}…)`);
