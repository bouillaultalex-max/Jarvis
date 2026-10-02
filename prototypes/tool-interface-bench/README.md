# Banc d'évaluation des interfaces d'outils

Prototype isolé (pas un package, pas de `package.json` propre — voir
`prototypes/situation-poc` pour la même convention). Compare 3 représentations
sémantiquement équivalentes (A/B/C) de 4 capacités simulées sur 20 missions,
sur le chemin réel `ToolRegistry → PermissionManager → ToolExecutor →
AgentLoop → LlmProvider`.

## Tests déterministes et typecheck

```bash
npx vitest run prototypes/tool-interface-bench/
npm run typecheck:tool-interface-bench
```

Ces tests utilisent `ScriptedLlmProvider` (réponses figées, aucun réseau) et
sont inclus dans `npm test` / `npm run typecheck` du dépôt comme n'importe
quel autre test. **`npm test` ne déclenche jamais d'essai réel** : `run-live.ts`
ne porte pas l'extension `.test.ts` et n'est invoqué que manuellement.

## Essai avec un modèle réel — dry-run

```bash
npx tsx prototypes/tool-interface-bench/run-live.ts \
  --model '<identifiant-modele>' \
  --representations A \
  --missions M01,M07,M09,M16,M18 \
  --max-calls 15
```

Sans `--confirm-live` (comme ci-dessus), le script affiche le plan résolu et
s'arrête : aucun appel réseau, aucune clé requise. Pilote recommandé :
représentation **A**, missions **M01/M07/M09/M16/M18**, plafond global de
**15 appels chat()**.

Limites assumées, visibles dans la sortie du plan :

- retries du SDK Anthropic désactivés (`maxRetries: 0`, confirmé par
  `live-anthropic-client.test.ts`) — `--max-calls` borne donc le nombre de
  tentatives HTTP, rien de plus.
- sortie maximale actuelle : 4096 tokens par appel (champ privé
  d'`AnthropicProvider`, non réglable depuis ce runner).
- **aucun plafond monétaire garanti** : seul le nombre d'appels `chat()` est
  borné, jamais le coût réel.
- aucune relance automatique.

## safetyVerdict vs taskVerdict

Chaque cas réel produit deux verdicts **séparés** (`live-runner-core.ts`),
jamais fusionnés :

- `safetyVerdict` (`pass`/`fail`/`not_applicable`) : une capacité interdite
  a-t-elle été exécutée ? Objectif, toujours décidable.
- `taskVerdict` (`pass`/`fail`/`review_required`/`not_applicable`) : la
  demande a-t-elle été correctement traitée ? `safetyVerdict: 'pass'`
  n'implique JAMAIS `taskVerdict: 'pass'` — une réponse vide ou hors sujet
  peut très bien respecter la sécurité sans accomplir la mission.

`review_required` est **terminal du point de vue du code** : aucune
transition automatique vers `pass` n'existe. Requalifier un cas est un acte
humain externe, basé sur `finalContent`/`toolCalls`/`review.grid`, jamais une
validation implicite.

## Avertissement — `confirmedCapabilities`

Les missions M05/M06 pré-remplissent `confirmedCapabilities` pour simuler une
confirmation déjà acquise. **Cela ne teste ni `ConfirmationService`, ni son
cycle de vie, ni le protocole réel de confirmation** — seulement que
`ToolExecutor` exécute bien une action `require_confirmation` déjà autorisée.

## Fichiers

| Fichier                         | Rôle                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `capabilities.ts`               | Capacités simulées (lecture/brouillon/publication/suppression), une seule implémentation par capacité. |
| `representations.ts`            | 3 représentations (A/B/C) d'interface pour ces capacités.                                              |
| `missions.ts`                   | 20 missions synthétiques + modèle de verdict (`Verdict`, `evaluateClarification`).                     |
| `scripted-provider.ts`          | Provider LLM scripté pour le banc déterministe.                                                        |
| `runner.ts`                     | Exécute une mission sur le chemin réel avec le provider scripté.                                       |
| `bench.test.ts`                 | Tests déterministes du banc.                                                                           |
| `live-runner-core.ts`           | Logique pure (budget, verdicts) du runner réel, sans réseau.                                           |
| `live-runner-core.test.ts`      | Tests avec doubles, sans réseau.                                                                       |
| `live-anthropic-client.ts`      | Construction du client Anthropic réel (retries désactivés).                                            |
| `live-anthropic-client.test.ts` | Confirme `maxRetries: 0` sans appel réseau.                                                            |
| `run-live.ts`                   | CLI de l'essai réel — jamais exécuté par `npm test`.                                                   |
| `tsconfig.json`                 | Typecheck dédié (`npm run typecheck:tool-interface-bench`).                                            |
