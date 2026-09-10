import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { writeNotices } from './notices.mjs';
await mkdir('dist', { recursive: true });
const results = await Promise.all([
  build({ entryPoints: ['src/extension.ts'], outfile: 'dist/extension.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], sourcemap: false, metafile: true }),
  build({ entryPoints: ['src/types-worker.ts'], outfile: 'dist/types-worker.cjs', bundle: true, platform: 'node', format: 'cjs', minify: true, metafile: true }),
  build({ entryPoints: ['src/webview/app.ts'], outfile: 'dist/app.js', bundle: true, platform: 'browser', format: 'iife', loader: { '.ttf': 'file' }, minify: true, metafile: true }),
  build({ entryPoints: ['src/webview/worker.ts'], outfile: 'dist/worker.js', bundle: true, platform: 'browser', format: 'iife', minify: true, metafile: true }),
  build({ entryPoints: ['node_modules/monaco-editor/esm/vs/editor/editor.worker.js'], outfile: 'dist/editor.worker.js', bundle: true, platform: 'browser', format: 'iife', minify: true, metafile: true }),
  copyFile('src/webview/styles.css', 'dist/styles.css')
]);
await writeNotices(results.filter(Boolean));
