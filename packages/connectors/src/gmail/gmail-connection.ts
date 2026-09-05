import { randomUUID } from 'node:crypto';

import type { Account, AccountStore } from '../account.js';
import type { ConfirmationService } from '../confirmation/confirmation-service.js';
import type { SecretStore } from '../secret-store.js';
import { gmailRefreshTokenSecretKey } from './gmail-auth.js';

/**
 * Orchestration du flux de connexion d'un compte Gmail — M8-A9.
 *
 * Transport-agnostique par conception : ce module ne sait jamais si le
 * consentement OAuth vient d'un navigateur desktop, d'un callback HTTP ou
 * d'un autre mécanisme futur — il reçoit uniquement un {@link GmailOAuthResult}
 * déjà normalisé par l'appelant. Aucun choix de transport (desktop vs
 * serveur) n'est fait ni supposé ici : décision volontairement différée
 * (voir l'analyse M8-A7).
 *
 * Compose uniquement des abstractions déjà existantes (`AccountStore`,
 * `SecretStore`, `gmailRefreshTokenSecretKey`) — aucune nouvelle couche de
 * stockage, aucune nouvelle notion d'authentification, aucun appel à
 * `PermissionManager`/`ToolExecutor` (la connexion d'un compte n'est pas un
 * `Tool`, elle n'a pas de niveau d'action à autoriser).
 */

/**
 * Identité Gmail minimale nécessaire pour associer un résultat OAuth à un
 * `Account` — jamais l'objet brut renvoyé par un SDK Google (profil
 * complet, `picture`, scopes…), uniquement les deux champs dont `Account` a
 * l'usage.
 */
export interface GmailOAuthIdentity {
  /** Adresse Gmail du compte connecté — devient `Account.accountIdentifier`. */
  readonly accountIdentifier: string;
  readonly displayName?: string;
}

/**
 * Résultat OAuth normalisé, indépendant du transport qui l'a produit.
 *
 * `reason` (cas `error`) est un message déjà destiné à être lisible par un
 * humain/log — comme toute autre erreur de ce dépôt (`GmailApiClient`,
 * `ConfirmationService`…), l'absence de secret dans ce message est de la
 * responsabilité du code qui construit ce résultat (la couche transport),
 * pas de ce module, qui se contente de le relayer tel quel.
 */
export type GmailOAuthResult =
  | { readonly status: 'success'; readonly identity: GmailOAuthIdentity; readonly refreshToken: string }
  | { readonly status: 'cancelled' }
  | { readonly status: 'error'; readonly reason: string };

export interface ConnectGmailAccountOptions {
  readonly result: GmailOAuthResult;
  readonly accountStore: AccountStore;
  readonly secretStore: SecretStore;
  /** Horloge injectable pour `createdAt`/`updatedAt` déterministes en test. Défaut : `Date.now`. */
  readonly now?: () => number;
}

/**
 * Résultat public d'une tentative de connexion — ne contient **jamais** le
 * refresh token, ni aucun autre credential. `rejected` est distinct
 * d'`error` : `error`/`cancelled` viennent du résultat OAuth lui-même,
 * `rejected` est une décision prise par cette orchestration (identité ou
 * refresh token inexploitable alors que l'échange OAuth a techniquement
 * réussi).
 */
export type ConnectGmailAccountOutcome =
  | { readonly status: 'connected'; readonly accountId: string; readonly provider: 'gmail'; readonly accountIdentifier: string }
  | { readonly status: 'cancelled' }
  | { readonly status: 'error'; readonly reason: string }
  | { readonly status: 'rejected'; readonly reason: string };

function findGmailAccountByIdentifier(accounts: readonly Account[], accountIdentifier: string): Account | undefined {
  return accounts.find((account) => account.accountIdentifier === accountIdentifier);
}

/**
 * Finalise une connexion Gmail à partir d'un résultat OAuth déjà obtenu côté
 * transport. Responsabilités strictement limitées à :
 *
 *   1. relayer `cancelled`/`error` sans aucun effet de bord ;
 *   2. rejeter une identité ou un refresh token vide/absent, sans rien
 *      enregistrer ;
 *   3. retrouver un compte Gmail existant par `accountIdentifier` (jamais
 *      par un autre critère — la clé du secret reste toujours dérivée de
 *      l'`accountId`, jamais de l'email, voir `gmail-auth.ts`) ;
 *   4. créer ou mettre à jour cet `Account` (`AccountStore.register` est
 *      déjà idempotent par id — aucune méthode « update » séparée n'est
 *      nécessaire) ;
 *   5. stocker le refresh token sous `gmail.{accountId}.refreshToken`
 *      (`gmailRefreshTokenSecretKey`, réutilisée telle quelle, jamais
 *      recopiée) ;
 *   6. renvoyer un résultat public minimal, sans le refresh token.
 *
 * **Ordre des opérations et limite transactionnelle** : `AccountStore` et
 * `SecretStore` sont deux stores indépendants, sans transaction commune —
 * ce module n'en simule aucune. Le secret est écrit **avant**
 * l'enregistrement de l'`Account`, délibérément : si `secretStore.set()`
 * réussit mais que `accountStore.register()` échoue ensuite, le résultat
 * est un secret orphelin (jamais référencé par aucun `Account`, donc jamais
 * lu, sans risque de sécurité ni d'incohérence visible). L'ordre inverse
 * serait pire : un `Account` visible avec `status: 'connected'` mais sans
 * secret derrière lui — une résolution ultérieure
 * (`resolveGmailCredentials`) échouerait alors sur un compte qui semble
 * pourtant connecté, et cet `Account` cassé pourrait même fausser une
 * future résolution automatique à candidat unique pour ce provider. Un
 * échec de `accountStore.register()` après un `secretStore.set()` réussi se
 * propage tel quel (exception) — aucune tentative de « rollback » du secret
 * n'est faite ici : une compensation (`SecretStore.delete()`) introduirait
 * sa propre fenêtre d'échec partiel, sans bénéfice net pour ce jalon.
 */
export async function connectGmailAccount(options: ConnectGmailAccountOptions): Promise<ConnectGmailAccountOutcome> {
  const { result, accountStore, secretStore } = options;
  const now = options.now ?? Date.now;

  if (result.status === 'cancelled') {
    return { status: 'cancelled' };
  }
  if (result.status === 'error') {
    return { status: 'error', reason: result.reason };
  }

  // result.status === 'success' ici.
  const accountIdentifier = result.identity.accountIdentifier.trim();
  const refreshToken = result.refreshToken;
  if (accountIdentifier.length === 0 || refreshToken.length === 0) {
    return {
      status: 'rejected',
      reason: 'Identité Gmail ou refresh token absent/invalide : connexion refusée.',
    };
  }

  const nowIso = new Date(now()).toISOString();
  const existingGmailAccounts = await accountStore.listByProvider('gmail');
  const existing = findGmailAccountByIdentifier(existingGmailAccounts, accountIdentifier);

  const account: Account =
    existing === undefined
      ? {
          id: randomUUID(),
          provider: 'gmail',
          accountIdentifier,
          ...(result.identity.displayName !== undefined ? { displayName: result.identity.displayName } : {}),
          status: 'connected',
          createdAt: nowIso,
          updatedAt: nowIso,
        }
      : {
          ...existing,
          ...(result.identity.displayName !== undefined ? { displayName: result.identity.displayName } : {}),
          status: 'connected',
          updatedAt: nowIso,
        };

  // Secret d'abord, Account ensuite — voir la justification ci-dessus.
  await secretStore.set(gmailRefreshTokenSecretKey(account.id), refreshToken);
  await accountStore.register(account);

  return {
    status: 'connected',
    accountId: account.id,
    provider: 'gmail',
    accountIdentifier: account.accountIdentifier,
  };
}

export interface DisconnectGmailAccountOptions {
  readonly accountId: string;
  readonly accountStore: AccountStore;
  readonly secretStore: SecretStore;
  readonly confirmationService: ConfirmationService;
  /** Horloge injectable pour `updatedAt` déterministe en test. Défaut : `Date.now`. */
  readonly now?: () => number;
}

/** Résultat public d'une déconnexion — ne contient jamais le refresh token ni aucun credential. */
export interface DisconnectGmailAccountOutcome {
  readonly status: 'disconnected';
  readonly accountId: string;
  readonly provider: 'gmail';
  readonly accountIdentifier: string;
}

/**
 * Déconnecte un compte Gmail — miroir de {@link connectGmailAccount} pour
 * l'autre bout du cycle de vie. Strictement local et transport-agnostique :
 * ne fait **aucun** appel réseau, n'appelle jamais
 * `GoogleOAuthAccessTokenProvider.revoke()` (révocation réelle côté Google —
 * volontairement hors scope tant que le transport OAuth n'est pas tranché,
 * voir l'analyse M8-A7). Ne supprime jamais l'`Account` du store : seul son
 * `status` passe à `'disconnected'` (valeur d'`AccountStatus` posée dès
 * M8-A1 mais jusqu'ici jamais atteinte par aucun code).
 *
 * Idempotent : déconnecter un compte déjà `'disconnected'` répète
 * simplement les mêmes opérations (chacune déjà idempotente —
 * `ConfirmationService.revokeForAccount`/`SecretStore.delete` ne lèvent
 * jamais si rien n'est en attente/présent), sans erreur ni cas particulier.
 *
 * **Ordre des opérations et limite transactionnelle** — même discipline que
 * {@link connectGmailAccount} (`AccountStore`/`SecretStore` restent deux
 * stores indépendants, aucune transaction commune simulée) :
 *
 *   1. `revokeForAccount()` en premier — purement protecteur : ne peut
 *      jamais rendre l'état moins sûr, quel que soit ce qui suit.
 *   2. `accountStore.register()` (statut → `'disconnected'`) **avant**
 *      `secretStore.delete()` : si l'écriture de l'`Account` échoue, rien
 *      n'a menti — le compte reste `'connected'` et son secret est
 *      toujours présent, cohérent avec la réalité. L'ordre inverse serait
 *      pire : un secret supprimé pendant qu'`Account` affiche encore
 *      `'connected'` recréerait exactement le risque déjà documenté côté
 *      connexion (un compte qui semble utilisable mais ne l'est pas, et
 *      qui pourrait fausser une future résolution automatique à candidat
 *      unique).
 *   3. `secretStore.delete()` en dernier : si cette étape échoue après que
 *      le compte a déjà basculé à `'disconnected'`, le signal côté
 *      `Account` reste correct — seul un secret orphelin persiste, un
 *      compromis déjà accepté côté connexion pour la même raison.
 *
 * @throws {UnknownAccountError} si `accountId` ne correspond à aucun
 *   compte — propagée telle quelle depuis `AccountStore.get()`, jamais
 *   ré-écrite ici.
 * @throws {Error} si le compte trouvé n'est pas un compte Gmail — même
 *   convention que {@link resolveGmailCredentials} (`gmail-auth.ts`),
 *   message sans aucune valeur sensible.
 */
export async function disconnectGmailAccount(
  options: DisconnectGmailAccountOptions,
): Promise<DisconnectGmailAccountOutcome> {
  const { accountId, accountStore, secretStore, confirmationService } = options;
  const now = options.now ?? Date.now;

  const account = await accountStore.get(accountId);
  if (account.provider !== 'gmail') {
    throw new Error(
      `disconnectGmailAccount : le compte « ${account.id} » n'est pas un compte Gmail (provider « ${account.provider} »).`,
    );
  }

  await confirmationService.revokeForAccount(account.id);

  const disconnectedAccount: Account = {
    ...account,
    status: 'disconnected',
    updatedAt: new Date(now()).toISOString(),
  };
  await accountStore.register(disconnectedAccount);
  await secretStore.delete(gmailRefreshTokenSecretKey(account.id));

  return {
    status: 'disconnected',
    accountId: account.id,
    provider: 'gmail',
    accountIdentifier: account.accountIdentifier,
  };
}
