import type { LegalCaseV2 } from '../legal-case-v2.js';

/**
 * Dossier **v2** littéral (aucune dépendance à `createLegalCase`, qui produit
 * du v3) — sert aux tests du chemin legacy.
 */
export function buildLegalCaseV2Fixture(): LegalCaseV2 {
  return {
    id: 'case-v2-1',
    title: 'Rupture de préavis — CDD',
    jurisdiction: 'FR',
    status: 'ANALYZE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    facts: {
      established: [{ id: 'fact-1', statement: 'Le contrat a été signé le 1er mars 2025.' }],
      alleged: [{ id: 'fact-2', statement: "L'employeur affirme un abandon de poste." }],
      contradictory: [],
      unknown: [{ id: 'fact-3', statement: 'Date exacte de la dernière présence inconnue.' }],
    },
    documents: [{ id: 'doc-1', title: 'Contrat de travail', addedAt: '2026-01-01T00:00:00.000Z' }],
    evidence: [
      { id: 'evi-1', description: 'Échange d’e-mails RH', addedAt: '2026-01-01T00:00:00.000Z' },
    ],
    questions: [{ id: 'q-1', question: 'Le préavis a-t-il été respecté ?', status: 'open' }],
    research: [],
    sources: [],
    citations: [],
    arguments: [],
    counterArguments: [],
    analysis: [],
    conclusions: [],
    deadlines: [],
    actions: [],
  };
}
