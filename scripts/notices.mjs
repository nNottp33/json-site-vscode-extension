import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
export async function writeNotices(results) {
  const roots = new Set();
  for (const result of results) for (const input of Object.keys(result.metafile.inputs)) {
    const match = input.replaceAll('\\', '/').match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)/);
    if (match) roots.add(match[1]);
  }
  let text = 'Third-party software bundled with JSON Workbench\n\nPackages are bundled/minified by esbuild. Original licenses follow.\n';
  for (const root of [...roots].sort()) {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    text += `\n${'='.repeat(72)}\n${pkg.name} ${pkg.version}\nLicense: ${pkg.license || 'See below'}\nRepository: ${typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || pkg.homepage || ''}\n\n`;
    const licenses = (await readdir(root, { withFileTypes: true })).filter(e => e.isFile() && /^(licen[cs]e|notice|copying)/i.test(e.name));
    if (!licenses.length && pkg.name === 'quicktype-core') text += await readFile('licenses/quicktype-LICENSE', 'utf8');
    else if (!licenses.length) text += `License declared by the package: ${pkg.license}. See repository for copyright attribution.\n`;
    for (const license of licenses) text += await readFile(path.join(root, license.name), 'utf8') + '\n';
  }
  await writeFile('THIRD_PARTY_NOTICES.txt', text.trimEnd() + '\n');
}
