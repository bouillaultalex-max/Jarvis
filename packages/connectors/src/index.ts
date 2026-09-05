export type { Connector } from './connector.js';

export type { Capability } from './capability.js';
export { describeCapabilities } from './capability.js';

export type { Account, AccountStatus, AccountStore, ResolveAccountRequest } from './account.js';
export { resolveAccount } from './account.js';

export type { SecretStore } from './secret-store.js';
export { requireSecret } from './secret-store.js';

export { ConnectorRegistry } from './connector-registry.js';

export type { AccountStoreCorruptionReason } from './errors.js';
export {
  UnknownConnectorError,
  ConnectorUnavailableError,
  UnknownCapabilityError,
  UnsupportedCapabilityError,
  UnknownAccountError,
  AmbiguousAccountError,
  SecretNotFoundError,
  AccountStoreCorruptedError,
} from './errors.js';

export type {
  InMemoryMessage,
  InMemorySentMessage,
} from './in-memory/in-memory-client.js';
export { InMemoryMailClient } from './in-memory/in-memory-client.js';

export { InMemorySecretStore } from './in-memory/in-memory-secret-store.js';

export { InMemoryAccountStore } from './in-memory/in-memory-account-store.js';

export type { FileAccountStoreOptions } from './file/file-account-store.js';
export { FileAccountStore } from './file/file-account-store.js';

export type { OsCredentialSecretStoreOptions } from './os/os-credential-secret-store.js';
export { OsCredentialSecretStore } from './os/os-credential-secret-store.js';

export type {
  ConfirmationPayload,
  ConfirmationFailureReason,
  ConfirmationVerifyResult,
  ConfirmationTicket,
  ConfirmationServiceOptions,
} from './confirmation/confirmation-service.js';
export {
  ConfirmationService,
  describeConfirmationFailure,
  canonicalStringify,
  computeFingerprint,
} from './confirmation/confirmation-service.js';

export type { TextPreview } from './confirmation/text-preview.js';
export { MAX_SUMMARY_FIELD_VALUE_CHARS, buildTextPreview } from './confirmation/text-preview.js';

export type {
  ConfirmationAccountView,
  ConfirmationSummaryField,
  ConfirmationInputSummary,
  ConfirmationRequest,
  BuildConfirmationRequestOptions,
} from './confirmation/confirmation-request.js';
export { buildConfirmationRequest } from './confirmation/confirmation-request.js';

export type {
  ProposeConfirmationOptions,
  ProposeConfirmationResult,
  ConfirmationFailed,
  ConfirmAndExecuteResult,
  ConfirmAndExecuteOptions,
} from './confirmation/confirmation-flow.js';
export { proposeConfirmation, confirmAndExecute } from './confirmation/confirmation-flow.js';

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
  GmailAppCredentials,
  AccessTokenProvider,
  RefreshTokenStore,
  GoogleOAuthAccessTokenProviderOptions,
  ResolveGmailCredentialsOptions,
} from './gmail/gmail-auth.js';
export {
  GoogleOAuthAccessTokenProvider,
  loadGmailCredentialsFromEnv,
  gmailRefreshTokenSecretKey,
  resolveGmailCredentials,
} from './gmail/gmail-auth.js';

export type {
  GmailApiClientOptions,
  GmailRawHeader,
  GmailRawMessage,
  GmailRawMessagePart,
  GmailSendMessageInput,
  GmailSendMessageResult,
} from './gmail/gmail-api-client.js';
export { GmailApiClient } from './gmail/gmail-api-client.js';

export { mapGmailMessageToEmailMessage } from './gmail/gmail-message-mapper.js';

export type {
  GmailReadInput,
  GmailReadOutput,
  GmailPrepareReplyInput,
  GmailDraftReply,
  GmailSendInput,
  GmailSendOutput,
} from './gmail/gmail-connector.js';
export { gmailConnector } from './gmail/gmail-connector.js';

export type {
  GmailOAuthIdentity,
  GmailOAuthResult,
  ConnectGmailAccountOptions,
  ConnectGmailAccountOutcome,
  DisconnectGmailAccountOptions,
  DisconnectGmailAccountOutcome,
} from './gmail/gmail-connection.js';
export { connectGmailAccount, disconnectGmailAccount } from './gmail/gmail-connection.js';

export type { ResolveGmailApiClientOptions } from './gmail/gmail-client-resolver.js';
export { resolveGmailApiClient } from './gmail/gmail-client-resolver.js';

export type {
  GmailOAuthFlowOptions,
  GmailOAuthCallbackParams,
  CompleteGmailOAuthOptions,
} from './gmail/gmail-oauth-flow.js';
export { GmailOAuthFlow } from './gmail/gmail-oauth-flow.js';
