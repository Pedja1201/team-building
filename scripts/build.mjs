import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { Script } from 'node:vm';

const files = {
  'index.html': 'text/html; charset=utf-8',
  'login.html': 'text/html; charset=utf-8',
  'images.jpg': 'image/jpeg',
  'vina-fruske-gore.jpg': 'image/jpeg',
  'Dot_Networks_Full_Color.png': 'image/png',
};
const assets = {};
for (const [file, type] of Object.entries(files)) {
  const data = await readFile(file);
  if (file.endsWith('.html')) {
    const html = data.toString('utf8');
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new Script(match[1], { filename: file });
    for (const [, ref] of html.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)) {
      if (!/^(?:https?:|mailto:|tel:|data:)/.test(ref) && !files[ref.split('#')[0]]) throw new Error(`Unknown asset ${ref} in ${file}`);
    }
  }
  assets['/' + file] = { type, data: data.toString('base64') };
}
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
const worker = await readFile('hosting/worker.mjs', 'utf8');
await writeFile('dist/server/index.js', worker + '\nconst assets = ' + JSON.stringify(assets) + ';\nexport default createWorker(assets);\n');
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
await cp('drizzle', 'dist/.openai/drizzle', { recursive: true });
console.log('Built Worker with 5 public assets and database migrations.');
