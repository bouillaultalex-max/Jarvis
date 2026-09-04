export type { Connector } from './connector.js';

export type {
  InMemoryMessage,
  InMemorySentMessage,
} from './in-memory/in-memory-client.js';
export { InMemoryMailClient } from './in-memory/in-memory-client.js';

export type {
  InMemoryReadInput,
  InMemoryReadOutput,
  InMemoryPrepareReplyInput,
  InMemoryDraftReply,
  InMemorySendInput,
  InMemorySendOutput,
} from './in-memory/in-memory-connector.js';
export { inMemoryConnector } from './in-memory/in-memory-connector.js';
