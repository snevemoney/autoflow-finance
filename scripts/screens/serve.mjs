// Serves dist/ like Vercel does: the response headers from vercel.json (CSP, HSTS, caching…) and the
// SPA rewrite to index.html. Use it to check the Content-Security-Policy in a real browser.
//   npm run build && node scripts/screens/serve.mjs [port=4174]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('../../dist', import.meta.url).pathname);
const config = JSON.parse(fs.readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
const port = Number(process.argv[2] ?? process.env.PORT ?? 4174);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};
// vercel.json sources here are plain regular expressions in path-to-regexp groups
const rule = (source) => new RegExp(`^${source}$`);
const headerRules = (config.headers ?? []).map((h) => ({ re: rule(h.source), headers: h.headers }));
const rewrites = (config.rewrites ?? []).map((r) => ({ re: rule(r.source), destination: r.destination }));

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) { res.writeHead(400).end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const rw = rewrites.find((r) => r.re.test(url.pathname));
    file = rw ? path.join(root, rw.destination) : path.join(root, url.pathname, 'index.html');
  }
  if (!fs.existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
  const headers = { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' };
  for (const r of headerRules) if (r.re.test(url.pathname)) for (const h of r.headers) headers[h.key.toLowerCase()] = h.value;
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`serving dist with vercel.json headers on http://127.0.0.1:${port}`));
