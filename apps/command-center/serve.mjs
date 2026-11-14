// Serveur statique minimal pour le centre de commandement Jarvis.
// Modules natifs Node uniquement (http/fs/path/url) — aucune dépendance
// ajoutée, écoute en local uniquement. Seul accès réseau : le relais des deux
// routes Inbox vers l'API Jarvis de ce poste (127.0.0.1), jamais ailleurs.
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

// Relais Inbox : correspondance exacte « méthode + chemin » (une chaîne de
// requête ou un autre chemin ne correspond à rien). Ce n'est pas un proxy :
// la cible est fixée ici, sur 127.0.0.1, et rien d'autre n'est relayé.
const API_PORT = Number.parseInt(process.env.JARVIS_API_PORT ?? '3000', 10);
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const INBOX_RELAY = {
  'GET /api/inbox/mailboxes': '/inbox/mailboxes',
  'POST /api/inbox/runs': '/inbox/runs',
};
const MAX_RELAY_BODY_BYTES = 1024;
// Délai maximal accordé à l'API pour une requête relayée, réponse complète
// comprise : 10 s par défaut, réglable par JARVIS_RELAY_TIMEOUT_MS (entier
// de millisecondes strictement positif ; toute autre valeur garde le défaut).
const DEFAULT_RELAY_TIMEOUT_MS = 10_000;
const RELAY_TIMEOUT_MS = /^[1-9]\d*$/.test(process.env.JARVIS_RELAY_TIMEOUT_MS ?? '')
  ? Number(process.env.JARVIS_RELAY_TIMEOUT_MS)
  : DEFAULT_RELAY_TIMEOUT_MS;
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

function hostnameOf(hostHeader) {
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return '';
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': MIME_TYPES['.json'] }).end(JSON.stringify(payload));
}

async function readBoundedBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_RELAY_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function relayInbox(request, response) {
  const target = INBOX_RELAY[`${request.method} ${request.url}`];
  if (target === undefined) {
    sendJson(response, 404, { error: 'Route non relayée.' });
    return;
  }
  // Réservé à la page servie ici : adresse locale, nom d'hôte local (une
  // page tierce liée par rebinding DNS garde son propre `Host`) et, si le
  // navigateur l'indique, origine identique à cet hôte.
  const { host, origin } = request.headers;
  if (
    !LOOPBACK_ADDRESSES.has(request.socket.remoteAddress) ||
    !LOOPBACK_HOSTNAMES.has(hostnameOf(host)) ||
    (origin !== undefined && origin !== `http://${host}`)
  ) {
    sendJson(response, 403, { error: 'Relais Inbox accessible uniquement depuis ce poste.' });
    return;
  }
  // JSON exigé : un formulaire ou un `fetch` « simple » venu d'un autre site
  // ne peut pas produire ce type de contenu sans contrôle préalable du navigateur.
  if (
    request.method === 'POST' &&
    !/^application\/json\b/i.test(request.headers['content-type'] ?? '')
  ) {
    sendJson(response, 415, { error: 'Type de contenu attendu : application/json.' });
    return;
  }
  const body = request.method === 'POST' ? await readBoundedBody(request) : undefined;
  if (body === null) {
    sendJson(response, 413, { error: 'Corps de requête trop volumineux.' });
    return;
  }

  let status;
  let text;
  try {
    const upstream = await fetch(`${API_ORIGIN}${target}`, {
      method: request.method,
      ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body } : {}),
      // Couvre l'attente des en-têtes comme la lecture du corps ci-dessous.
      // À l'expiration, la requête vers l'API est abandonnée et sa connexion fermée.
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
    status = upstream.status;
    // Lu ici : une API coupée en cours de réponse doit donner un 502, pas
    // une exception non gérée qui arrêterait ce serveur.
    text = await upstream.text();
  } catch (err) {
    if (err?.name === 'TimeoutError') {
      sendJson(response, 504, {
        error: `API Jarvis sans réponse complète dans le délai de ${(RELAY_TIMEOUT_MS / 1000).toLocaleString('fr-FR')} s sur 127.0.0.1:${API_PORT}. Aucun lot n'a été reçu ; vous pouvez relancer.`,
      });
      return;
    }
    sendJson(response, 502, {
      error: `API Jarvis injoignable ou interrompue sur 127.0.0.1:${API_PORT}. Démarrez-la, puis réessayez.`,
    });
    return;
  }
  response.writeHead(status, { 'Content-Type': MIME_TYPES['.json'] }).end(text);
}

function resolveRequestPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const safePath = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const candidate = safePath === '/' || safePath === '' ? '/index.html' : safePath;
  return join(ROOT, candidate);
}

const server = createServer(async (request, response) => {
  const urlPath = (request.url ?? '/').split('?')[0];
  if (urlPath.startsWith('/api/')) {
    await relayInbox(request, response);
    return;
  }
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
