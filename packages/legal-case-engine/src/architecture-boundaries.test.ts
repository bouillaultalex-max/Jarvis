import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Garde-fou de frontières (LEGAL-04.1) : `@jarvis/legal-case-engine` ne dépend que de
 * `@jarvis/legal-core` (décision D1), ne touche ni au réseau, ni aux secrets, ni à un
 * journal, et n'a **aucune horloge cachée** : la seule lecture de l'horloge système vit
 * dans `system-clock.ts`, que l'appelant doit passer explicitement. Complète la règle ESLint
 * par une vérification exécutable sur le code de production (commentaires retirés).
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
const names = files.map((file) => file.replace(`${SRC_ROOT}/`, ''));

describe('frontières de @jarvis/legal-case-engine (code de production)', () => {
  it('inspecte bien le code de production', () => {
    expect(names).toEqual(
      expect.arrayContaining([
        'index.ts',
        'engine-context.ts',
        'system-clock.ts',
        'add-open-question.ts',
        'record-reported-fact.ts',
        'find-equivalent-facts.ts',
      ]),
    );
  });

  it('le seul @jarvis/* importé est @jarvis/legal-core', () => {
    const imported = new Set<string>();
    for (const file of files) {
      for (const match of code(file).matchAll(/from\s+['"](@jarvis\/[^'"]+)['"]/g)) {
        imported.add(match[1]!);
      }
    }
    expect([...imported]).toEqual(['@jarvis/legal-core']);
  });

  it.each([
    ['@jarvis/llm', /@jarvis\/llm/],
    ['@jarvis/memory', /@jarvis\/memory/],
    ['@jarvis/core', /@jarvis\/core/],
    ['@jarvis/connectors', /@jarvis\/connectors/],
    ['@jarvis/legal-research', /@jarvis\/legal-research/],
    ['@jarvis/legifrance-client', /@jarvis\/legifrance-client/],
    ['SecretStore', /\bSecretStore\b/],
    ['AgentLoop', /\bAgentLoop\b/],
    ['appel fetch', /\bfetch\s*\(/],
    ['module réseau node', /['"]node:(https?|net|tls|dns|http2)['"]/],
    ['journal (console)', /\bconsole\./],
    ['aléa ou génération d’identifiant', /\brandomUUID\b|\brandomBytes\b|\bMath\.random\s*\(/],
    ['accès système de fichiers', /['"]node:(fs|path|os|child_process)['"]/],
    ['variable d’environnement', /\bprocess\.env\b/],
  ])('aucun fichier de production ne contient : %s', (_label, pattern) => {
    for (const file of files) {
      expect(code(file), file).not.toMatch(pattern);
    }
  });

  it('aucune importation de node:* (le moteur n’en a pas besoin)', () => {
    for (const file of files) {
      expect(code(file), file).not.toMatch(/from\s+['"]node:/);
    }
  });

  it('la seule horloge système est dans system-clock.ts', () => {
    for (const file of files) {
      const source = code(file);
      if (file.endsWith('system-clock.ts')) continue;
      expect(source, file).not.toMatch(/\bDate\.now\s*\(/);
      expect(source, file).not.toMatch(/\bnew Date\s*\(\s*\)/);
    }
  });

  it('n’importe rien depuis les fixtures de test ni depuis un sous-chemin de legal-core', () => {
    for (const file of files) {
      expect(code(file), file).not.toMatch(/\/testing\//);
      expect(code(file), file).not.toMatch(/@jarvis\/legal-core\//);
    }
  });

  it('chaque module de production reste sous 500 lignes (règle du projet)', () => {
    for (const file of files) {
      expect(readFileSync(file, 'utf-8').split('\n').length, file).toBeLessThanOrEqual(500);
    }
  });
});
