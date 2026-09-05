/**
 * Erreurs métier de l'architecture connectors (M5).
 *
 * Aucune de ces erreurs ne porte jamais de secret, de credential ou de
 * token — ni dans un champ, ni dans `message`. Elles ne remplacent pas non
 * plus `PermissionDecision`/`PermissionManager` : un refus de permission
 * reste représenté par `ToolExecutionResult` (`status: 'denied' |
 * 'awaiting_confirmation'`) côté `@jarvis/core`, jamais par une classe
 * d'erreur définie ici.
 */

/** Le `ConnectorRegistry` ne connaît aucun connector portant cet id. */
export class UnknownConnectorError extends Error {
  readonly code = 'unknown_connector' as const;

  constructor(readonly connectorId: string) {
    super(`Connector inconnu : « ${connectorId} ».`);
    this.name = 'UnknownConnectorError';
  }
}

/** Un connector est enregistré mais ne peut pas être utilisé actuellement. */
export class ConnectorUnavailableError extends Error {
  readonly code = 'connector_unavailable' as const;

  constructor(readonly connectorId: string, reason?: string) {
    super(`Connector « ${connectorId} » indisponible${reason ? ` (${reason})` : ''}.`);
    this.name = 'ConnectorUnavailableError';
  }
}

/** La capability demandée n'est déclarée par aucun connector. */
export class UnknownCapabilityError extends Error {
  readonly code = 'unknown_capability' as const;

  constructor(readonly connectorId: string, readonly capabilityId: string) {
    super(`Capability inconnue « ${capabilityId} » pour le connector « ${connectorId} ».`);
    this.name = 'UnknownCapabilityError';
  }
}

/**
 * La capability est connue (déclarée quelque part) mais ce connector ne la
 * supporte pas — distinct de « totalement inconnue ».
 */
export class UnsupportedCapabilityError extends Error {
  readonly code = 'unsupported_capability' as const;

  constructor(readonly connectorId: string, readonly capabilityId: string) {
    super(`Capability « ${capabilityId} » non supportée par le connector « ${connectorId} ».`);
    this.name = 'UnsupportedCapabilityError';
  }
}

function unknownAccountMessage(accountId?: string, provider?: string): string {
  if (accountId !== undefined && provider !== undefined) {
    return `Compte inconnu « ${accountId} » pour le provider « ${provider} ».`;
  }
  if (accountId !== undefined) {
    return `Compte inconnu « ${accountId} ».`;
  }
  if (provider !== undefined) {
    return `Aucun compte enregistré pour le provider « ${provider} ».`;
  }
  return 'Compte inconnu.';
}

/**
 * Aucun compte ne correspond à la demande — soit un `accountId` précis est
 * introuvable, soit aucun compte n'existe pour le provider demandé.
 */
export class UnknownAccountError extends Error {
  readonly code = 'unknown_account' as const;

  constructor(readonly accountId?: string, readonly provider?: string) {
    super(unknownAccountMessage(accountId, provider));
    this.name = 'UnknownAccountError';
  }
}

/**
 * Plusieurs comptes existent pour ce provider et aucun `accountId` n'a été
 * fourni pour lever l'ambiguïté. Ne contient que des identifiants de
 * compte (jamais de credential) : sûr à journaliser.
 */
export class AmbiguousAccountError extends Error {
  readonly code = 'ambiguous_account' as const;

  constructor(readonly provider: string, readonly candidateAccountIds: readonly string[]) {
    super(
      `Plusieurs comptes existent pour le provider « ${provider} » ; ` +
        `« accountId » est requis pour lever l'ambiguïté ` +
        `(candidats : ${candidateAccountIds.join(', ')}).`,
    );
    this.name = 'AmbiguousAccountError';
  }
}

/**
 * Aucun secret n'est stocké sous cette clé. Le message ne cite que la
 * *clé* demandée, jamais une valeur.
 */
export class SecretNotFoundError extends Error {
  readonly code = 'secret_not_found' as const;

  constructor(readonly secretKey: string) {
    super(`Secret introuvable pour la clé « ${secretKey} ».`);
    this.name = 'SecretNotFoundError';
  }
}

/**
 * Cause de corruption d'un fichier `FileAccountStore` — jamais le contenu
 * brut du fichier, uniquement une catégorie.
 *
 * - `empty_file` : le fichier existe mais est vide (0 octet). Traité comme
 *   une anomalie, pas comme un store vide — voir {@link AccountStoreCorruptedError}.
 * - `invalid_json` : le contenu n'est pas un JSON syntaxiquement valide.
 * - `unknown_version` : le champ `version` ne correspond à aucune version
 *   connue ; aucune tentative de migration automatique n'est faite.
 * - `invalid_structure` : JSON valide mais qui ne respecte pas la forme
 *   attendue (racine, liste `accounts`, ou un compte dont un champ requis
 *   est absent/mal typé).
 */
export type AccountStoreCorruptionReason =
  | 'empty_file'
  | 'invalid_json'
  | 'unknown_version'
  | 'invalid_structure';

/**
 * Le fichier persistant d'un `FileAccountStore` ne peut pas être lu en
 * confiance. Ne contient jamais le contenu du fichier ni une quelconque
 * valeur qu'il porterait — seulement une catégorie (`reason`) et le chemin
 * du fichier concerné (un chemin de fichier n'est pas un secret).
 */
export class AccountStoreCorruptedError extends Error {
  readonly code = 'account_store_corrupted' as const;

  constructor(readonly reason: AccountStoreCorruptionReason, readonly filePath: string) {
    super(`Fichier de comptes corrompu ou invalide (${reason}) : « ${filePath} ».`);
    this.name = 'AccountStoreCorruptedError';
  }
}
