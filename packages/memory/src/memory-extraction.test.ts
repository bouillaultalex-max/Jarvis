import { describe, expect, it, vi } from 'vitest';

import type { MemoryInteraction } from './memory-extraction.js';
import {
  MAX_INTERACTION_EXCERPT_CHARS,
  MAX_MEMORY_CANDIDATES,
  buildMemoryExtractionUserPrompt,
  createLlmMemoryExtractor,
  parseMemoryExtraction,
} from './memory-extraction.js';

const INTERACTION: MemoryInteraction = {
  userMessage: 'Je préfère qu’on se parle en français.',
  assistantReply: 'Entendu, je répondrai en français.',
};

function candidateJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'preference',
    subject: 'langue',
    statement: 'L’utilisateur préfère échanger en français.',
    provenance: { origin: 'llm_proposed', confidence: 0.7 },
    ...overrides,
  };
}

describe('parseMemoryExtraction — cas exploitables', () => {
  it('tableau vide → ok, aucun candidat', () => {
    expect(parseMemoryExtraction('[]')).toEqual({ status: 'ok', candidates: [] });
  });

  it('un candidat valide → ok', () => {
    const result = parseMemoryExtraction(JSON.stringify([candidateJson()]));
    expect(result).toEqual({
      status: 'ok',
      candidates: [
        {
          kind: 'preference',
          subject: 'langue',
          statement: 'L’utilisateur préfère échanger en français.',
          provenance: { origin: 'llm_proposed', confidence: 0.7 },
        },
      ],
    });
  });

  it('plusieurs candidats valides → ok, ordre conservé', () => {
    const result = parseMemoryExtraction(
      JSON.stringify([
        candidateJson({ subject: 'a', statement: 'A.' }),
        candidateJson({ subject: 'b', statement: 'B.' }),
        candidateJson({ subject: 'c', statement: 'C.' }),
      ]),
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.candidates.map((c) => c.subject)).toEqual(['a', 'b', 'c']);
  });

  it('déterministe : deux appels identiques → résultat identique', () => {
    const raw = JSON.stringify([candidateJson()]);
    expect(parseMemoryExtraction(raw)).toEqual(parseMemoryExtraction(raw));
  });
});

describe('parseMemoryExtraction — sorties malformées → invalid', () => {
  it('JSON invalide', () => {
    expect(parseMemoryExtraction('pas du json')).toMatchObject({ status: 'invalid' });
  });

  it('JSON valide mais pas un tableau', () => {
    expect(parseMemoryExtraction('{}')).toMatchObject({ status: 'invalid' });
    expect(parseMemoryExtraction('"texte"')).toMatchObject({ status: 'invalid' });
    expect(parseMemoryExtraction('null')).toMatchObject({ status: 'invalid' });
  });

  it('tout ou rien : un seul élément invalide → invalid, avec l’index', () => {
    const raw = JSON.stringify([candidateJson(), candidateJson({ kind: 'note' })]);
    expect(parseMemoryExtraction(raw)).toMatchObject({
      status: 'invalid',
      reason: expect.stringContaining('#2'),
    });
  });

  it('kind invalide', () => {
    expect(
      parseMemoryExtraction(JSON.stringify([candidateJson({ kind: 'reminder' })])),
    ).toMatchObject({ status: 'invalid', reason: expect.stringContaining('kind') });
  });

  it('subject vide', () => {
    expect(parseMemoryExtraction(JSON.stringify([candidateJson({ subject: '' })]))).toMatchObject({
      status: 'invalid',
      reason: expect.stringContaining('subject'),
    });
  });

  it('statement vide', () => {
    expect(
      parseMemoryExtraction(JSON.stringify([candidateJson({ statement: '   ' })])),
    ).toMatchObject({ status: 'invalid', reason: expect.stringContaining('statement') });
  });

  it('provenance invalide', () => {
    expect(
      parseMemoryExtraction(JSON.stringify([candidateJson({ provenance: { origin: 'oops' } })])),
    ).toMatchObject({ status: 'invalid' });
  });

  it('confidence hors limites', () => {
    expect(
      parseMemoryExtraction(
        JSON.stringify([candidateJson({ provenance: { origin: 'llm_proposed', confidence: 2 } })]),
      ),
    ).toMatchObject({ status: 'invalid', reason: expect.stringContaining('confidence') });
  });

  it('propriété inattendue', () => {
    expect(parseMemoryExtraction(JSON.stringify([candidateJson({ importance: 9 })]))).toMatchObject(
      { status: 'invalid', reason: expect.stringContaining('importance') },
    );
  });

  it('origine ≠ llm_proposed → invalid (une extraction ne peut pas se déclarer « affirmée »)', () => {
    expect(
      parseMemoryExtraction(
        JSON.stringify([candidateJson({ provenance: { origin: 'user_stated' } })]),
      ),
    ).toMatchObject({ status: 'invalid', reason: expect.stringContaining('llm_proposed') });
    expect(
      parseMemoryExtraction(
        JSON.stringify([
          candidateJson({ provenance: { origin: 'email_extracted', confidence: 0.5 } }),
        ]),
      ),
    ).toMatchObject({ status: 'invalid', reason: expect.stringContaining('llm_proposed') });
  });

  it('trop de candidats → invalid', () => {
    const many = Array.from({ length: MAX_MEMORY_CANDIDATES + 1 }, (_unused, i) =>
      candidateJson({ subject: `s${i}` }),
    );
    expect(parseMemoryExtraction(JSON.stringify(many))).toMatchObject({
      status: 'invalid',
      reason: expect.stringContaining(`${MAX_MEMORY_CANDIDATES}`),
    });
  });
});

describe('createLlmMemoryExtractor', () => {
  it('appel modèle → JSON valide → ok', async () => {
    const extractor = createLlmMemoryExtractor(async () => JSON.stringify([candidateJson()]));
    const result = await extractor.extract(INTERACTION);
    expect(result.status).toBe('ok');
  });

  it('appel modèle qui lève → error, jamais d’exception propagée', async () => {
    const extractor = createLlmMemoryExtractor(async () => {
      throw new Error('réseau coupé');
    });
    await expect(extractor.extract(INTERACTION)).resolves.toMatchObject({
      status: 'error',
      reason: expect.stringContaining('réseau coupé'),
    });
  });

  it('appel modèle → sortie malformée → invalid', async () => {
    const extractor = createLlmMemoryExtractor(async () => 'blabla');
    await expect(extractor.extract(INTERACTION)).resolves.toMatchObject({ status: 'invalid' });
  });

  it('l’extracteur ne reçoit ni ne touche aucun MemoryStore (contrat)', async () => {
    const call = vi.fn(async () => '[]');
    const extractor = createLlmMemoryExtractor(call);
    await extractor.extract(INTERACTION);
    // `call` ne reçoit que l'interaction — aucun store, aucun accès I/O.
    expect(call).toHaveBeenCalledWith(INTERACTION);
    expect(Object.keys(extractor)).toEqual(['extract']);
  });

  it('déterministe : même sortie modèle → même résultat', async () => {
    const raw = JSON.stringify([candidateJson()]);
    const extractor = createLlmMemoryExtractor(async () => raw);
    expect(await extractor.extract(INTERACTION)).toEqual(await extractor.extract(INTERACTION));
  });
});

describe('buildMemoryExtractionUserPrompt', () => {
  it('inclut les deux messages', () => {
    const prompt = buildMemoryExtractionUserPrompt(INTERACTION);
    expect(prompt).toContain(INTERACTION.userMessage);
    expect(prompt).toContain(INTERACTION.assistantReply);
  });

  it('borne chaque champ', () => {
    const long = 'x'.repeat(MAX_INTERACTION_EXCERPT_CHARS + 500);
    const prompt = buildMemoryExtractionUserPrompt({ userMessage: long, assistantReply: long });
    expect(prompt).toContain('…');
    expect(prompt).not.toContain('x'.repeat(MAX_INTERACTION_EXCERPT_CHARS + 1));
  });
});
