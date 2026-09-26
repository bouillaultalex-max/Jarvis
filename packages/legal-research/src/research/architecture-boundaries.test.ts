import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Garde-fou de frontières (LEGAL-03B) : `@jarvis/legal-research` ne parle jamais
 * au réseau, ni aux secrets, ni directement au connecteur ou au client
 * Légifrance — il n'exécute que via `ToolExecutor`. Complète les règles ESLint
 * (`no-restricted-imports`) par une vérification exécutable sans réseau : elle
 * lit le code de production (commentaires retirés) de ce package.
 */

const SRC_ROOT = join(__dirname, '..');

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

describe('frontières de @jarvis/legal-research (code de production)', () => {
  const files = productionFiles(SRC_ROOT);

  it('inspecte bien le code de production (adaptateurs et moteur inclus)', () => {
    const names = files.map((f) => f.replace(SRC_ROOT, ''));
    expect(names).toEqual(
      expect.arrayContaining([
        '/legifrance-search-adapter.ts',
        '/legifrance-retrieval-adapter.ts',
        '/legifrance-search-parser.ts',
        '/research/research-engine.ts',
      ]),
    );
  });

  it.each([
    ['import de @jarvis/connectors', /from\s+['"]@jarvis\/connectors['"]/],
    ['import de @jarvis/legifrance-client', /from\s+['"]@jarvis\/legifrance-client['"]/],
    ['appel fetch', /\bfetch\s*\(/],
    ['module réseau node', /['"]node:(https?|net|tls|dns|http2)['"]/],
    ['SecretStore', /\bSecretStore\b/],
    ['ConnectorRegistry', /\bConnectorRegistry\b/],
    ['import relatif hors du package', /from\s+['"](\.\.\/){3,}/],
  ])('aucun fichier de production ne contient : %s', (_label, pattern) => {
    for (const file of files) {
      expect(stripComments(readFileSync(file, 'utf-8')), file).not.toMatch(pattern);
    }
  });

  it('les seuls @jarvis/* importés par le code de production sont core et legal-core', () => {
    const imported = new Set<string>();
    for (const file of files) {
      for (const match of stripComments(readFileSync(file, 'utf-8')).matchAll(
        /from\s+['"](@jarvis\/[^'"]+)['"]/g,
      )) {
        imported.add(match[1]!);
      }
    }
    expect([...imported].sort()).toEqual(['@jarvis/core', '@jarvis/legal-core']);
  });
});
