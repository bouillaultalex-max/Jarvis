import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * Vérifie les règles de frontières **effectivement appliquées** par ESLint (configuration
 * réelle du dépôt, pas une recherche de chaînes dans `eslint.config.js`) : chaque extrait
 * est linté comme s'il était un fichier de `src/` ou de `src/testing/`. Décision D1 : la seule
 * dépendance est le point d'entrée public de `@jarvis/legal-core`. Complété par un test
 * statique ciblé (imports relatifs, chargement dynamique) sur le code de production.
 */
const ROOT = resolve(__dirname, '../../..');
const PACKAGE_SRC = join(ROOT, 'packages/legal-case-engine/src');
const eslint = new ESLint({ cwd: ROOT });

type Depth = 'src' | 'testing';
const FILE: Record<Depth, string> = {
  src: join(PACKAGE_SRC, 'probe.ts'),
  testing: join(PACKAGE_SRC, 'testing', 'probe.ts'),
};

/** Règles en erreur (sévérité 2) — un extrait qui ne se parse pas compte aussi comme erreur. */
async function errorsOf(code: string, depth: Depth): Promise<readonly (string | null)[]> {
  const [result] = await eslint.lintText(code, { filePath: FILE[depth] });
  return result!.messages.filter((message) => message.severity === 2).map((m) => m.ruleId);
}

const IMPORT_RULE = '@typescript-eslint/no-restricted-imports';
const SYNTAX_RULE = 'no-restricted-syntax';

describe('règles ESLint de frontières — imports autorisés', () => {
  it.each<[string, string, Depth]>([
    [
      'point d’entrée public de legal-core',
      `import { createLegalCase } from '@jarvis/legal-core';\nexport default createLegalCase;`,
      'src',
    ],
    [
      'import de type de legal-core',
      `import type { LegalCase } from '@jarvis/legal-core';\nexport type A = LegalCase;`,
      'src',
    ],
    ['réexport depuis legal-core', `export { createLegalCase } from '@jarvis/legal-core';`, 'src'],
    [
      'relatif interne (même dossier)',
      `import { LegalCaseEngineError } from './errors.js';\nexport default LegalCaseEngineError;`,
      'src',
    ],
    [
      'relatif interne depuis testing/ vers src/',
      `import { addOpenQuestion } from '../add-open-question.js';\nexport default addOpenQuestion;`,
      'testing',
    ],
    [
      'relatif interne dans testing/',
      `import { CONTEXT } from './engine-fixtures.js';\nexport default CONTEXT;`,
      'testing',
    ],
    [
      'module node natif',
      `import { readFileSync } from 'node:fs';\nexport default readFileSync;`,
      'src',
    ],
    ['tiers (vitest)', `import { it } from 'vitest';\nexport default it;`, 'src'],
    [
      'legal-core aussi depuis testing/',
      `import { createLegalCase } from '@jarvis/legal-core';\nexport default createLegalCase;`,
      'testing',
    ],
  ])('autorise : %s', async (_label, code, depth) => {
    expect(await errorsOf(code, depth)).toEqual([]);
  });
});

describe('règles ESLint de frontières — imports interdits', () => {
  const forbiddenImports: readonly [string, string, Depth][] = [
    [
      'relatif sortant (src → autre package)',
      `import x from '../../core/src/index.js';\nexport default x;`,
      'src',
    ],
    [
      'relatif sortant d’un niveau (src → racine du package)',
      `import x from '../package.json';\nexport default x;`,
      'src',
    ],
    [
      'relatif sortant (testing → autre package)',
      `import x from '../../../core/src/index.js';\nexport default x;`,
      'testing',
    ],
    [
      'relatif sortant de src depuis testing/',
      `import x from '../../package.json';\nexport default x;`,
      'testing',
    ],
    [
      'legal-core : sous-chemin profond',
      `import x from '@jarvis/legal-core/src/index.js';\nexport default x;`,
      'src',
    ],
    [
      'legal-core : fixtures de test',
      `import x from '@jarvis/legal-core/src/testing/legal-v3-fixtures.js';\nexport default x;`,
      'src',
    ],
    [
      'legal-core : package.json',
      `import x from '@jarvis/legal-core/package.json';\nexport default x;`,
      'src',
    ],
    [
      'legal-core : sous-chemin depuis testing/',
      `import x from '@jarvis/legal-core/src/index.js';\nexport default x;`,
      'testing',
    ],
    ['autre package @jarvis/inbox', `import x from '@jarvis/inbox';\nexport default x;`, 'src'],
    ['autre package @jarvis/core', `import x from '@jarvis/core';\nexport default x;`, 'src'],
    ['autre package @jarvis/memory', `import x from '@jarvis/memory';\nexport default x;`, 'src'],
    [
      'autre package @jarvis/legal-research',
      `import x from '@jarvis/legal-research';\nexport default x;`,
      'testing',
    ],
    [
      'import de type d’un autre package',
      `import type { T } from '@jarvis/connectors';\nexport type U = T;`,
      'src',
    ],
    ['réexport d’un autre package', `export * from '@jarvis/llm';`, 'src'],
    ['réexport nommé d’un autre package', `export { x } from '@jarvis/tools';`, 'testing'],
  ];

  it.each(forbiddenImports)('interdit : %s', async (_label, code, depth) => {
    expect(await errorsOf(code, depth)).toContain(IMPORT_RULE);
  });
});

describe('règles ESLint de frontières — chargement dynamique interdit', () => {
  const forbiddenDynamic: readonly [string, string, Depth][] = [
    ['import() d’un autre package', `export const load = () => import('@jarvis/inbox');`, 'src'],
    [
      'import() de legal-core (aucun contournement par chargement dynamique)',
      `export const load = () => import('@jarvis/legal-core');`,
      'src',
    ],
    ['import() relatif', `export const load = () => import('./errors.js');`, 'src'],
    [
      'import() relatif sortant',
      `export const load = () => import('../../core/src/index.js');`,
      'src',
    ],
    ['import() depuis testing/', `export const load = () => import('@jarvis/memory');`, 'testing'],
    [
      'require()',
      `declare const require: (id: string) => unknown;\nexport const core = require('@jarvis/core');`,
      'src',
    ],
    ['import x = require()', `import core = require('@jarvis/core');\nexport default core;`, 'src'],
    ['type import(…)', `export type T = import('@jarvis/core').ToolExecutor;`, 'src'],
    ['typeof import(…)', `export type T = typeof import('@jarvis/legal-core');`, 'src'],
  ];

  it.each(forbiddenDynamic)('interdit : %s', async (_label, code, depth) => {
    const errors = await errorsOf(code, depth);
    expect(errors.some((rule) => rule === SYNTAX_RULE || rule === IMPORT_RULE)).toBe(true);
  });

  it.each<[string, string]>([
    ['import() d’un module natif', `export const load = () => import('node:fs');`],
    ['import() relatif interne', `export const load = () => import('./errors.js');`],
    [
      'require() d’un module natif',
      `declare const require: (id: string) => unknown;\nexport const fs = require('node:fs');`,
    ],
    [
      'import x = require() d’un module natif',
      `import fs = require('node:fs');\nexport default fs;`,
    ],
    [
      'import x = require() relatif interne',
      `import errors = require('./errors.js');\nexport default errors;`,
    ],
    ["type import('node:fs')", `export type T = import('node:fs').Stats;`],
  ])(
    'chargement dynamique inoffensif quand même rejeté par la règle de syntaxe : %s',
    async (_label, code) => {
      expect(await errorsOf(code, 'src')).toContain(SYNTAX_RULE);
    },
  );

  it('les imports dynamiques sont rejetés par la règle de syntaxe, pas seulement par accident', async () => {
    expect(await errorsOf(`export const l = () => import('@jarvis/inbox');`, 'src')).toContain(
      SYNTAX_RULE,
    );
  });
});

describe('règles ESLint de frontières — le code réel du package les respecte', () => {
  it('aucune erreur de frontière sur tous les fichiers de src/ (code, tests, fixtures)', async () => {
    const results = await eslint.lintFiles([join(PACKAGE_SRC, '**/*.ts')]);
    const boundaryErrors = results.flatMap((result) =>
      result.messages
        .filter((m) => m.severity === 2 && (m.ruleId === IMPORT_RULE || m.ruleId === SYNTAX_RULE))
        .map((m) => `${result.filePath}:${m.line} ${m.ruleId}`),
    );
    expect(results.length).toBeGreaterThan(10);
    expect(boundaryErrors).toEqual([]);
  }, 60_000);
});

/** Test statique ciblé : ne dépend pas de la configuration ESLint (défense en profondeur). */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('frontières — vérification statique du code de production', () => {
  const production = sourceFiles(PACKAGE_SRC).filter(
    (file) => !file.endsWith('.test.ts') && !file.includes('/testing/'),
  );

  it('aucun import relatif ne sort de src/ (tout `../` est interdit dans le code de production)', () => {
    for (const file of production) {
      expect(strip(readFileSync(file, 'utf-8')), file).not.toMatch(
        /(?:from|import)\s*\(?\s*['"]\.\.\//,
      );
    }
  });

  it('aucun chargement dynamique : ni import(), ni require(), ni import = require()', () => {
    for (const file of production) {
      const source = strip(readFileSync(file, 'utf-8'));
      expect(source, file).not.toMatch(/\bimport\s*\(/);
      expect(source, file).not.toMatch(/\brequire\s*\(/);
      expect(source, file).not.toMatch(/=\s*require\b/);
    }
  });

  it('aucun sous-chemin de @jarvis/legal-core, et un seul package @jarvis/* référencé', () => {
    const referenced = new Set<string>();
    for (const file of production) {
      for (const match of strip(readFileSync(file, 'utf-8')).matchAll(
        /['"](@jarvis\/[^'"]*)['"]/g,
      )) {
        referenced.add(match[1]!);
      }
    }
    expect([...referenced]).toEqual(['@jarvis/legal-core']);
  });

  it('src/ ne compte qu’un niveau de sous-dossiers (hypothèse des deux blocs ESLint)', () => {
    for (const file of sourceFiles(PACKAGE_SRC)) {
      const depth = file.slice(PACKAGE_SRC.length + 1).split('/').length - 1;
      expect(depth, file).toBeLessThanOrEqual(1);
    }
  });
});
