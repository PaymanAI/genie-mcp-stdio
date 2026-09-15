/**
 * Environment contract for the bridge. With no credential variables set, the bridge acts as
 * the signed-in Genie account holder (browser sign-in, refresh token on disk; ADR-0014).
 * An explicit token or integration key overrides that; setting both is refused.
 */

export const DEFAULT_GENIE_MCP_URL = "https://genie.paymanai.com/mcp";

export const ENV = {
  url: "GENIE_MCP_URL",
  accessToken: "GENIE_ACCESS_TOKEN",
  integrationKey: "GENIE_INTEGRATION_KEY",
  customerId: "GENIE_CUSTOMER_ID",
  customerEmail: "GENIE_CUSTOMER_EMAIL",
  clientId: "GENIE_OAUTH_CLIENT_ID",
  browserCommand: "GENIE_BROWSER_COMMAND",
  credentialsFile: "GENIE_CREDENTIALS_FILE",
} as const;

export const DEFAULT_OAUTH_CLIENT_ID = "genie-mcp-stdio";

/** Header names are the Genie MCP wire contract (k2-paygent-mcp GenieAccessKey.kt). */
const HEADER = {
  accessKey: "x-paygent-mcp-access-key",
  customerId: "x-paygent-mcp-customer-id",
  customerEmail: "x-paygent-mcp-customer-email",
} as const;

export type Credential =
  | { kind: "account"; clientId: string; browserCommand: string | undefined }
  | { kind: "oauth"; accessToken: string }
  | { kind: "integration"; key: string; customerId: string; customerEmail: string | undefined };

export interface BridgeConfig {
  url: URL;
  credential: Credential;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

export function readConfig(env: NodeJS.ProcessEnv): BridgeConfig {
  const url = parseUrl(env[ENV.url]);
  const token = blankToUndefined(env[ENV.accessToken]);
  const key = blankToUndefined(env[ENV.integrationKey]);
  if (token !== undefined && key !== undefined) {
    throw new ConfigError(
      `Set only one of ${ENV.accessToken} or ${ENV.integrationKey}; Genie refuses requests carrying both.`,
    );
  }
  if (token !== undefined) {
    return { url, credential: { kind: "oauth", accessToken: token } };
  }
  if (key !== undefined) {
    const customerId = blankToUndefined(env[ENV.customerId]);
    if (customerId === undefined) {
      throw new ConfigError(
        `${ENV.integrationKey} requires ${ENV.customerId}: the Genie account holder this bridge acts for.`,
      );
    }
    return {
      url,
      credential: {
        kind: "integration",
        key,
        customerId,
        customerEmail: blankToUndefined(env[ENV.customerEmail]),
      },
    };
  }
  return {
    url,
    credential: {
      kind: "account",
      clientId: blankToUndefined(env[ENV.clientId]) ?? DEFAULT_OAUTH_CLIENT_ID,
      browserCommand: blankToUndefined(env[ENV.browserCommand]),
    },
  };
}

/** Static headers for the explicit modes; account mode authenticates through the SDK. */
export function credentialHeaders(credential: Credential): Record<string, string> {
  if (credential.kind === "account") return {};
  if (credential.kind === "oauth") {
    return { authorization: `Bearer ${credential.accessToken}` };
  }
  const headers: Record<string, string> = {
    [HEADER.accessKey]: credential.key,
    [HEADER.customerId]: credential.customerId,
  };
  if (credential.customerEmail !== undefined) {
    headers[HEADER.customerEmail] = credential.customerEmail;
  }
  return headers;
}

/** Safe to print: names the mode and the endpoint, never a secret. */
export function describeConfig(config: BridgeConfig): string {
  const credential = config.credential;
  const mode =
    credential.kind === "account"
      ? `signed-in Genie account, client ${credential.clientId}`
      : credential.kind === "oauth"
        ? "OAuth access token"
        : `integration key for customer ${credential.customerId}`;
  return `${config.url.href} (${mode})`;
}

function parseUrl(value: string | undefined): URL {
  const raw = blankToUndefined(value) ?? DEFAULT_GENIE_MCP_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`${ENV.url} is not a valid URL: ${raw}`);
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new ConfigError(`${ENV.url} must be https (plain http only for loopback): ${raw}`);
  }
  return url;
}

function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}
