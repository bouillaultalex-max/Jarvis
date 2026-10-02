/**
 * BANC ISOLE — construction du client Anthropic reel utilise par `run-live.ts`.
 *
 * Isole dans son propre module (plutot qu'inline dans `run-live.ts`) pour que
 * `maxRetries: 0` soit verifiable par un test qui ne fait AUCUN appel reseau
 * (construire un client ne contacte pas l'API — voir
 * `live-anthropic-client.test.ts`), sans avoir a importer `run-live.ts`
 * lui-meme (qui parse `process.argv` et agit des son import).
 */

import Anthropic from '@anthropic-ai/sdk';

/**
 * Cree le client Anthropic reel pour un essai avec un modele reel, retries
 * SDK desactives (`maxRetries: 0`). Sans ca, le SDK reessaierait en interne
 * certaines erreurs transitoires (defaut : 2 tentatives), et le compteur de
 * `BudgetGuardProvider` ne bornerait que les appels `chat()` logiques, pas le
 * nombre reel de requetes HTTP envoyees.
 *
 * N'effectue aucun appel reseau : seule la construction de l'objet client.
 */
export function createLiveAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 0 });
}
