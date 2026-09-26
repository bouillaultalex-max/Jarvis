# ADR-0015: Ports `SearchPort` et `RetrievalPort`

Date: 2026-09-23
Status: Accepted (structure) — erreurs structurées et cache NON décidés

Référence de travail : ADR-LEGAL-03-05.

## Contexte

`LegalSourceProvider` (LEGAL-02B.3) est nommé et typé pour Légifrance : sa
seule méthode est `getArticle` et elle retourne `MapLegifranceArticleResult`.
Les frontières ESLint de `@jarvis/legal-research` interdisent d'importer
`@jarvis/legifrance-client` et `@jarvis/connectors` ; seul `ToolExecutor`
(`@jarvis/core`) est autorisé pour exécuter une action.

## Problème

Comment définir la recherche et la récupération sans lier le domaine à
Légifrance, sans créer un second système d'exécution et sans dupliquer
`LegalSourceProvider` ?

## Décision

- `SearchPort { providerId; search(query): Promise<SearchResultPage> }`.
- `RetrievalPort { providerId; canRetrieve(reference): boolean; retrieve(request): Promise<RetrievalResult> }`.
- **Les implémentations dépendent des ports, jamais l'inverse.** Les ports
  n'importent que `@jarvis/legal-core` (types).
- Toute exécution passe par `ToolExecutor` : jamais de `fetch`, de client
  HTTP, de `SecretStore` ni de `ConnectorRegistry` dans `legal-research`.
- `LegalSourceProvider`/`LegifranceSourceProvider` **restent inchangés** :
  LEGAL-03B a ajouté (`LegifranceRetrievalAdapter`) un adaptateur mince qui implémente `RetrievalPort` en
  enveloppant `LegifranceSourceProvider.getArticle` (aucune duplication de
  mapping, d'appel Tool ou de gestion d'erreur).
- `ResearchProviderError` (`ports.ts`) reprend fidèlement les statuts de
  `ToolExecutionResult` (`unknown_tool`, `invalid_input`→`invalid_request`,
  `denied`, `awaiting_confirmation`, `error`→`execution_error`) plus
  `malformed_response`.
- `canRetrieve` est pur et sans I/O : il permet d'écarter (`not_retrievable`)
  les références sans identifiant récupérable avant de dépenser du budget.
- Fakes de test (`FakeSearchPort`, `FakeRetrievalPort`) sans réseau, non
  exportés de l'index public.

## Alternatives écartées

- Étendre `LegalSourceProvider` : conserve sa fuite de types Légifrance et
  mélange découverte et récupération.
- Un port unique : voir ADR-0011.

## Conséquences

- Le futur orchestrateur et les tests ne connaissent que les ports.
- L'adaptateur Légifrance (ADR-0017) est le seul endroit qui connaît les
  noms de Tools et les formats.

## Limites — OUVERT

- **Erreurs structurées** : `ToolFailed.reason` est une chaîne. Tant que
  `ToolExecutor` ne transporte pas le type d'erreur, un HTTP 404/429/5xx
  reste `execution_error`. Modifier `@jarvis/core` serait une décision
  séparée.
- Quotas/rate limits, cache, annulation/timeout : non traités.
