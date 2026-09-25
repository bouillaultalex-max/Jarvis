import { describe, expect, it } from 'vitest';

import { createLegalCase } from './legal-case-factory.js';
import { LEGAL_CASE_STATUSES } from './legal-case.js';
import { LEGAL_CASE_V3_KEYS, validateLegalCaseV3 } from './legal-case-validation.js';

describe('createLegalCase', () => {
  it('crée une affaire à l’étape READ avec toutes les listes vides', () => {
    const legalCase = createLegalCase({ title: 'Litige fournisseur — retard de livraison' });

    expect(legalCase.title).toBe('Litige fournisseur — retard de livraison');
    expect(legalCase.jurisdiction).toBe('FR');
    expect(legalCase.status).toBe('READ');
    expect(legalCase.status).toBe(LEGAL_CASE_STATUSES[0]);
    // v3 : facts est une liste plate (aucun état stocké) ; toutes les listes du modèle Fact sont vides.
    expect(legalCase.facts).toEqual([]);
    expect(legalCase.documents).toEqual([]);
    expect(legalCase.evidence).toEqual([]);
    expect(legalCase.questions).toEqual([]);
    expect(legalCase.relations).toEqual([]);
    expect(legalCase.factValidations).toEqual([]);
    expect(legalCase.conflicts).toEqual([]);
    expect(legalCase.resolutionProposals).toEqual([]);
    expect(legalCase.ruleExecutions).toEqual([]);
    expect(legalCase.resolutions).toEqual([]);
    expect(legalCase.research).toEqual([]);
    expect(legalCase.sources).toEqual([]);
    expect(legalCase.citations).toEqual([]);
    expect(legalCase.arguments).toEqual([]);
    expect(legalCase.counterArguments).toEqual([]);
    expect(legalCase.analysis).toEqual([]);
    expect(legalCase.conclusions).toEqual([]);
    expect(legalCase.deadlines).toEqual([]);
    expect(legalCase.actions).toEqual([]);
    expect(legalCase.createdAt).toBe(legalCase.updatedAt);
  });

  it('produit un dossier v3 valide, sans aucune valeur de provenance, de temporalité ou d’état inventée', () => {
    const legalCase = createLegalCase({ title: 'Dossier vide' });

    expect(validateLegalCaseV3(legalCase)).toEqual({ ok: true });
    expect(Object.keys(legalCase).sort()).toEqual([...LEGAL_CASE_V3_KEYS].sort());
  });

  it('génère un id unique par défaut', () => {
    const first = createLegalCase({ title: 'Dossier A' });
    const second = createLegalCase({ title: 'Dossier B' });

    expect(first.id).not.toBe(second.id);
    expect(first.id.length).toBeGreaterThan(0);
  });

  it('accepte un id et un createdAt explicites (tests déterministes)', () => {
    const legalCase = createLegalCase({
      title: 'Dossier avec id fixé',
      id: 'case-fixed-1',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(legalCase.id).toBe('case-fixed-1');
    expect(legalCase.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(legalCase.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('refuse un title vide', () => {
    expect(() => createLegalCase({ title: '' })).toThrowError(/title/);
    expect(() => createLegalCase({ title: '   ' })).toThrowError(/title/);
  });
});
