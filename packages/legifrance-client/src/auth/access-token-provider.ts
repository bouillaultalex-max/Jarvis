/**
 * Abstraction dont dépend le client HTTP Légifrance : fournit un access
 * token sur demande, sans exposer comment il est obtenu ou renouvelé.
 *
 * Forme identique à `AccessTokenProvider` de `@jarvis/connectors`
 * (`gmail-auth.ts`) — redéclarée ici plutôt qu'importée : cette interface
 * n'est pas spécifique à Gmail (sa forme ne mentionne rien de Google), mais
 * `@jarvis/legifrance-client` doit rester une feuille sans dépendance
 * `@jarvis/*` (cycle de packages `connectors` ↔ `legifrance-client` corrigé —
 * voir PROJECT_STATE.md). Le typage structurel de TypeScript rend les deux
 * déclarations interchangeables pour tout appelant : aucune conversion,
 * aucun adaptateur n'est nécessaire.
 */
export interface AccessTokenProvider {
  getAccessToken(): Promise<string>;
}
