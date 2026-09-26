import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import * as engine from './index.js';

describe('surface publique de @jarvis/legal-case-engine', () => {
  it('exporte exactement les opérations et utilitaires du jalon', () => {
    expect(Object.keys(engine).sort()).toEqual([
      'EQUIVALENCE_CRITERION',
      'LegalCaseEngineError',
      'addOpenQuestion',
      'findEquivalentFacts',
      'normalizeStatement',
      'recordReportedFact',
      'systemClock',
    ]);
  });

  it('n’exporte aucune fixture de test ni aucun helper interne', () => {
    const names = Object.keys(engine);
    for (const internal of [
      'fixedClock',
      'emptyCase',
      'deepFreeze',
      'resolveEngineOptions',
      'assertWritableCase',
    ]) {
      expect(names).not.toContain(internal);
    }
  });

  it('n’expose ni proposition LLM, ni validation, ni correction, ni projection (hors périmètre)', () => {
    const source = readFileSync(join(__dirname, 'index.ts'), 'utf-8');
    expect(source).not.toMatch(/proposal|validateFact|correctFact|discard/i);
  });
});
