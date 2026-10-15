/**
 * TV helper: installs, launches or inspects the app on the webOS device
 * registered as "tv" (see `npx ares-setup-device`).
 *
 * The app id and version are read from appinfo.json, so nothing here needs
 * editing when either changes.
 *
 *   node scripts/tv.mjs install   install out/<id>_<version>_all.ipk
 *   node scripts/tv.mjs launch    start the app
 *   node scripts/tv.mjs inspect   open Chrome DevTools for the running app
 *
 * Set TV_DEVICE to use a device name other than "tv".
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const { id, version } = JSON.parse(readFileSync('appinfo.json', 'utf8'));
const device = process.env.TV_DEVICE || 'tv';
const ipk = `out/${id}_${version}_all.ipk`;

const commands = {
  install: ['ares-install', ['-d', device, ipk]],
  launch: ['ares-launch', ['-d', device, id]],
  inspect: ['ares-inspect', ['-d', device, '--app', id, '--open']],
};

const action = process.argv[2];
if (!commands[action]) {
  console.error(`usage: node scripts/tv.mjs <${Object.keys(commands).join('|')}>`);
  process.exit(1);
}

const [cmd, args] = commands[action];
console.log(`> ${cmd} ${args.join(' ')}`);
// npm scripts put node_modules/.bin on PATH, so the local ares-* tools are found.
const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(result.status === null ? 1 : result.status);
