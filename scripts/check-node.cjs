/**
 * Stops `npm install` and `npm run build` early, with a clear message, when
 * the Node.js running them is too old.
 *
 * The build scripts are ES modules (build.mjs) and need Node.js 20 or newer.
 * An older Node fails with a cryptic "SyntaxError: Unexpected token *" on
 * the first `import`, so this check runs first (npm runs "preinstall" and
 * "prebuild" automatically). It is CommonJS and ES5 on purpose, so that even
 * a very old Node can run it.
 *
 * With nvm, `nvm install` (or `nvm use`) in the project folder switches to
 * the version in .nvmrc.
 */
'use strict';

var REQUIRED_MAJOR = 20;
var major = parseInt(process.versions.node.split('.')[0], 10);

if (major < REQUIRED_MAJOR) {
  console.error('');
  console.error('Prosper LG TV needs Node.js ' + REQUIRED_MAJOR + ' or newer to build; this is Node.js ' + process.versions.node + '.');
  console.error('With nvm, run this in the project folder:  nvm install && nvm use');
  console.error('(.nvmrc selects Node.js 22). Then run the npm command again.');
  console.error('');
  process.exit(1);
}
