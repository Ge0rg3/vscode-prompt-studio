const fs = require('node:fs');
const path = require('node:path');

const esbuild = require('esbuild');

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
