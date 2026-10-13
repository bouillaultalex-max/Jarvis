/**
 * Câblage conditionnel simulation/réel — isolé dans un module testable
 * avec des doubles (`SecretStore`, `fetch`), jamais `main.ts` lui-même
 * (un script qui s'exécute à l'import, pas directement testable).
 *
 * `conversationalService` est construit **une seule fois, hors de la
 * branche conditionnelle** : `SimulatedLlmProvider` reste câblé dans les
 * deux modes, `AgentLoop` reste construit sans `ToolExecutor` — ni le mode
 * réel ni aucun paramètre de cette fonction ne peuvent faire apparaître un
 * provider LLM réel ou un outil `execute` (garantie structurelle, pas une
 * politique — voir `agent-loop-conversational-service.ts`).
 */
import type { SecretStore } from '@jarvis/connectors';

import { AgentLoopConversationalService } from './agent-loop-conversational-service.js';
import { BudgetedOutboundTransport } from './budgeted-outbound-transport.js';
import type { ChannelMode } from './channel-mode.js';
import type { ConversationalService, OutboundTransport } from './channel-ports.js';
import { buildLocalSyntheticConfig, type WhatsAppChannelConfig } from './config.js';
import { GraphApiOutboundTransport } from './graph-api-transport.js';
import { MAX_RESPONSE_TEXT_LENGTH_CHARS } from './message-store.js';
import { resolveRealWhatsAppConfig } from './real-whatsapp-config.js';
import type { SendAttemptBudget } from './send-attempt-budget.js';
import { SimulatedLlmProvider } from './simulated-llm-provider.js';
import { SimulatedOutboundTransport } from './simulated-transport.js';
import { StaticAccessTokenProvider } from './static-access-token-provider.js';

export interface ChannelDependencies {
  readonly config: WhatsAppChannelConfig;
  readonly transport: OutboundTransport;
  readonly conversationalService: ConversationalService;
}

export interface BuildChannelDependenciesOptions {
  readonly mode: ChannelMode;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Lu uniquement en mode réel. */
  readonly secretStore: SecretStore;
  /**
   * Fabrique **paresseuse** : n'est appelée qu'en mode réel — jamais de
   * fichier de budget créé en mode simulé, où il n'a aucun sens.
   */
  readonly openSendAttemptBudget: () => SendAttemptBudget;
  /** Injecté pour les tests — jamais le `fetch` global dans une suite de tests. Défaut : `fetch` global, utilisé seulement en mode réel. */
  readonly fetchFn?: typeof fetch;
}

export async function buildChannelDependencies(
  options: BuildChannelDependenciesOptions,
): Promise<ChannelDependencies> {
  const conversationalService: ConversationalService = new AgentLoopConversationalService(
    new SimulatedLlmProvider(),
  );

  if (options.mode === 'simulated') {
    return {
      config: buildLocalSyntheticConfig(),
      transport: new SimulatedOutboundTransport(),
      conversationalService,
    };
  }

  const real = await resolveRealWhatsAppConfig(options.secretStore, options.env);
  const budget = options.openSendAttemptBudget();
  const tokenProvider = new StaticAccessTokenProvider(real.accessToken);
  const realTransport = new GraphApiOutboundTransport(
    {
      apiVersion: real.apiVersion,
      phoneNumberId: real.phoneNumberId,
      maxBodyLength: MAX_RESPONSE_TEXT_LENGTH_CHARS,
    },
    tokenProvider,
    options.fetchFn ?? fetch,
  );

  return {
    config: {
      verifyToken: real.verifyToken,
      appSecret: real.appSecret,
      allowedSenderId: real.allowedSenderId,
    },
    transport: new BudgetedOutboundTransport(realTransport, budget),
    conversationalService,
  };
}
