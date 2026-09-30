import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Garde-fou de frontières : `@jarvis/legifrance-client` est une **feuille**.
 * Il ne dépend d'aucun autre package `@jarvis/*` (import statique, réexport,
 * import à effet de bord, import dynamique ou `require`), ni dans ses
 * sources ni dans son manifest — corrige le cycle de packages `connectors`
 * ↔ `legifrance-client` (PROJECT_STATE.md « Dette technique connue »).
 * Complète les règles ESLint (`eslint.config.js`, `no-restricted-imports`)
 * par une vérification exécutable, indépendante de la configuration ESLint,
 * sur le modèle de `packages/legal-core/src/architecture-boundaries.test.ts`.
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

describe('frontières de @jarvis/legifrance-client (code de production)', () => {
  it('aucun import statique ni réexport @jarvis/* : legifrance-client est une feuille', () => {
    for (const file of files) {
      expect(code(file), file).not.toMatch(/from\s+['"]@jarvis\//);
    }
  });

  it('aucun import dynamique @jarvis/*', () => {
    for (const file of files) {
      expect(code(file), file).not.toMatch(/import\(\s*['"]@jarvis\//);
    }
  });

  it('aucun require() @jarvis/*', () => {
    for (const file of files) {
      expect(code(file), file).not.toMatch(/require\(\s*['"]@jarvis\//);
    }
  });

  it('aucun import à effet de bord @jarvis/* (`import "@jarvis/x"`, sans liaison) — échappe au premier test (pas de `from`)', () => {
    // Démonstration que le motif est bien détecté (échantillon synthétique —
    // ceci n'est jamais ajouté à une source réelle) : `import '@jarvis/x'
    // from`)` échappe au test « aucun import statique » ci-dessus, qui exige
    // la présence du mot-clé `from`. Complémentaire d'ESLint, pas un
    // remplacement : `eslint.config.js` (`no-restricted-imports`, bloc
    // `packages/legifrance-client`) bloque déjà ce cas — vérifié
    // empiriquement (fichier jetable dans `src/`, supprimé aussitôt) lors de
    // l'écriture de ce test. Cette assertion exécutable reste utile de façon
    // indépendante de la configuration ESLint (dérive de config, exécution
    // hors CI ESLint…).
    const sideEffectImportSample = "import '@jarvis/connectors';\nexport const x = 1;\n";
    expect(sideEffectImportSample).toMatch(/import\s+['"]@jarvis\//);
    expect(sideEffectImportSample).not.toMatch(/from\s+['"]@jarvis\//);

    for (const file of files) {
      expect(code(file), file).not.toMatch(/import\s+['"]@jarvis\//);
    }
  });

  it('aucune dépendance @jarvis/* dans package.json (dependencies/devDependencies/peerDependencies)', () => {
    const pkg = JSON.parse(readFileSync(join(SRC_ROOT, '..', 'package.json'), 'utf-8')) as {
      readonly dependencies?: Readonly<Record<string, string>>;
      readonly devDependencies?: Readonly<Record<string, string>>;
      readonly peerDependencies?: Readonly<Record<string, string>>;
    };
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };
    const jarvisDeps = Object.keys(allDeps).filter((name) => name.startsWith('@jarvis/'));
    expect(jarvisDeps).toEqual([]);
  });
});
