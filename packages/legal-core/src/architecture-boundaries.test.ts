import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Garde-fou de frontières (LegalCase v3) : `@jarvis/legal-core` est une **feuille**.
 * Il ne dépend d'aucun autre package `@jarvis/*` (ni `@jarvis/llm`, connecteurs,
 * mémoire, apps, AgentLoop), ne touche ni au réseau ni aux secrets, et ses modules
 * purs (dérivation d'état, règles, empreintes, temporalité, primitives) n'ont ni
 * horloge, ni I/O, ni aléa. La provenance est de la **donnée** : elle ne dépend pas
 * du producteur. Complète les règles ESLint par une vérification exécutable.
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

/** Modules **purs** : ni horloge, ni aléa, ni I/O (la factory, seule, crée un dossier avec un id et une date). */
const PURE_MODULES = [
  'legal-fact-state.ts',
  'legal-rule.ts',
  'legal-fingerprint.ts',
  'legal-canonical.ts',
  'legal-temporal.ts',
  'legal-calendar.ts',
  'legal-primitives.ts',
  'legal-input-reference.ts',
  'legal-provenance.ts',
  'legal-fact.ts',
  'legal-relation.ts',
  'legal-conflict.ts',
  'legal-resolution.ts',
  'legal-fact-validation.ts',
  'legal-document.ts',
  'legal-evidence.ts',
  'legal-document-location.ts',
  'legal-case-validation.ts',
  'legal-fact-refs-validation.ts',
  'legal-fact-events-validation.ts',
  'legal-case-append-only.ts',
];

describe('frontières de @jarvis/legal-core (code de production)', () => {
  it('inspecte bien le code de production du modèle Fact', () => {
    const names = files.map((file) => file.replace(`${SRC_ROOT}/`, ''));
    expect(names).toEqual(expect.arrayContaining(PURE_MODULES));
    expect(names).toEqual(
      expect.arrayContaining([
        'legal-case.ts',
        'legal-case-v2.ts',
        'legal-case-file-format.ts',
        'legal-case-file-format-v2.ts',
      ]),
    );
  });

  it('aucun import @jarvis/* : legal-core est une feuille', () => {
    for (const file of files) {
      expect(code(file), file).not.toMatch(/from\s+['"]@jarvis\//);
    }
  });

  it.each([
    ['@jarvis/llm', /@jarvis\/llm/],
    ['@jarvis/connectors', /@jarvis\/connectors/],
    ['@jarvis/memory', /@jarvis\/memory/],
    ['@jarvis/core (ToolExecutor, AgentLoop)', /@jarvis\/core/],
    ['SecretStore', /\bSecretStore\b/],
    ['ConnectorRegistry', /\bConnectorRegistry\b/],
    ['AgentLoop', /\bAgentLoop\b/],
    ['appel fetch', /\bfetch\s*\(/],
    ['module réseau node', /['"]node:(https?|net|tls|dns|http2)['"]/],
  ])('aucune dépendance runtime vers : %s', (_label, pattern) => {
    for (const file of files) {
      expect(code(file), file).not.toMatch(pattern);
    }
  });

  it('le seul module node importé est node:crypto (hash et identifiant)', () => {
    const imported = new Set<string>();
    for (const file of files) {
      for (const match of code(file).matchAll(/from\s+['"](node:[^'"]+)['"]/g))
        imported.add(match[1]!);
    }
    expect([...imported]).toEqual(['node:crypto']);
  });

  it.each(PURE_MODULES)('%s est pur : ni horloge, ni aléa, ni I/O', (name) => {
    const source = code(join(SRC_ROOT, name));
    expect(source).not.toMatch(/\bDate\.now\s*\(/);
    expect(source).not.toMatch(/\bnew Date\s*\(/);
    expect(source).not.toMatch(/\bMath\.random\s*\(/);
    expect(source).not.toMatch(/\brandomUUID\b|\brandomBytes\b/);
    expect(source).not.toMatch(/from\s+['"]node:(fs|path|os|child_process|process)['"]/);
    expect(source).not.toMatch(/\bprocess\.env\b/);
  });

  it('la dérivation d’état et le catalogue de règles ne lisent jamais provenance.origin comme vérité', () => {
    expect(code(join(SRC_ROOT, 'legal-fact-state.ts'))).not.toMatch(
      /provenance\.origin|\.origin\b/,
    );
  });

  it('LegalFact ne déclare aucun champ d’état', () => {
    const source = code(join(SRC_ROOT, 'legal-fact.ts'));
    const declaration = source.slice(
      source.indexOf('export interface LegalFact'),
      source.indexOf('}', source.indexOf('export interface LegalFact')),
    );
    for (const forbidden of [
      'status',
      'certainty',
      'epistemicState',
      'confidence',
      'established',
    ]) {
      expect(declaration).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
  });

  it('chaque module de production reste sous 500 lignes (règle du projet)', () => {
    for (const file of files) {
      const lines = readFileSync(file, 'utf-8').split('\n').length;
      expect(lines, file).toBeLessThanOrEqual(500);
    }
  });
});
