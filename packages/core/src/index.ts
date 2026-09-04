export type { LlmMessage, LlmProvider, LlmResponse, LlmToolCall } from '@jarvis/llm';

export * from './tool.js';
export * from './tool-registry.js';
export * from './permissions.js';
export * from './tool-executor.js';
export * from './agent-loop.js';

/**
 * @deprecated Ancien point d'entrée conservé uniquement pour la compatibilité
 * avec `apps/api`. Le moteur de conversation est désormais {@link AgentLoop},
 * qui reçoit explicitement un {@link LlmProvider}. À retirer lorsque `apps/api`
 * sera migré vers `AgentLoop`.
 */
export class JarvisCore {}
