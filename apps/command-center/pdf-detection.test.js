import { describe, test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { detectElements, hasDetectableText } from './pdf-detection.js';
import { DETECTION_MAX_OCCURRENCES_PER_TYPE } from './legal-data.js';

// Module pur : aucun DOM, aucun PDF, aucun document réel — uniquement du
// texte inventé, dans la forme réellement produite par pdf-extraction.js
// (`{ page, text, error? }`).
function pages(...texts) {
  return texts.map((text, i) => ({ page: i + 1, text }));
}

const moduleSource = await readFile(
  fileURLToPath(new URL('./pdf-detection.js', import.meta.url)),
  'utf8',
);

describe('pdf-detection.js — motifs présents', () => {
  test('date numérique, date en lettres, montant et référence d’article détectés dans un même texte', () => {
    const r = detectElements(
      pages(
        'Le contrat du 15/03/2026 prévoit un paiement de 1 500 € avant le 1 avril 2026, voir article L1234-5.',
      ),
    );
    expect(r.byType.date).toHaveLength(2);
    expect(r.byType.date.map((d) => d.value)).toContain('15/03/2026');
    expect(r.byType.date.map((d) => d.value)).toContain('1 avril 2026');
    expect(r.byType.amount).toHaveLength(1);
    expect(r.byType.amount[0].value).toBe('1 500 €');
    expect(r.byType.article).toHaveLength(1);
    expect(r.byType.article[0].value).toBe('article L1234-5');
  });
});

describe('pdf-detection.js — motifs absents', () => {
  test('texte neutre : aucun motif détecté, jamais une affirmation sur le document', () => {
    const r = detectElements(
      pages('Ce texte ne contient aucun motif numérique particulier à signaler ici.'),
    );
    expect(r.byType.date).toHaveLength(0);
    expect(r.byType.amount).toHaveLength(0);
    expect(r.byType.article).toHaveLength(0);
  });
});

describe('pdf-detection.js — accents', () => {
  test('mois accentués (février, août, décembre) détectés et préservés', () => {
    const r = detectElements(
      pages('Échéance au 3 février 2026, confirmée le 28 août 2026, close le 1 décembre 2026.'),
    );
    const values = r.byType.date.map((d) => d.value);
    expect(values).toContain('3 février 2026');
    expect(values).toContain('28 août 2026');
    expect(values).toContain('1 décembre 2026');
  });
});

describe('pdf-detection.js — espaces insécables', () => {
  test('montant avec espace insécable (U+00A0) : détecté, valeur exacte préservée', () => {
    const nbsp = ' ';
    const r = detectElements(pages(`Le montant dû est de 15${nbsp}000${nbsp}€ au titre du solde.`));
    expect(r.byType.amount).toHaveLength(1);
    expect(r.byType.amount[0].value).toBe(`15${nbsp}000${nbsp}€`);
  });
});

describe('pdf-detection.js — dates ambiguës', () => {
  test('date jour/mois ambiguë conservée telle quelle, aucune résolution', () => {
    const r = detectElements(pages('Signé le 03/04/2026 (jour/mois ambigu, non résolu).'));
    expect(r.byType.date).toHaveLength(1);
    expect(r.byType.date[0].value).toBe('03/04/2026');
  });
});

describe('pdf-detection.js — montants français', () => {
  test('décimale virgule, EUR, francs', () => {
    const r = detectElements(
      pages('Montants : 1 234,56 €, 50,00 EUR, et 100 000 francs (ancien franc).'),
    );
    const values = r.byType.amount.map((a) => a.value);
    expect(values).toContain('1 234,56 €');
    expect(values).toContain('50,00 EUR');
    expect(values).toContain('100 000 francs');
  });
});

describe('pdf-detection.js — références d’articles', () => {
  test('trois formes : "art. N", "article L. N-N", "art. LN-N"', () => {
    const r = detectElements(
      pages('Voir art. 1240 du Code civil, article L. 1234-5, et art. L621-1.'),
    );
    const values = r.byType.article.map((a) => a.value);
    expect(values).toContain('art. 1240');
    expect(values).toContain('article L. 1234-5');
    expect(values).toContain('art. L621-1');
  });
});

describe('pdf-detection.js — répétitions', () => {
  test('même date sur deux pages : deux occurrences distinctes, pages correctement attribuées', () => {
    const r = detectElements(
      pages('Échéance au 15 mars 2026.', 'Rappel : échéance au 15 mars 2026.'),
    );
    expect(r.byType.date).toHaveLength(2);
    expect(r.byType.date.map((d) => d.page)).toEqual([1, 2]);
  });

  test('même montant deux fois sur la même page : les deux occurrences conservées (aucune fusion)', () => {
    const r = detectElements(
      pages('Le 1 500 € dû le 10/01/2026, puis un second versement de 1 500 € le 10/02/2026.'),
    );
    expect(r.byType.amount).toHaveLength(2);
  });

  test('doublon technique exact (même type/page/position) dédupliqué', () => {
    const page = pages('Le 15/03/2026 est la date.')[0];
    const r = detectElements([page, page]); // même page (même numéro, même texte) présentée deux fois
    const onPage1 = r.byType.date.filter((d) => d.page === 1);
    expect(onPage1).toHaveLength(1);
  });
});

describe('pdf-detection.js — vocabulaire imposé', () => {
  test('« Aucun élément repéré automatiquement » présent dans le code, jamais « information absente du document »', () => {
    expect(moduleSource).toContain('Aucun élément repéré automatiquement');
    expect(moduleSource.toLowerCase()).not.toContain('absente du document');
  });

  test('aucun mot de qualification juridique dans le code', () => {
    const forbidden = ['illégal', 'conforme', 'valide juridiquement', 'nul et non avenu'];
    const found = forbidden.filter((w) => moduleSource.toLowerCase().includes(w));
    expect(found).toEqual([]);
  });
});

describe('pdf-detection.js — limites', () => {
  test('dépassement de la limite par type : plafonné et signalé, jamais silencieux', () => {
    const manyDates = Array.from(
      { length: DETECTION_MAX_OCCURRENCES_PER_TYPE + 20 },
      (_, i) => `${(i % 28) + 1}/01/2026`,
    ).join(', ');
    const r = detectElements(pages(manyDates));
    expect(r.byType.date).toHaveLength(DETECTION_MAX_OCCURRENCES_PER_TYPE);
    expect(r.truncated.date).toBe(true);
    expect(r.truncated.amount).toBe(false);
    expect(r.truncated.article).toBe(false);
  });
});

describe('pdf-detection.js — contenu ressemblant à du HTML', () => {
  test('ne perturbe pas la détection ; aucune valeur détectée ne contient la balise elle-même', () => {
    const r = detectElements(
      pages(
        '<script>alert(1)</script> Le paiement de 2 000 € est dû le 05/06/2026, voir art. 1103.',
      ),
    );
    expect(r.byType.amount[0]?.value).toBe('2 000 €');
    expect(r.byType.date[0]?.value).toBe('05/06/2026');
    expect(r.byType.article).toHaveLength(1);
    const allValues = [...r.byType.date, ...r.byType.amount, ...r.byType.article].map(
      (o) => o.value,
    );
    expect(allValues.some((v) => v.includes('<script>'))).toBe(false);
  });
});

describe('pdf-detection.js — pages en erreur', () => {
  test('page en erreur ignorée sans plantage ; page valide traitée normalement', () => {
    const r = detectElements([
      { page: 1, text: '', error: 'Erreur sur cette page.' },
      { page: 2, text: 'Paiement de 300 € le 01/01/2026.' },
    ]);
    expect(r.byType.amount).toHaveLength(1);
    expect(r.byType.amount[0].page).toBe(2);
  });
});

describe('pdf-detection.js — hasDetectableText (règles de visibilité du bouton)', () => {
  test.each([
    ['complete avec texte', { status: 'complete', pages: [{ page: 1, text: 'abc' }] }, true],
    ['empty', { status: 'empty', pages: [] }, false],
    ['protected', { status: 'protected', pages: [] }, false],
    ['running (extraction en cours)', { status: 'running', pages: [] }, false],
    ['cancelled', { status: 'cancelled', pages: [] }, false],
    ['aucune extraction (entrée absente)', undefined, false],
    [
      'complete mais aucune page avec du texte réel',
      { status: 'complete', pages: [{ page: 1, text: '' }] },
      false,
    ],
  ])('%s', (_label, entry, expected) => {
    expect(hasDetectableText(entry)).toBe(expected);
  });
});
