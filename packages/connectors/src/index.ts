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

export type {
  GmailCredentials,
  AccessTokenProvider,
  RefreshTokenStore,
  GoogleOAuthAccessTokenProviderOptions,
} from './gmail/gmail-auth.js';
export { GoogleOAuthAccessTokenProvider, loadGmailCredentialsFromEnv } from './gmail/gmail-auth.js';

export type {
  GmailApiClientOptions,
  GmailRawHeader,
  GmailRawMessage,
  GmailRawMessagePart,
} from './gmail/gmail-api-client.js';
export { GmailApiClient } from './gmail/gmail-api-client.js';

export { mapGmailMessageToEmailMessage } from './gmail/gmail-message-mapper.js';

export type {
  GmailReadInput,
  GmailReadOutput,
  GmailPrepareReplyInput,
  GmailDraftReply,
} from './gmail/gmail-connector.js';
export { gmailConnector } from './gmail/gmail-connector.js';
