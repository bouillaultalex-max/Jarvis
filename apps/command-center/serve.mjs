// Serveur statique minimal pour le centre de commandement Jarvis.
// Modules natifs Node uniquement (http/fs/path/url) — aucune dépendance
// ajoutée, aucun accès réseau sortant, écoute en local uniquement.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number.parseInt(process.env.PORT ?? '4610', 10);
const HOST = process.env.HOST ?? '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

// Allowlist explicite des deux seuls fichiers pdf.js nécessaires à
// l'extraction locale (bibliothèque + worker, même version, car tous deux
// viennent du même paquet installé) — jamais de route générique vers
// node_modules.
const PDFJS_BUILD_DIR = fileURLToPath(
  new URL('../../node_modules/pdfjs-dist/build/', import.meta.url),
);
const VENDOR_ASSETS = {
  '/vendor/pdfjs/pdf.mjs': join(PDFJS_BUILD_DIR, 'pdf.mjs'),
  '/vendor/pdfjs/pdf.worker.min.mjs': join(PDFJS_BUILD_DIR, 'pdf.worker.min.mjs'),
};

function resolveRequestPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const safePath = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const candidate = safePath === '/' || safePath === '' ? '/index.html' : safePath;
  return join(ROOT, candidate);
}

const server = createServer(async (request, response) => {
  const urlPath = (request.url ?? '/').split('?')[0];
  const vendorPath = VENDOR_ASSETS[urlPath];
  const filePath = vendorPath ?? resolveRequestPath(request.url ?? '/');

  if (!vendorPath && !filePath.startsWith(ROOT)) {
    response.writeHead(403).end('Interdit.');
    return;
  }

  try {
    const content = await readFile(filePath);
    const contentType = MIME_TYPES[extname(filePath)] ?? 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': contentType }).end(content);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Introuvable.');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Jarvis — centre de commandement local : http://${HOST}:${PORT}`);
});
