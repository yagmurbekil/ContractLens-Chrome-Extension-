// Minimal static server for dist-harness/ (Cypress + manual demo). Loopback only.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = join(process.cwd(), 'dist-harness');
const port = Number(process.env.HARNESS_PORT ?? 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

http
  .createServer(async (req, res) => {
    let p = decodeURIComponent(new globalThis.URL(req.url ?? '/', 'http://x').pathname);
    if (p === '/') p = '/harness.html';
    const file = normalize(join(root, p));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`harness http://127.0.0.1:${port}/harness.html`));
