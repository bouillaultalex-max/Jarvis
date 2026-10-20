import {
  ConfirmationService,
  InMemoryMailClient,
  PermissionManager,
  ToolExecutor,
  ToolRegistry,
  createInMemorySendVerifier,
  inMemoryConnector,
  proposeConfirmation,
  type Account,
  type ConfirmationInputSummary,
  type ConfirmationPayload,
  type ConfirmationRequest,
  type ConfirmationVerifyResult,
  type ProposeConfirmationResult,
} from '@jarvis/connectors';
import { runWithVerification, type VerificationOutcome } from '@jarvis/core';

/**
 * Démonstration CLI `verify-demo` — câble, pour la première fois dans
 * `apps/desktop`, la vérification de postcondition opt-in de `@jarvis/core`
 * (`runWithVerification`) sur le chemin de confirmation réel de
 * `@jarvis/connectors` (`proposeConfirmation` → confirmation utilisateur →
 * `ConfirmationService.verify` → exécution).
 *
 * Entrée **entièrement fixe, synthétique** (`DEMO_SEND_INPUT` ci-dessous) :
 * cette commande ne prend aucun argument, ne lit aucune donnée réelle, ne
 * touche à aucun secret, LLM, Gmail ni réseau. `InMemoryMailClient` est
 * instancié localement et à neuf à chaque invocation, jamais partagé —
 * {@link runVerifyDemo} n'accepte jamais de client injecté par un appelant.
 *
 * Seul `inmemory.send` est enregistré dans le `ToolRegistry` (jamais
 * `inmemory.read`/`inmemory.prepare_reply`) : cette démonstration n'illustre
 * que le chemin confirmation + vérification d'un effet, pas la lecture.
 *
 * Reprend exactement la composition déjà prouvée par
 * `in-memory-send-verification.test.ts` (« intégration avec le protocole
 * réel de ConfirmationService ») : `proposeConfirmation` (zéro effet) →
 * confirmation utilisateur réelle (`confirm` injecté) →
 * `ConfirmationService.verify` (vérification réelle du ticket, consommation
 * atomique) → seulement en cas de succès, `runWithVerification` avec
 * `createInMemorySendVerifier` sur le **même** client. `confirmed: true`
 * n'est jamais présenté comme preuve du protocole à lui seul — la preuve
 * est le cycle complet.
 *
 * Un enregistrement observé par le vérificateur prouve uniquement un effet
 * simulé **local** (mutation en mémoire d'un client jetable) — jamais une
 * livraison externe réelle (voir `in-memory-send-verification.ts`).
 */

/** Compte fictif, fixe — jamais résolu via un `AccountStore` réel (voir en-tête). */
export const DEMO_ACCOUNT: Account = {
  id: 'verify-demo',
  provider: 'inmemory',
  accountIdentifier: 'demo@example.test',
  status: 'connected',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/**
 * Entrée fixe, synthétique, à champs primitifs — jamais dérivée d'un
 * argument. Gelée (`Object.freeze`) : aucune invocation ne peut muter cette
 * constante partagée entre invocations (voir aussi la discipline de capture
 * par clone indépendant dans {@link runVerifyDemo}, qui ne s'appuie jamais
 * sur cette mutabilité pour sa propre sûreté). Exportée pour les
 * tests/README uniquement.
 */
export const DEMO_SEND_INPUT = Object.freeze({
  to: 'demo@example.test',
  subject: 'Démonstration verify-demo (JARVIS)',
  body: 'Message synthétique local, généré par verify-demo — aucune donnée réelle.',
});

const DEMO_SUMMARY: ConfirmationInputSummary = {
  fields: [
    { key: 'to', label: 'Destinataire', value: DEMO_SEND_INPUT.to },
    { key: 'subject', label: 'Objet', value: DEMO_SEND_INPUT.subject },
    { key: 'body', label: 'Corps', value: DEMO_SEND_INPUT.body },
  ],
};

/** Affiché par l'appelant (`main.ts`) AVANT toute demande de confirmation — voir en-tête. */
export const VERIFY_DEMO_NOTICE =
  'verify-demo : démonstration locale — aucune donnée réelle, aucune livraison externe, ' +
  'InMemoryMailClient jetable propre à cette invocation.';

const SEND_TOOL = 'inmemory.send';

export type VerifyDemoResult =
  /** L'utilisateur a refusé la confirmation (ou une exception/EOF du callback `confirm`) — zéro effet. */
  | { readonly kind: 'declined' }
  /** Ticket invalide au moment de la vérification réelle (expiré, déjà consommé, altéré…) — zéro effet. */
  | { readonly kind: 'confirmation_failed' }
  /** `ToolExecutor` n'a jamais proposé de confirmation (policy/entrée inattendues) — zéro effet. */
  | { readonly kind: 'not_awaiting_confirmation'; readonly technicalStatus: string }
  /**
   * La préparation de la vérification de postcondition a échoué AVANT toute
   * conclusion fiable (`runWithVerification` → `kind: 'preparation_failed'`,
   * voir `@jarvis/core`) — distinct d'une exécution dont l'effet serait
   * seulement non prouvé : ici, `ToolExecutor.run()` n'a jamais été rappelé
   * pour cette tentative avec cette fonction. Zéro faux `technicalStatus`
   * n'est jamais inventé pour ce cas.
   */
  | { readonly kind: 'preparation_failed' }
  /**
   * Un appel à `proposeConfirmation`/`ConfirmationService.verify` a levé une
   * exception imprévue (double de test défaillant, ou anomalie réelle) —
   * traitée comme un échec contrôlé, zéro effet, jamais le message brut.
   */
  | { readonly kind: 'internal_error' }
  /** Confirmation vérifiée avec succès, exécution tentée via `runWithVerification`. */
  | {
      readonly kind: 'executed';
      readonly technicalStatus: string;
      readonly verification: VerificationOutcome | undefined;
    };

export interface RunVerifyDemoOptions {
  /** Décision utilisateur sur la demande de confirmation affichable — jamais de double partagé. */
  readonly confirm: (request: ConfirmationRequest) => boolean | Promise<boolean>;
  /** Injecté par les tests uniquement. Défaut : une instance neuve, privée à cette invocation. */
  readonly confirmationService?: ConfirmationService;
}

export async function runVerifyDemo(options: RunVerifyDemoOptions): Promise<VerifyDemoResult> {
  const { confirm } = options;
  const confirmationService = options.confirmationService ?? new ConfirmationService();

  // Client neuf, privé à cette invocation — jamais partagé avec un autre
  // écrivain concurrent (voir en-tête).
  const client = new InMemoryMailClient([]);
  const registry = new ToolRegistry();
  for (const tool of inMemoryConnector.createTools(client)) {
    if (tool.name === SEND_TOOL) {
      registry.register(tool);
    }
  }
  const permissionManager = new PermissionManager({
    rules: { [SEND_TOOL]: 'require_confirmation' },
    default: 'deny',
  });
  const executor = new ToolExecutor(registry, permissionManager);
  const verifier = createInMemorySendVerifier(client);

  let proposed: ProposeConfirmationResult;
  try {
    proposed = await proposeConfirmation({
      executor,
      confirmationService,
      request: { tool: SEND_TOOL, input: DEMO_SEND_INPUT },
      account: DEMO_ACCOUNT,
      summary: DEMO_SUMMARY,
    });
  } catch {
    // Aucune erreur brute ne doit jamais remonter jusqu'à l'appelant (et,
    // in fine, `main().catch()`) — échec contrôlé, zéro effet, avant toute
    // exécution.
    return { kind: 'internal_error' };
  }

  const proposedResult = proposed.result;
  if (
    proposedResult.status !== 'awaiting_confirmation' ||
    proposed.confirmationRequest === undefined
  ) {
    return { kind: 'not_awaiting_confirmation', technicalStatus: proposedResult.status };
  }

  const confirmationRequest = proposed.confirmationRequest;
  const confirmationId = confirmationRequest.confirmationId;

  let approved: boolean;
  try {
    approved = (await confirm(confirmationRequest)) === true;
  } catch {
    // Une exception du callback `confirm` (ou une fin de flux/EOF déjà
    // traduite en `false` par `createTerminalConfirm`) ne constitue jamais
    // une confirmation — zéro effet, ticket refusé, jamais le message brut.
    approved = false;
  }

  if (!approved) {
    try {
      await confirmationService.deny(confirmationId);
    } catch {
      // `deny()` ne lève jamais dans l'implémentation réelle ; un double de
      // test défaillant ne doit cependant jamais transformer un refus en
      // exception brute — le refus (zéro effet) reste le résultat rendu.
    }
    return { kind: 'declined' };
  }

  // Deux clones INDÉPENDANTS de la même entrée déjà validée par le `Tool`
  // (`proposedResult.input`), capturés de façon strictement synchrone AVANT
  // le seul point de suspension qui suit (`await confirmationService.verify`) :
  //   - `executionInput` : jamais transmis au service de confirmation, c'est
  //     exactement et seulement ce que `runWithVerification` exécutera.
  //   - `verifyPayload.input` : jamais réutilisé pour l'exécution. Même un
  //     service de confirmation qui conserverait une référence à ce clone et
  //     le muterait après coup (ex. après un `verify()` réussi) ne peut donc
  //     jamais altérer ce qui sera réellement exécuté — les deux objets sont
  //     distincts dès la capture, pas seulement en apparence.
  const executionToolName = proposedResult.toolName;
  const executionInput = structuredClone(proposedResult.input);
  const verifyPayload: ConfirmationPayload = {
    toolName: proposedResult.toolName,
    action: proposedResult.action,
    accountId: DEMO_ACCOUNT.id,
    input: structuredClone(proposedResult.input),
  };

  let verification: ConfirmationVerifyResult;
  try {
    verification = await confirmationService.verify(confirmationId, verifyPayload);
  } catch {
    // Même discipline que la proposition : aucune exception (y compris une
    // chaîne sensible portée par une erreur de double de test) ne doit
    // jamais être reprise telle quelle — échec contrôlé, zéro effet.
    return { kind: 'internal_error' };
  }
  if (!verification.ok) {
    return { kind: 'confirmation_failed' };
  }

  // Exécution + vérification de postcondition RÉELLE, sur le même client
  // que `verifier` observe — remplace exactement l'appel final que
  // `confirmAndExecute` ferait lui-même (voir `confirmAndExecute`,
  // `confirmation-flow.ts`), en substituant `runWithVerification`. Utilise
  // exclusivement `executionInput` (jamais `verifyPayload.input`).
  const outcome = await runWithVerification(
    executor,
    { tool: executionToolName, input: executionInput, confirmed: true },
    verifier,
  );

  if (outcome.kind === 'preparation_failed') {
    // `runWithVerification` n'a jamais rappelé `ToolExecutor.run()` pour
    // cette tentative : aucun `technicalStatus` ne doit être inventé pour la
    // simuler.
    return { kind: 'preparation_failed' };
  }

  return {
    kind: 'executed',
    technicalStatus: outcome.technicalResult.status,
    verification: outcome.verification,
  };
}

/** `0` uniquement si l'outil a réellement été exécuté ET que l'effet observé est `satisfied`. */
export function verifyDemoExitCode(result: VerifyDemoResult): number {
  return result.kind === 'executed' &&
    result.technicalStatus === 'executed' &&
    result.verification?.verdict === 'satisfied'
    ? 0
    : 1;
}

/**
 * Lignes d'affichage — sépare toujours le résultat technique du verdict de
 * vérification. Le rappel « démonstration locale, aucune livraison externe »
 * est affiché par l'appelant ({@link VERIFY_DEMO_NOTICE}, voir `main.ts`)
 * AVANT la demande de confirmation, jamais répété ici.
 */
export function describeVerifyDemoResult(result: VerifyDemoResult): readonly string[] {
  switch (result.kind) {
    case 'declined':
      return ['Confirmation refusée (ou non traitée) : zéro effet.'];
    case 'confirmation_failed':
      return ['Échec de la vérification du ticket de confirmation : zéro effet.'];
    case 'not_awaiting_confirmation':
      return [`Résultat technique : ${result.technicalStatus} (aucune confirmation proposée).`];
    case 'preparation_failed':
      return ['Vérification impossible à préparer : aucune conclusion fiable, aucune exécution.'];
    case 'internal_error':
      return ['Échec interne contrôlé (proposition ou vérification) : zéro effet.'];
    case 'executed': {
      const lines = [`Résultat technique : ${result.technicalStatus}.`];
      lines.push(
        result.verification === undefined
          ? 'Verdict de vérification : absent (aucune preuve exploitable).'
          : `Verdict de vérification : ${result.verification.verdict} — ${result.verification.reason}`,
      );
      return lines;
    }
    default: {
      const exhaustive: never = result;
      return [`Résultat inattendu (${(exhaustive as { readonly kind: string }).kind}).`];
    }
  }
}
