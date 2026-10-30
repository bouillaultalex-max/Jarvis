import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Démarre le vrai serve.mjs (aucune réécriture pour le rendre « testable »)
// sur un port dédié au test, distinct du port de développement (4610), pour
// vérifier son comportement réel : écoute en loopback, allowlist stricte
// des deux ressources pdf.js, aucune route générique vers node_modules.
const here = path.dirname(fileURLToPath(import.meta.url));
const TEST_PORT = 48610;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
let serverProcess;

beforeAll(async () => {
  serverProcess = spawn('node', ['serve.mjs'], {
    cwd: here,
    env: { ...process.env, PORT: String(TEST_PORT), HOST: '127.0.0.1' },
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
      'data.js',
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
