const esbuild = require('esbuild');
const { copyFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
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

// copy the codicon css and ttf into media/codicons so the webview can load them
function copyCodicons() {
  const src = path.join('node_modules', '@vscode', 'codicons', 'dist');
  const dest = path.join('media', 'codicons');
  mkdirSync(dest, { recursive: true });
  for (const file of ['codicon.css', 'codicon.ttf']) {
    copyFileSync(path.join(src, file), path.join(dest, file));
  }
}

async function main() {
  copyCodicons();
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  } else {
    await esbuild.build(options);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
