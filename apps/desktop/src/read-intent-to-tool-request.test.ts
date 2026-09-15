import { describe, expect, it } from 'vitest';

import type { ReadInterpretation } from './read-intent-parser.js';
import { interpretReadRequest } from './read-intent-parser.js';
import { convertReadInterpretationToToolRequest } from './read-intent-to-tool-request.js';

/**
 * Tests déterministes de `convertReadInterpretationToToolRequest` — VS-02
 * (`docs/second-readonly-vertical-slice.md`). Aucun réseau, aucun LLM,
 * aucun compte Gmail, aucun `ToolExecutor`/`PermissionManager` : fonction
 * pure sur une structure déjà construite. Plusieurs cas construisent une
 * `ReadInterpretation` **à la main** (falsifiée), précisément pour prouver
 * que ce module ne fait jamais confiance à la seule forme déclarée par le
 * type — il revalide toujours à l'exécution.
 */

function forgedUnderstood(overrides: Partial<ReadInterpretation> = {}): ReadInterpretation {
  return {
    status: 'understood',
    originalRequest: 'texte forgé',
    explanation: 'forgé pour test',
    proposedRead: { tool: 'gmail.read', input: {} },
    ...overrides,
  };
}

describe('convertReadInterpretationToToolRequest — cas acceptés', () => {
  it('understood sans maxResults → ToolRequest gmail.read avec input vide', () => {
    const interpretation = interpretReadRequest('lis mes derniers mails');
    const result = convertReadInterpretationToToolRequest(interpretation);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.toolRequest).toEqual({ tool: 'gmail.read', input: {} });
  });

  it('understood avec maxResults valide → ToolRequest gmail.read avec maxResults repris', () => {
    const interpretation = interpretReadRequest('affiche mes 5 derniers mails');
    const result = convertReadInterpretationToToolRequest(interpretation);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.toolRequest).toEqual({ tool: 'gmail.read', input: { maxResults: 5 } });
  });
});

describe('convertReadInterpretationToToolRequest — statuts refusés', () => {
  it('ambiguous → échec explicite, aucun ToolRequest', () => {
    const interpretation = interpretReadRequest('regarde mes mails');
    expect(interpretation.status).toBe('ambiguous');

    const result = convertReadInterpretationToToolRequest(interpretation);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/ambiguous/);
  });

  it('unsupported → échec explicite, aucun ToolRequest', () => {
    const interpretation = interpretReadRequest('supprime mes anciens mails');
    expect(interpretation.status).toBe('unsupported');

    const result = convertReadInterpretationToToolRequest(interpretation);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/unsupported/);
  });
});

describe('convertReadInterpretationToToolRequest — défenses contre une interprétation falsifiée', () => {
  it('understood sans proposedRead → échec explicite', () => {
    const interpretation = forgedUnderstood({ proposedRead: undefined });

    const result = convertReadInterpretationToToolRequest(interpretation);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/proposedRead/);
  });

  it('outil différent de « gmail.read » (falsifié) → échec explicite, jamais converti', () => {
    const interpretation = forgedUnderstood({
      proposedRead: { tool: 'gmail.send' as unknown as 'gmail.read', input: {} },
    });

    const result = convertReadInterpretationToToolRequest(interpretation);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/gmail\.send/);
  });

  it('input avec champ inattendu → échec explicite, jamais d’input partiel', () => {
    const interpretation = forgedUnderstood({
      proposedRead: {
        tool: 'gmail.read',
        input: { maxResults: 5, query: 'importants' } as never,
      },
    });

    const result = convertReadInterpretationToToolRequest(interpretation);

    expect(result.ok).toBe(false);
  });

  it('maxResults nul → échec explicite', () => {
    const interpretation = forgedUnderstood({
      proposedRead: { tool: 'gmail.read', input: { maxResults: 0 } },
    });

    const result = convertReadInterpretationToToolRequest(interpretation);

    expect(result.ok).toBe(false);
  });

  it('maxResults négatif → échec explicite', () => {
    const interpretation = forgedUnderstood({
      proposedRead: { tool: 'gmail.read', input: { maxResults: -3 } },
    });

    const result = convertReadInterpretationToToolRequest(interpretation);

    expect(result.ok).toBe(false);
  });

  it('maxResults hors bornes (au-delà de ce que gmail.read accepte) → échec explicite', () => {
    const interpretation = forgedUnderstood({
      proposedRead: { tool: 'gmail.read', input: { maxResults: 500 } },
    });

    const result = convertReadInterpretationToToolRequest(interpretation);

    expect(result.ok).toBe(false);
  });

  it('maxResults non entier → échec explicite', () => {
    const interpretation = forgedUnderstood({
      proposedRead: { tool: 'gmail.read', input: { maxResults: 3.5 } },
    });

    const result = convertReadInterpretationToToolRequest(interpretation);

    expect(result.ok).toBe(false);
  });
});

describe('convertReadInterpretationToToolRequest — garanties structurelles', () => {
  it('ne produit jamais de champ authorized/confirmed/execute/ticket/permission/confirmation/verified', () => {
    const interpretation = interpretReadRequest('affiche mes 5 derniers mails');
    const result = convertReadInterpretationToToolRequest(interpretation);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const forbidden of [
      'authorized',
      'confirmed',
      'execute',
      'ticket',
      'permission',
      'confirmation',
      'verified',
    ]) {
      expect(result.toolRequest).not.toHaveProperty(forbidden);
    }
  });

  it('le résultat est seulement un ToolRequest décrit, jamais une exécution : aucune clé « output »/« status: executed »', () => {
    const interpretation = interpretReadRequest('lis mes derniers mails');
    const result = convertReadInterpretationToToolRequest(interpretation);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.toolRequest).not.toHaveProperty('output');
    expect(result.toolRequest).not.toHaveProperty('status');
    expect(Object.keys(result.toolRequest).sort()).toEqual(['input', 'tool']);
  });

  it('absence d’effet de bord : aucune exception, aucune mutation de l’interprétation fournie', () => {
    const interpretation = interpretReadRequest('affiche mes 5 derniers mails');
    const before = JSON.stringify(interpretation);

    expect(() => convertReadInterpretationToToolRequest(interpretation)).not.toThrow();

    expect(JSON.stringify(interpretation)).toBe(before);
  });

  it('ne retourne jamais un ToolRequest pour un statut non « understood », quel que soit le contenu de proposedRead', () => {
    const interpretation: ReadInterpretation = {
      status: 'ambiguous',
      originalRequest: 'texte forgé',
      explanation: 'forgé',
      // `proposedRead` ne devrait structurellement jamais être présent ici,
      // mais ce test prouve que même s'il l'était, la conversion refuse
      // dès le statut, avant même de l'examiner.
      proposedRead: { tool: 'gmail.read', input: { maxResults: 5 } },
    };

    const result = convertReadInterpretationToToolRequest(interpretation);

    expect(result.ok).toBe(false);
  });
});
