import {
  buildGmailSendConfirmationSummary,
  confirmAndExecute,
  ConfirmationService,
  gmailConnector,
  PermissionManager,
  proposeConfirmation,
  resolveAccount,
  resolveGmailApiClient,
  ToolExecutor,
  ToolRegistry,
  type AccountStore,
  type ConfirmationFailed,
  type ConfirmationPayload,
  type ConfirmationRequest,
  type GmailAppCredentials,
  type GmailSendInput,
  type SecretStore,
  type ToolExecutionResult,
} from '@jarvis/connectors';

/**
 * Envoi Gmail confirmé — orchestration desktop (M8-B4).
 *
 * Ferme la boucle bout en bout, en composant **exclusivement** des briques
 * existantes de `@jarvis/connectors`, sans en réimplémenter aucune règle :
 *
 *   resolveAccount() → resolveGmailApiClient() → gmailConnector.createTools()
 *   → ToolRegistry → PermissionManager → ToolExecutor → proposeConfirmation()
 *   → confirmation utilisateur (callback injecté) → confirmAndExecute()
 *   → gmail.send
 *
 * `apps/desktop/src/main.ts` n'appelle jamais cette fonction : aucun envoi
 * réel ne peut donc être déclenché en lançant `apps/desktop`. Elle est
 * pilotée uniquement par ses tests (callback `confirm` injecté, `fetchFn`
 * mocké). Aucun destinataire, contenu ou credential réel n'entre dans le
 * dépôt.
 *
 * Sécurité :
 *   - `SecretStore` reste l'unique autorité du refresh token — jamais lu ni
 *     recopié ici (délégué à `resolveGmailApiClient`).
 *   - Aucun état sensible n'est conservé : cette fonction ne garde aucune
 *     variable de module, ne journalise rien, ne sérialise aucun secret.
 *   - La confirmation est **obligatoire** : si `PermissionManager` accorde
 *     `gmail.send` sans confirmation (`'allow'`), l'envoi est refusé
 *     (`'confirmation_required'`) plutôt qu'exécuté — un `gmail.send` non
 *     confirmé ne doit jamais produire d'effet.
 *   - Le payload exécuté est exactement l'input validé renvoyé par
 *     `ToolExecutor` (`proposed.result.input`) — jamais reconstruit à partir
 *     de l'entrée brute, jamais modifié après validation. Toute divergence
 *     échoue à `confirmAndExecute` (`payload_mismatch`), sans envoi.
 */

export interface RunGmailSendOptions {
  readonly accountStore: AccountStore;
  readonly secretStore: SecretStore;
  readonly appCredentials: GmailAppCredentials;
  /** Contenu de l'envoi — validé ensuite par `gmail.send.validateInput` via `ToolExecutor`. */
  readonly input: GmailSendInput;
  /**
   * Décision utilisateur sur la demande de confirmation affichable. Injecté :
   * une vraie UI/CLI le fournira plus tard, les tests le mockent. `true` =
   * l'utilisateur confirme l'envoi.
   */
  readonly confirm: (request: ConfirmationRequest) => boolean | Promise<boolean>;
  /**
   * Transmis tel quel à `resolveAccount` — jamais de sélection implicite.
   * Absent + plusieurs comptes Gmail ⇒ `AmbiguousAccountError` (propagée).
   */
  readonly accountId?: string;
  /**
   * Politique appliquée à `gmail.send`. Défaut : `require_confirmation`.
   * Une politique `'allow'` est refusée (voir en-tête). Une politique
   * `'deny'` est appliquée par `ToolExecutor` (aucun effet de bord).
   */
  readonly permissionManager?: PermissionManager;
  readonly confirmationService?: ConfirmationService;
  /** Injectable pour les tests : jamais d'appel réseau réel. */
  readonly fetchFn?: typeof fetch;
  /** Injectable pour les tests (date `createdAt` du `ConfirmationRequest`). */
  readonly now?: () => number;
}

/** Refus en amont : la politique n'exige pas de confirmation pour `gmail.send`. */
export interface ConfirmationRequiredResult {
  readonly status: 'confirmation_required';
  readonly reason: string;
}

/** L'utilisateur a refusé la confirmation ; aucun appel Gmail n'a eu lieu. */
export interface ConfirmationDeclinedResult {
  readonly status: 'confirmation_declined';
}

export type RunGmailSendResult =
  | ToolExecutionResult
  | ConfirmationFailed
  | ConfirmationRequiredResult
  | ConfirmationDeclinedResult;

const GMAIL_SEND_TOOL = 'gmail.send';

export async function runGmailSend(options: RunGmailSendOptions): Promise<RunGmailSendResult> {
  const { accountStore, secretStore, appCredentials, input, confirm, accountId } = options;
  const permissionManager = options.permissionManager ?? new PermissionManager({ rules: { [GMAIL_SEND_TOOL]: 'require_confirmation' } });
  const confirmationService = options.confirmationService ?? new ConfirmationService();

  // ÉTAPE 1 — sélection du compte, jamais implicite.
  const account = await resolveAccount(accountStore, { provider: 'gmail', accountId });

  // ÉTAPE 2 — client authentifié. Aucun appel réseau à la construction ;
  // propage l'erreur de `resolveGmailCredentials` si le compte n'est pas
  // `'connected'` (secret absent, statut `disconnected`/`error`…).
  const client = await resolveGmailApiClient({
    account,
    secretStore,
    appCredentials,
    ...(options.fetchFn !== undefined ? { fetchFn: options.fetchFn } : {}),
  });

  // ÉTAPE 3 — confirmation obligatoire. Une politique `'allow'` contournerait
  // `ConfirmationService` : refusée sans jamais exécuter l'envoi.
  if (permissionManager.decide(GMAIL_SEND_TOOL, 'execute') === 'allow') {
    return {
      status: 'confirmation_required',
      reason: `${GMAIL_SEND_TOOL} exige une confirmation explicite : une politique « allow » n'est pas acceptée.`,
    };
  }

  // ÉTAPE 4 — registre + exécuteur, API existantes inchangées.
  const registry = new ToolRegistry();
  for (const tool of gmailConnector.createTools(client)) {
    registry.register(tool);
  }
  const executor = new ToolExecutor(registry, permissionManager);

  const proposed = await proposeConfirmation({
    executor,
    confirmationService,
    request: { tool: GMAIL_SEND_TOOL, input },
    account,
    summary: buildGmailSendConfirmationSummary(input),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });

  // ÉTAPE 5 — tout ce qui n'est pas une demande de confirmation (deny,
  // invalid_input, error, unknown_tool) est renvoyé tel quel, sans envoi.
  if (proposed.result.status !== 'awaiting_confirmation' || proposed.confirmationRequest === undefined) {
    return proposed.result;
  }

  // ÉTAPE 6 — décision utilisateur.
  const approved = await confirm(proposed.confirmationRequest);
  if (approved !== true) {
    await confirmationService.deny(proposed.confirmationRequest.confirmationId);
    return { status: 'confirmation_declined' };
  }

  // Payload = exactement l'input validé par le Tool, lié au compte résolu.
  // Jamais reconstruit depuis l'entrée brute, jamais modifié.
  const payload: ConfirmationPayload = {
    toolName: proposed.result.toolName,
    action: proposed.result.action,
    accountId: account.id,
    input: proposed.result.input,
  };

  return confirmAndExecute({
    executor,
    confirmationService,
    confirmationId: proposed.confirmationRequest.confirmationId,
    payload,
  });
}
