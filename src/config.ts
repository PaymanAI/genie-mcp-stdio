/** Environment contract for the bridge. Exactly one Genie credential is accepted. */

export const DEFAULT_GENIE_MCP_URL = "https://genie.paymanai.com/mcp";

export const ENV = {
  url: "GENIE_MCP_URL",
  accessToken: "GENIE_ACCESS_TOKEN",
  integrationKey: "GENIE_INTEGRATION_KEY",
  customerId: "GENIE_CUSTOMER_ID",
  customerEmail: "GENIE_CUSTOMER_EMAIL",
} as const;

/** Header names are the Genie MCP wire contract (k2-paygent-mcp GenieAccessKey.kt). */
const HEADER = {
  accessKey: "x-paygent-mcp-access-key",
  customerId: "x-paygent-mcp-customer-id",
  customerEmail: "x-paygent-mcp-customer-email",
} as const;

export type Credential =
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
  throw new ConfigError(
    `No Genie credential. Set ${ENV.accessToken} (Genie account OAuth token) or ` +
      `${ENV.integrationKey} with ${ENV.customerId} (managed integration key).`,
  );
}

export function credentialHeaders(credential: Credential): Record<string, string> {
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
  const mode =
    config.credential.kind === "oauth"
      ? "OAuth access token"
      : `integration key for customer ${config.credential.customerId}`;
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
