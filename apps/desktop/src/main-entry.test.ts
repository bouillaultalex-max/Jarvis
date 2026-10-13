import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Tests du **vrai** point d'entrée (`main()`, exécuté via
 * `require.main === module`) — pas `dispatch()` avec des dépendances
 * injectées (déjà couvert par `main-legal-search.test.ts`). Lance
 * `src/main.ts` comme un vrai process `tsx`, avec un environnement contrôlé.
 *
 * Volontairement limité aux scénarios qui échouent **avant** toute
 * résolution de secrets/appel réseau (arguments invalides, environnement
 * Légifrance invalide, commande Gmail sans credentials), plus un scénario de
 * démarrage réussi (`chat`) dont le stdin est fermé immédiatement (`input:
 * ''`) — aucun de ces process ne peut donc jamais atteindre le trousseau OS
 * réel, le réseau, ni un vrai modèle LLM. Un scénario de succès
 * `legal-search` nécessiterait de vrais secrets Sandbox PISTE — hors
 * périmètre (voir `run-legal-search-flow.test.ts`/`main-legal-search.test.ts`
 * pour ce cas, avec `fetchFn`/`SecretStore` mockés via `dispatch()`).
 */

const TSX_BIN = join(__dirname, '..', '..', '..', 'node_modules', '.bin', 'tsx');
const MAIN_ENTRY = join(__dirname, 'main.ts');
const DESKTOP_DIR = join(__dirname, '..');

function runMain(
  args: readonly string[],
  envOverrides: Record<string, string | undefined> = {},
  /** `undefined` (défaut) : stdin inchangée (aucune des commandes testées sans ce paramètre n'en lit). Fourni pour `chat`, qui en lirait. */
  input?: string,
): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.GMAIL_CLIENT_ID;
  delete env.GMAIL_CLIENT_SECRET;
  delete env.ANTHROPIC_API_KEY;
  delete env.LEGIFRANCE_ENVIRONMENT;
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }

  const result = spawnSync(TSX_BIN, [MAIN_ENTRY, ...args], {
    cwd: DESKTOP_DIR,
    env,
    encoding: 'utf8',
    timeout: 20_000,
    ...(input !== undefined ? { input } : {}),
  });

  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('main() — vrai point d’entrée, process réel (tsx src/main.ts)', () => {
  it('legal-search, date impossible, sans GMAIL_CLIENT_ID/SECRET ni ANTHROPIC_API_KEY → rejeté avant tout accès secrets/réseau, aucun résultat imprimé', () => {
    const { status, stdout, stderr } = runMain(['legal-search', '--asOf', '2026-02-30', 'texte']);

    expect(status).toBe(1);
    expect(stderr).toContain('date calendaire réelle');
    expect(stdout).toBe('');
    // Le libellé d'erreur générique ne doit pas prétendre à un échec Gmail
    // pour une commande legal-search.
    expect(stderr).not.toContain('connexion Gmail');
  });

  it('legal-search, LEGIFRANCE_ENVIRONMENT invalide, arguments valides → rejeté avant tout accès secrets/réseau', () => {
    const { status, stderr } = runMain(['legal-search', '--asOf', '2026-01-01', 'texte'], {
      LEGIFRANCE_ENVIRONMENT: 'not-a-real-environment',
    });

    expect(status).toBe(1);
    expect(stderr).toContain('LEGIFRANCE_ENVIRONMENT invalide');
  });

  it('commande Gmail existante (connect) sans GMAIL_CLIENT_ID/SECRET → comportement inchangé (main() exige toujours la configuration Gmail pour les commandes Gmail)', () => {
    const { status, stderr } = runMain(['connect']);

    expect(status).toBe(1);
    expect(stderr).toContain('GMAIL_CLIENT_ID et GMAIL_CLIENT_SECRET sont requis');
  });

  it('chat, sans GMAIL_CLIENT_ID/SECRET ni ANTHROPIC_API_KEY, stdin fermé immédiatement → démarre et se termine proprement, aucune exigence Gmail, aucun appel LLM réel', () => {
    // `input: ''` ferme stdin dès l'ouverture (EOF immédiat, aucune ligne
    // tapée) — `runChatRepl` ne peut donc jamais appeler `AnthropicProvider`,
    // réel ou pas : ce test ne constitue en rien un échange avec un LLM réel,
    // seulement la vérification que le vrai bootstrap (`main()`) démarre
    // cette commande sans exiger de credentials Gmail.
    const { status, stdout, stderr } = runMain(['chat'], {}, '');

    expect(status).toBe(0);
    expect(stdout).toContain('mono-tour');
    expect(stdout).toContain('facturé');
    expect(stderr).not.toContain('GMAIL_CLIENT_ID');
  });

  it('commande inconnue → rejetée, la liste des commandes mentionne legal-search', () => {
    // `defaultDesktopDeps()` exige GMAIL_CLIENT_ID/SECRET pour *toute* commande
    // autre que `legal-search` (comportement préexistant, inchangé par cette
    // mission) — de fausses valeurs non vides suffisent ici : `dispatch()`
    // lève « commande inconnue » avant toute résolution de compte Gmail, donc
    // avant tout usage réel de ces valeurs.
    const { status, stderr } = runMain(['n-importe-quoi'], {
      GMAIL_CLIENT_ID: 'fake-client-id',
      GMAIL_CLIENT_SECRET: 'fake-client-secret',
    });

    expect(status).toBe(1);
    expect(stderr).toContain('legal-search');
  });
});
