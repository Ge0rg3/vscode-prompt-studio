const fs = require('node:fs');
const path = require('node:path');

const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// the extension host bundle
/** @type {import('esbuild').BuildOptions} */
const extensionBuild = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info'
};

// the template webview bundles CodeMirror into a self-contained browser script
/** @type {import('esbuild').BuildOptions} */
const templateBuild = {
  entryPoints: ['webview/template/main.ts'],
  bundle: true,
  outfile: 'media/template/template.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: !production,
  minify: production,
  logLevel: 'info'
};

// vendor codicon font + css into media/ so the webview can serve them
function copyCodicons() {
  const src = path.join(__dirname, 'node_modules/@vscode/codicons/dist');
  const dst = path.join(__dirname, 'media/codicons');
  fs.mkdirSync(dst, { recursive: true });
  for (const name of ['codicon.css', 'codicon.ttf']) {
    fs.copyFileSync(path.join(src, name), path.join(dst, name));
  }
}

async function main() {
  copyCodicons();

  const builds = [extensionBuild, templateBuild];
  if (watch) {
    for (const options of builds) {
      const ctx = await esbuild.context(options);
      await ctx.watch();
    }
  } else {
    await Promise.all(builds.map((options) => esbuild.build(options)));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
