import { describe, expect, it } from 'vitest';

import { interpretReadRequest } from './read-intent-parser.js';

/**
 * Tests déterministes de `interpretReadRequest` — VS-02
 * (`docs/second-readonly-vertical-slice.md`). Aucun réseau, aucun LLM,
 * aucun compte Gmail : `interpretReadRequest` est une fonction pure sur une
 * chaîne. Ces tests documentent les **limites** du parser (vocabulaire
 * fermé) plutôt qu'une compréhension générale du langage naturel.
 */

describe('interpretReadRequest — demandes claires', () => {
  it('demande claire sans limite → understood, proposedRead sans maxResults', () => {
    const result = interpretReadRequest('lis mes derniers mails');

    expect(result.status).toBe('understood');
    expect(result.originalRequest).toBe('lis mes derniers mails');
    expect(result.proposedRead).toEqual({ tool: 'gmail.read', input: {} });
  });

  it('demande claire avec limite → understood, proposedRead.input.maxResults renseigné', () => {
    const result = interpretReadRequest('affiche mes 5 derniers mails');

    expect(result.status).toBe('understood');
    expect(result.proposedRead).toEqual({ tool: 'gmail.read', input: { maxResults: 5 } });
  });

  it('variante avec majuscules, espaces et ponctuation → interprétation identique', () => {
    const result = interpretReadRequest('   Affiche   MES 5 Derniers Mails !!  ');

    expect(result.status).toBe('understood');
    expect(result.proposedRead).toEqual({ tool: 'gmail.read', input: { maxResults: 5 } });
  });

  it('« emails » est reconnu comme objet mail', () => {
    const result = interpretReadRequest('montre-moi mes derniers emails');

    expect(result.status).toBe('understood');
    expect(result.proposedRead).toEqual({ tool: 'gmail.read', input: {} });
  });

  it('« messages Gmail » est reconnu comme objet mail', () => {
    const result = interpretReadRequest('montre-moi mes 10 derniers messages Gmail');

    expect(result.status).toBe('understood');
    expect(result.proposedRead).toEqual({ tool: 'gmail.read', input: { maxResults: 10 } });
  });

  it('« consulte » + « emails récents » est reconnu', () => {
    const result = interpretReadRequest('consulte mes emails récents');

    expect(result.status).toBe('understood');
    expect(result.proposedRead).toEqual({ tool: 'gmail.read', input: {} });
  });
});

describe('interpretReadRequest — limites numériques', () => {
  it('limite numérique valide → reprise telle quelle', () => {
    const result = interpretReadRequest('affiche mes 20 derniers mails');

    expect(result.status).toBe('understood');
    expect(result.proposedRead).toEqual({ tool: 'gmail.read', input: { maxResults: 20 } });
  });

  it('limite numérique nulle → ambiguous, aucune proposedRead', () => {
    const result = interpretReadRequest('affiche mes 0 derniers mails');

    expect(result.status).toBe('ambiguous');
    expect(result.proposedRead).toBeUndefined();
  });

  it('limite numérique hors bornes plausibles → ambiguous, aucune proposedRead', () => {
    const result = interpretReadRequest('affiche mes 500 derniers mails');

    expect(result.status).toBe('ambiguous');
    expect(result.proposedRead).toBeUndefined();
  });
});

describe('interpretReadRequest — demandes ambiguës', () => {
  it('demande trop vague (objet reconnu, verbe non reconnu) → ambiguous', () => {
    const result = interpretReadRequest('regarde mes mails');

    expect(result.status).toBe('ambiguous');
    expect(result.proposedRead).toBeUndefined();
    expect(result.explanation.length).toBeGreaterThan(0);
  });

  it('verbe reconnu sans objet mail → ambiguous', () => {
    const result = interpretReadRequest('montre-moi des trucs');

    expect(result.status).toBe('ambiguous');
    expect(result.proposedRead).toBeUndefined();
  });
});

describe('interpretReadRequest — hors périmètre de gmail.read', () => {
  it('filtre non supporté (« importants ») → unsupported', () => {
    const result = interpretReadRequest('montre-moi mes mails importants');

    expect(result.status).toBe('unsupported');
    expect(result.proposedRead).toBeUndefined();
  });

  it('recherche non supportée (« trouve »/« de Paul ») → unsupported', () => {
    const result = interpretReadRequest('trouve le mail de Paul');

    expect(result.status).toBe('unsupported');
    expect(result.proposedRead).toBeUndefined();
  });

  it('demande mixte lecture/écriture → unsupported, jamais de proposedRead', () => {
    const result = interpretReadRequest('lis mes mails et réponds à Paul');

    expect(result.status).toBe('unsupported');
    expect(result.proposedRead).toBeUndefined();
  });

  it('demande de suppression → unsupported', () => {
    const result = interpretReadRequest('supprime mes anciens mails');

    expect(result.status).toBe('unsupported');
    expect(result.proposedRead).toBeUndefined();
  });

  it('demande générale non bornée (aucun verbe/objet reconnu) → unsupported', () => {
    const result = interpretReadRequest('fais ce qu’il faut avec ma boîte');

    expect(result.status).toBe('unsupported');
    expect(result.proposedRead).toBeUndefined();
  });

  it('entrée vide ou uniquement des espaces → unsupported, aucune exception', () => {
    expect(() => interpretReadRequest('')).not.toThrow();
    expect(() => interpretReadRequest('   ')).not.toThrow();

    const result = interpretReadRequest('   ');
    expect(result.status).toBe('unsupported');
    expect(result.proposedRead).toBeUndefined();
  });
});

describe('interpretReadRequest — garanties structurelles', () => {
  it('ne propose jamais un outil autre que « gmail.read »', () => {
    const requests = [
      'lis mes derniers mails',
      'affiche mes 5 derniers mails',
      'lis mes mails et réponds à Paul',
      'supprime mes anciens mails',
      'montre-moi mes mails importants',
      'regarde mes mails',
      '',
    ];

    for (const request of requests) {
      const result = interpretReadRequest(request);
      if (result.proposedRead !== undefined) {
        expect(result.proposedRead.tool).toBe('gmail.read');
      }
    }
  });

  it('ne renvoie jamais un « ToolRequest » exécutable (pas de champ tool/input au premier niveau)', () => {
    const result = interpretReadRequest('lis mes derniers mails');

    expect(result).not.toHaveProperty('tool');
    expect(result).not.toHaveProperty('input');
    expect(result).not.toHaveProperty('confirmed');
  });

  it('les statuts ambiguous et unsupported ne portent jamais de proposedRead exploitable', () => {
    const ambiguousResult = interpretReadRequest('regarde mes mails');
    const unsupportedResult = interpretReadRequest('supprime mes anciens mails');

    expect(ambiguousResult.status).toBe('ambiguous');
    expect(unsupportedResult.status).toBe('unsupported');
    expect(ambiguousResult.proposedRead).toBeUndefined();
    expect(unsupportedResult.proposedRead).toBeUndefined();
  });
});
