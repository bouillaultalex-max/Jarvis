import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Démarre le vrai serve.mjs (aucune réécriture pour le rendre « testable »)
// sur un port dédié au test, distinct du port de développement (4610), pour
// vérifier son comportement réel : écoute en loopback, allowlist stricte
// des deux ressources pdf.js, aucune route générique vers node_modules.
const here = path.dirname(fileURLToPath(import.meta.url));
const TEST_PORT = 48610;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const STUB_API_PORT = 48611;
let serverProcess;
let stubApi;
// Chaque requête reçue par la fausse API : preuve de ce qui est relayé — et
// de ce qui ne l'est pas.
const stubApiRequests = [];
// 'cut' : la fausse API coupe la connexion au milieu de sa réponse.
let stubApiMode = 'ok';

/** Requête brute (node:http) : permet de fixer `Host`, ce que `fetch` interdit. */
function rawRequest({ method = 'GET', route, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port: TEST_PORT, method, path: route, headers },
      (res) => {
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode, text }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

beforeAll(async () => {
  stubApi = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      stubApiRequests.push({ method: request.method, url: request.url, body });
      if (stubApiMode === 'cut') {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '500' });
        response.write('{"mailboxes":[');
        // Laisse partir les en-têtes et le début du corps avant de couper.
        setTimeout(() => request.socket.destroy(), 50);
        return;
      }
      const status = request.url === '/inbox/runs' ? 403 : 200;
      response
        .writeHead(status, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ relayed: `${request.method} ${request.url}` }));
    });
  });
  await new Promise((resolve) => stubApi.listen(STUB_API_PORT, '127.0.0.1', resolve));

  serverProcess = spawn('node', ['serve.mjs'], {
    cwd: here,
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      HOST: '127.0.0.1',
      JARVIS_API_PORT: String(STUB_API_PORT),
    },
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("serve.mjs n'a pas démarré à temps")), 5000);
    serverProcess.stdout.on('data', (chunk) => {
      if (chunk.toString().includes(String(TEST_PORT))) {
        clearTimeout(timeout);
        resolve();
      }
    });
    serverProcess.on('error', reject);
    serverProcess.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`serve.mjs s'est arrêté prématurément (code ${code})`));
    });
  });
});

afterAll(() => {
  serverProcess?.kill();
  stubApi?.close();
});

describe('serve.mjs — écoute et fichiers de l’application', () => {
  test('sert index.html à la racine', async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
  });

  test('sert chacun des fichiers prévus de l’application', async () => {
    const files = [
      'app.js',
      'pdf-extraction.js',
      'pdf-detection.js',
      'legal-data.js',
      'inbox-run.js',
      'styles.css',
      'index.html',
    ];
    for (const file of files) {
      const res = await fetch(`${BASE_URL}/${file}`);
      expect(res.status, file).toBe(200);
    }
  });

  test('route inconnue -> 404', async () => {
    const res = await fetch(`${BASE_URL}/inexistant-xyz.js`);
    expect(res.status).toBe(404);
  });
});

describe('serve.mjs — allowlist pdf.js (jamais de route générique vers node_modules)', () => {
  test('sert exactement les deux ressources pdf.js autorisées', async () => {
    for (const route of ['/vendor/pdfjs/pdf.mjs', '/vendor/pdfjs/pdf.worker.min.mjs']) {
      const res = await fetch(`${BASE_URL}${route}`);
      expect(res.status, route).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/javascript/);
    }
  });

  test('un autre fichier réel du paquet pdfjs-dist, non allowlisté, n’est jamais exposé', async () => {
    // `pdf.sandbox.mjs` existe réellement dans node_modules/pdfjs-dist/build/
    // mais n'a jamais été ajouté à l'allowlist : il ne doit jamais être servi.
    const res = await fetch(`${BASE_URL}/vendor/pdfjs/pdf.sandbox.mjs`);
    expect(res.status).toBe(404);
  });

  test('aucune route générique vers node_modules', async () => {
    const res = await fetch(`${BASE_URL}/node_modules/pdfjs-dist/package.json`);
    expect(res.status).toBe(404);
  });

  test('une traversée de répertoire ne sort jamais de la racine servie', async () => {
    const res = await fetch(`${BASE_URL}/../../../etc/passwd`);
    expect([403, 404]).toContain(res.status);
  });
});

describe('serve.mjs — loopback par défaut (source)', () => {
  test('HOST par défaut est 127.0.0.1 si la variable d’environnement est absente', async () => {
    // Contrôle du code source plutôt qu'une liaison réseau réelle sans HOST
    // (éviterait un risque d'écoute large dans l'environnement de test) :
    // `process.env.HOST ?? '127.0.0.1'` est la ligne normative de serve.mjs.
    const source = await (
      await import('node:fs/promises')
    ).readFile(path.join(here, 'serve.mjs'), 'utf8');
    expect(source).toMatch(/process\.env\.HOST\s*\?\?\s*'127\.0\.0\.1'/);
  });
});

describe('serve.mjs — relais Inbox (deux routes exactes, jamais un proxy générique)', () => {
  test('relaie GET /api/inbox/mailboxes vers l’API locale', async () => {
    const res = await fetch(`${BASE_URL}/api/inbox/mailboxes`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ relayed: 'GET /inbox/mailboxes' });
  });

  test('relaie POST /api/inbox/runs avec son corps et le statut de l’API', async () => {
    const payload = JSON.stringify({ mailboxId: 'fixture', maxResults: 3 });
    const res = await fetch(`${BASE_URL}/api/inbox/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ relayed: 'POST /inbox/runs' });
    expect(stubApiRequests.at(-1)).toEqual({ method: 'POST', url: '/inbox/runs', body: payload });
  });

  test('aucune autre route ni méthode n’atteint l’API', async () => {
    const before = stubApiRequests.length;
    const attempts = [
      ['POST', '/api/chat'],
      ['POST', '/api/chat/confirmations/abc'],
      ['GET', '/api/inbox/runs'],
      ['POST', '/api/inbox/mailboxes'],
      ['DELETE', '/api/inbox/runs'],
      ['GET', '/api/inbox/mailboxes?x=1'],
      ['GET', '/api/inbox/mailboxes/../../chat'],
      ['POST', '/api/inbox/runs/'],
      ['GET', '/api/'],
    ];
    for (const [method, route] of attempts) {
      const res = await fetch(`${BASE_URL}${route}`, {
        method,
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      expect(res.status, `${method} ${route}`).toBe(404);
    }

    expect(stubApiRequests.length).toBe(before);
  });

  test('un corps trop volumineux est refusé sans être relayé', async () => {
    const before = stubApiRequests.length;
    const res = await fetch(`${BASE_URL}/api/inbox/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mailboxId: 'x'.repeat(5000), maxResults: 3 }),
    });

    expect(res.status).toBe(413);
    expect(stubApiRequests.length).toBe(before);
  });

  test('la cible du relais est fixée sur 127.0.0.1 (source)', async () => {
    const source = await (
      await import('node:fs/promises')
    ).readFile(path.join(here, 'serve.mjs'), 'utf8');
    expect(source).toMatch(/const API_ORIGIN = `http:\/\/127\.0\.0\.1:\$\{API_PORT\}`/);
  });
});

describe('serve.mjs — relais Inbox réservé à la page servie par ce poste', () => {
  const RUN = JSON.stringify({ mailboxId: 'fixture', maxResults: 3 });
  const JSON_HEADERS = { 'Content-Type': 'application/json' };

  test('refuse un en-tête Host étranger (rebinding DNS), sans rien relayer', async () => {
    const before = stubApiRequests.length;
    const res = await rawRequest({
      route: '/api/inbox/mailboxes',
      headers: { Host: `evil.example:${TEST_PORT}` },
    });

    expect(res.status).toBe(403);
    expect(stubApiRequests.length).toBe(before);
  });

  test.each([
    ['text/plain', { 'Content-Type': 'text/plain' }],
    ['formulaire', { 'Content-Type': 'application/x-www-form-urlencoded' }],
    ['absent', {}],
  ])('refuse un POST dont le type de contenu n’est pas JSON (%s)', async (_label, headers) => {
    const before = stubApiRequests.length;
    const res = await rawRequest({ method: 'POST', route: '/api/inbox/runs', headers, body: RUN });

    expect(res.status).toBe(415);
    expect(stubApiRequests.length).toBe(before);
  });

  test('refuse une origine étrangère, sans rien relayer', async () => {
    const before = stubApiRequests.length;
    const res = await rawRequest({
      method: 'POST',
      route: '/api/inbox/runs',
      headers: { ...JSON_HEADERS, Origin: 'https://evil.example' },
      body: RUN,
    });

    expect(res.status).toBe(403);
    expect(stubApiRequests.length).toBe(before);
  });

  test('accepte l’origine de la page elle-même', async () => {
    const res = await rawRequest({
      method: 'POST',
      route: '/api/inbox/runs',
      headers: { ...JSON_HEADERS, Origin: BASE_URL },
      body: RUN,
    });

    expect(JSON.parse(res.text)).toEqual({ relayed: 'POST /inbox/runs' });
  });
});

describe('serve.mjs — API coupée en cours de réponse', () => {
  test('répond 502 et reste en service', async () => {
    stubApiMode = 'cut';
    try {
      const res = await fetch(`${BASE_URL}/api/inbox/mailboxes`);

      expect(res.status).toBe(502);
      expect((await res.json()).error).toContain('API Jarvis');
    } finally {
      stubApiMode = 'ok';
    }
    expect((await fetch(`${BASE_URL}/`)).status).toBe(200);
  });
});

describe('serve.mjs — API arrêtée', () => {
  test('répond 502 avec un message clair, sans faux résultat', async () => {
    const port = TEST_PORT + 2;
    const child = spawn('node', ['serve.mjs'], {
      cwd: here,
      // 48613 : aucun serveur n'y écoute.
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', JARVIS_API_PORT: '48613' },
    });
    try {
      await new Promise((resolve, reject) => {
        child.stdout.on('data', resolve);
        child.on('error', reject);
      });
      const res = await fetch(`http://127.0.0.1:${port}/api/inbox/mailboxes`);

      expect(res.status).toBe(502);
      expect((await res.json()).error).toContain('API Jarvis injoignable');
    } finally {
      child.kill();
    }
  });
});
