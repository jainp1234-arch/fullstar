// Serves a production build for end-to-end tests (no dependencies): node scripts/serve-static.mjs <dir> <port>
// Unknown paths fall back to index.html and text is gzipped, like the real hosting will.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createGzip } from 'node:zlib';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? 'dist/family-app/browser');
const port = Number(process.argv[3] ?? 4300);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const TEXT = ['text/', 'application/json', 'application/manifest', 'image/svg'];

createServer((request, response) => {
  let path;
  try {
    path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }
  // The API and Keycloak live elsewhere; they never get the app's index.html
  if (/^\/(api|auth)\//.test(path)) {
    response.writeHead(404).end();
    return;
  }
  let file = normalize(join(root, path));
  if (file !== root && !file.startsWith(root + sep)) {
    response.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    file = join(root, 'index.html');
  }
  const type = types[extname(file)] ?? 'application/octet-stream';
  // Plan 9.3: hashed bundles never change; everything else is checked again
  const hashed = /-[A-Za-z0-9_-]{8}\.(js|css)$/.test(file);
  const headers = {
    'Content-Type': type,
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  const accepts = (request.headers['accept-encoding'] ?? '').split(',').map((e) => e.trim());
  if (TEXT.some((prefix) => type.startsWith(prefix)) && accepts.includes('gzip')) {
    response.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
    createReadStream(file).pipe(createGzip()).pipe(response);
    return;
  }
  response.writeHead(200, headers);
  createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`Serving ${root} on http://127.0.0.1:${port}`));
