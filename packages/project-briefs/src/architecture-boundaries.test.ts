import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Garde-fou de frontières : `@jarvis/project-briefs` est une **feuille**,
 * comme `@jarvis/types`/`@jarvis/llm`/`@jarvis/memory` (règles ESLint,
 * `eslint.config.js`). Complète ces règles par une vérification exécutable,
 * même discipline que `packages/legal-core/src/architecture-boundaries.test.ts`.
 */
const SRC_ROOT = __dirname;

function productionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'testing' ? [] : productionFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const files = productionFiles(SRC_ROOT);
const code = (file: string): string => stripComments(readFileSync(file, 'utf-8'));

describe('frontières de @jarvis/project-briefs', () => {
  it('aucun import @jarvis/* : feuille, comme @jarvis/memory et @jarvis/legal-case-store', () => {
    for (const file of files) {
      expect(code(file), file).not.toMatch(/from\s+['"]@jarvis\//);
    }
  });

  it('jamais d’import du prototype Situation (ADR-0010 : domaine séparé, pas une généralisation)', () => {
    for (const file of files) {
      expect(code(file), file).not.toMatch(/situation-poc|situation-prototype/);
    }
  });

  it('les seuls modules node importés sont node:crypto, node:fs, node:path', () => {
    const imported = new Set<string>();
    for (const file of files) {
      for (const match of code(file).matchAll(/from\s+['"](node:[^'"]+)['"]/g)) {
        imported.add(match[1]!);
      }
    }
    expect([...imported].sort()).toEqual(['node:crypto', 'node:fs', 'node:path']);
  });

  it('chaque module de production reste sous 500 lignes', () => {
    for (const file of files) {
      const lines = readFileSync(file, 'utf-8').split('\n').length;
      expect(lines, file).toBeLessThanOrEqual(500);
    }
  });
});
