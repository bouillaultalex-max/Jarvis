import { describe, test, expect, vi, beforeEach } from 'vitest';

// `pdf-extraction.js` importe `./vendor/pdfjs/pdf.mjs` — une route virtuelle
// servie uniquement par `serve.mjs` (voir son allowlist dans serve.mjs et
// serve.test.js), aucun fichier réel à ce chemin dans le dépôt. On
// intercepte cet import précis pour qu'il résolve vers le vrai paquet déjà
// installé (`pdfjs-dist`), avec son build « legacy » (requis sous Node —
// le navigateur réel utilise le build principal `pdfjs-dist/build/pdf.mjs`,
// celui que `pdf-extraction.js` configure réellement ; cette substitution
// est une particularité de l'environnement de test Node, pas de
// l'application, documentée aussi dans le journal Obsidian du 30/10/2026).
// Aucune nouvelle dépendance : même paquet que celui déjà utilisé par l'app.
vi.mock('./vendor/pdfjs/pdf.mjs', async () => {
  const real = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // `getDocument` est espionnable (vi.fn) pour le seul cas qui ne peut pas
  // être exercé avec un vrai fichier chiffré (aucun outil pour en fabriquer
  // un sans nouvelle dépendance — limite déjà consignée le 30/10/2026) :
  // tout le reste appelle l'implémentation réelle, inchangée.
  return { ...real, getDocument: vi.fn(real.getDocument) };
});

const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
const extractionModule = await import('./pdf-extraction.js');
const { startExtraction, cancelExtraction, isExtractionActive } = extractionModule;
const mockedPdfjs = await import('./vendor/pdfjs/pdf.mjs');

// `pdf-extraction.js` fixe, à l'import, `GlobalWorkerOptions.workerSrc` sur
// le chemin relatif réel (navigateur) `./vendor/pdfjs/pdf.worker.min.mjs` —
// introuvable tel quel sous Node. `GlobalWorkerOptions` est une classe
// partagée (état statique) : on corrige ce chemin, une seule fois, vers le
// vrai fichier worker du build « legacy » déjà installé, pour ce fichier de
// test uniquement. Le navigateur réel utilise le chemin que le code
// configure réellement ; cette correction est une particularité de
// l'environnement Node, pas de l'application.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url,
).pathname;

beforeEach(() => {
  mockedPdfjs.getDocument.mockImplementation(pdfjsLib.getDocument);
});

// --- Fabrique de PDF synthétiques minimaux (aucun document réel) ---------
// Chaque page est une liste de LIGNES, jamais une ligne unique trop longue :
// pdf.js tronque réellement l'extraction d'une ligne non repartie dès
// qu'elle dépasse la largeur visible de la page — comportement du vrai
// moteur rencontré et documenté le 30/10/2026, pas un défaut de l'app. Un
// vrai PDF répartit toujours son texte sur des lignes ; ces fixtures font
// de même pour rester représentatives.
function escapePdfString(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildPdf(pagesOfLines) {
  const objects = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = pagesOfLines.map((_, i) => `${3 + i * 2} 0 R`);
  objects.push(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pagesOfLines.length} >>`);
  const fontObjNum = 3 + pagesOfLines.length * 2;
  for (const lines of pagesOfLines) {
    const pageObjNum = objects.length + 1;
    const contentObjNum = pageObjNum + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> /MediaBox [0 0 612 792] /Contents ${contentObjNum} 0 R >>`,
    );
    // L'extraction de texte de pdf.js ignore le texte positionné hors de la
    // zone visible (`MediaBox`) — une ligne qui descendrait sous y=0 ne
    // serait jamais extraite. On fait boucler la position verticale : la
    // superposition visuelle qui en résulterait n'affecte en rien
    // l'extraction du texte, seul le rendu visuel (non testé ici).
    const stream = lines
      .map(
        (line, i) => `BT /F1 12 Tf 72 ${700 - (i % 40) * 16} Td (${escapePdfString(line)}) Tj ET`,
      )
      .join('\n');
    objects.push({ stream });
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(body.length);
    const obj = objects[i];
    if (typeof obj === 'string') body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    else
      body += `${i + 1} 0 obj\n<< /Length ${obj.stream.length} >>\nstream\n${obj.stream}\nendstream\nendobj\n`;
  }
  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body, 'latin1');
}

function fakeFile(bytes, name) {
  return new File([bytes], name, { type: 'application/pdf' });
}

function newDoc(id, bytes, name) {
  return { id, name, extension: 'pdf', size: bytes.length, file: fakeFile(bytes, name) };
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('pdf-extraction.js — vrai moteur pdf.js (build legacy sous Node), PDF synthétiques uniquement', () => {
  test('extraction simple : texte réel retrouvé', async () => {
    const extraction = {};
    const doc = newDoc('d1', buildPdf([['Hello world test one']]), 'simple.pdf');
    await startExtraction('d1', [doc], extraction, () => {});
    expect(extraction.d1.status).toBe('complete');
    expect(extraction.d1.pages[0].text).toBe('Hello world test one');
  });

  test('multipage : pages séparées, dans l’ordre, texte distinct par page', async () => {
    const extraction = {};
    const doc = newDoc(
      'd2',
      buildPdf([['Page One Marker'], ['Page Two Marker'], ['Page Three Marker']]),
      'multi.pdf',
    );
    await startExtraction('d2', [doc], extraction, () => {});
    expect(extraction.d2.pages.map((p) => p.text)).toEqual([
      'Page One Marker',
      'Page Two Marker',
      'Page Three Marker',
    ]);
  });

  test('PDF sans aucun texte (page vide) : statut "empty", pas un plantage', async () => {
    const extraction = {};
    // Contenu sans aucun Tj : un simple rectangle tracé.
    const bytes = buildPdf([[]]); // aucune ligne -> stream vide, aucun opérateur de texte
    const doc = newDoc('d3', bytes, 'vide.pdf');
    await startExtraction('d3', [doc], extraction, () => {});
    expect(extraction.d3.status).toBe('empty');
  });

  test('PDF corrompu (tronqué) : statut "invalid" via la vraie InvalidPDFException', async () => {
    const extraction = {};
    const valid = buildPdf([['Un texte quelconque pour avoir un PDF valide au départ.']]);
    const corrupted = valid.subarray(0, Math.floor(valid.length * 0.4));
    const doc = newDoc('d4', corrupted, 'corrompu.pdf');
    await startExtraction('d4', [doc], extraction, () => {});
    expect(extraction.d4.status).toBe('invalid');
  });

  test('PDF protégé : statut "protected" via la vraie classe PasswordException (chargement simulé au point exact où pdf.js échoue réellement — aucun fichier chiffré fabriqué, limite déjà consignée)', async () => {
    const extraction = {};
    mockedPdfjs.getDocument.mockImplementationOnce(() => ({
      promise: Promise.reject(new pdfjsLib.PasswordException('mot de passe requis', 1)),
      destroy: async () => {},
      destroyed: false,
    }));
    const doc = newDoc('d5', buildPdf([['peu importe']]), 'protege.pdf');
    await startExtraction('d5', [doc], extraction, () => {});
    expect(extraction.d5.status).toBe('protected');
  });

  test('limite de pages (50) : au-delà, lecture arrêtée et signalée, total réel conservé', async () => {
    const extraction = {};
    const pages = Array.from({ length: 60 }, (_, i) => [`Page ${i + 1}`]);
    const doc = newDoc('d6', buildPdf(pages), 'beaucoup-de-pages.pdf');
    await startExtraction('d6', [doc], extraction, () => {});
    expect(extraction.d6.status).toBe('limit-reached');
    expect(extraction.d6.pageCountRead).toBe(50);
    expect(extraction.d6.pageCountTotal).toBe(60);
    expect(extraction.d6.pageTruncated).toBe(true);
  }, 20000);

  test('limite de caractères (200000) : troncature au seuil exact, jamais au-delà', async () => {
    const extraction = {};
    const line = 'mot '.repeat(15).trim();
    const lines = Array.from({ length: 4100 }, () => line); // largement > 200000 caractères au total
    const doc = newDoc('d7', buildPdf([lines]), 'tres-long.pdf');
    await startExtraction('d7', [doc], extraction, () => {});
    expect(extraction.d7.status).toBe('limit-reached');
    expect(extraction.d7.charTruncated).toBe(true);
    expect(extraction.d7.charCount).toBeLessThanOrEqual(200000);
  }, 20000);

  test('annulation immédiate : statut "cancelled", aucun résultat tardif', async () => {
    const extraction = {};
    const pages = Array.from({ length: 50 }, (_, i) => [`Page ${i + 1}`]);
    const doc = newDoc('d8', buildPdf(pages), 'annulable.pdf');
    const run = startExtraction('d8', [doc], extraction, () => {});
    cancelExtraction('d8', extraction, () => {}); // avant toute résolution asynchrone
    await run;
    expect(extraction.d8.status).toBe('cancelled');
    expect(extraction.d8.pages ?? []).toHaveLength(0);
  });

  test('une seule extraction à la fois : la deuxième demande est un no-op pendant que la première tourne', async () => {
    const extraction = {};
    const pages = Array.from({ length: 50 }, (_, i) => [`Page ${i + 1}`]);
    const docA = newDoc('d9a', buildPdf(pages), 'a.pdf');
    const docB = newDoc('d9b', buildPdf([['peu importe']]), 'b.pdf');
    const runA = startExtraction('d9a', [docA, docB], extraction, () => {});
    await startExtraction('d9b', [docA, docB], extraction, () => {});
    expect(extraction.d9b).toBeUndefined();
    expect(isExtractionActive('d9a')).toBe(true);
    cancelExtraction('d9a', extraction, () => {});
    await runA;
  });
});
