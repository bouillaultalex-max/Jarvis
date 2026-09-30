export type { LegifranceEnvironment, LegifranceConfig } from './config/legifrance-config.js';
export {
  LEGIFRANCE_ENVIRONMENTS,
  createLegifranceConfig,
  resolveLegifranceEnvironment,
} from './config/legifrance-config.js';

export type { LegifranceCredentials } from './auth/legifrance-credentials.js';
export {
  legifranceClientIdSecretKey,
  legifranceClientSecretSecretKey,
} from './auth/legifrance-credentials.js';

export type { LegifranceOAuthClientOptions } from './auth/legifrance-oauth-client.js';
export {
  LegifranceOAuthClient,
  DEFAULT_EXPIRY_SAFETY_MARGIN_MS,
} from './auth/legifrance-oauth-client.js';

export type {
  LegifranceHttpClientOptions,
  LegifranceRequestOptions,
} from './http/legifrance-http-client.js';
export { LegifranceHttpClient } from './http/legifrance-http-client.js';

export type { LegifranceHttpErrorKind } from './errors/legifrance-errors.js';
export {
  LegifranceConfigError,
  LegifranceOAuthError,
  LegifranceMalformedResponseError,
  LegifranceNetworkError,
  LegifranceHttpError,
} from './errors/legifrance-errors.js';
