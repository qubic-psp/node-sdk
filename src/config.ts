// Options of the client and their validation.

/** Network of an API key: `psp_pk_live_…` works only in mainnet, `psp_pk_test_…` and older `psp_pk_…` in testnet. */
export type PspNet = 'testnet' | 'mainnet';

/** Something the SDK wants the integrator to know, e.g. that the request was signed with the previous key. */
export interface PspWarning {
  code: 'deprecated_api_key';
  message: string;
  /** For `deprecated_api_key`: until when the previous key works (ISO 8601). */
  validUntil?: string;
}

/** Information about one finished HTTP attempt, for logging and metrics. */
export interface PspResponseInfo {
  operationId: string;
  method: string;
  url: string;
  /** HTTP status; `null` when no answer came. */
  status: number | null;
  /** `X-Request-Id` of the answer: log it next to your own id. */
  requestId: string | null;
  /** Attempt number, from 1. */
  attempt: number;
  durationMs: number;
}

/** Information about a retry the SDK is going to make. */
export interface PspRetryInfo {
  operationId: string;
  method: string;
  url: string;
  /** Attempt that just failed, from 1. */
  attempt: number;
  /** Pause before the next attempt. */
  delayMs: number;
  /** The error of the failed attempt. */
  error: Error;
}

/** Options of {@link PspClient}. Every option has a default except the credentials and the base URL. */
export interface PspClientOptions {
  /** API key `psp_pk_…`. Default: `process.env.PSP_API_KEY`. */
  apiKey?: string;
  /** API secret `psp_sk_…` of the same key. Default: `process.env.PSP_API_SECRET`. Never sent over the network. */
  apiSecret?: string;
  /** Base URL of the API, e.g. `https://api.psp.example`. Default: `process.env.PSP_API_URL`. */
  baseUrl?: string;
  /**
   * Timeout of one attempt, ms. Default 180 000: the platform answers any request sooner, a shorter timeout turns
   * a slow success into an unknown outcome (gateway 13.10).
   */
  timeoutMs?: number;
  /** Retries after the first attempt, see the README «Retries». Default 4; 0 turns retries off. */
  maxRetries?: number;
  /** First pause between attempts, ms; doubles with every retry (1, 2, 4, 8 s by default). Default 1000. */
  retryBaseDelayMs?: number;
  /**
   * Longest `Retry-After` the SDK waits by itself, seconds. A longer one (e.g. 300 s of `503 maintenance`) is thrown
   * as the error with `retryAfterSeconds`. Default 30.
   */
  maxRetryAfterSeconds?: number;
  /** `fetch` implementation, e.g. to go through a proxy. Default: the global `fetch` of Node.js 18+. */
  fetch?: typeof fetch;
  /** Your product name, prepended to the `User-Agent` of the SDK, e.g. `shop-backend/2.4`. */
  userAgent?: string;
  /** Allows a plain `http://` base URL on a host other than localhost. Default `false`. */
  allowInsecureHttp?: boolean;
  /** Warnings of the SDK. Default: `process.emitWarning`. */
  onWarning?: (warning: PspWarning) => void;
  /** Called after every HTTP attempt, successful or not. */
  onResponse?: (info: PspResponseInfo) => void;
  /** Called before every retry. */
  onRetry?: (info: PspRetryInfo) => void;
}

const KEY_RE = /^psp_pk_(test_|live_)?[0-9A-Za-z]{24}$/;
const SECRET_RE = /^psp_sk_(test_|live_)?[0-9A-Za-z]{36}$/;

/** Network of a key or a secret by its prefix. */
export function netOfCredential(credential: string): PspNet {
  return /^psp_[ps]k_live_/.test(credential) ? 'mainnet' : 'testnet';
}

/** Options after defaults and validation. */
export interface ResolvedConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  net: PspNet;
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  maxRetryAfterSeconds: number;
  fetch: typeof fetch;
  userAgent: string;
  onWarning: (warning: PspWarning) => void;
  onResponse: ((info: PspResponseInfo) => void) | undefined;
  onRetry: ((info: PspRetryInfo) => void) | undefined;
}

function env(name: string): string | undefined {
  const value = typeof process === 'undefined' ? undefined : process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

function credential(value: string | undefined, name: string, envName: string, re: RegExp, example: string): string {
  if (value === undefined) {
    throw new TypeError(`${name} is required: pass it to new PspClient({ ${name} }) or set ${envName}`);
  }
  if (value !== value.trim()) throw new TypeError(`${name} has leading or trailing whitespace`);
  if (!re.test(value)) throw new TypeError(`${name} must look like ${example}`);
  return value;
}

function nonNegative(value: number | undefined, fallback: number, name: string, integer = false): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new TypeError(`${name} must be a non-negative ${integer ? 'integer' : 'number'}`);
  }
  return value;
}

const defaultWarning = (warning: PspWarning): void => {
  process.emitWarning(warning.message, { type: 'PspWarning', code: warning.code });
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Applies defaults and environment variables and validates the options. Throws `TypeError` on a wrong option. */
export function resolveConfig(options: PspClientOptions, sdkUserAgent: string): ResolvedConfig {
  const apiKey = credential(
    options.apiKey ?? env('PSP_API_KEY'),
    'apiKey',
    'PSP_API_KEY',
    KEY_RE,
    'psp_pk_test_ + 24 letters and digits',
  );
  const apiSecret = credential(
    options.apiSecret ?? env('PSP_API_SECRET'),
    'apiSecret',
    'PSP_API_SECRET',
    SECRET_RE,
    'psp_sk_test_ + 36 letters and digits',
  );
  const net = netOfCredential(apiKey);
  if (netOfCredential(apiSecret) !== net) {
    throw new TypeError(`apiKey is a ${net} key, apiSecret belongs to the other network`);
  }

  const rawBaseUrl = options.baseUrl ?? env('PSP_API_URL');
  if (rawBaseUrl === undefined) {
    throw new TypeError('baseUrl is required: pass it to new PspClient({ baseUrl }) or set PSP_API_URL');
  }
  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new TypeError(`baseUrl is not a URL: ${JSON.stringify(rawBaseUrl)}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new TypeError('baseUrl must be https://');
  if (url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname) && options.allowInsecureHttp !== true) {
    throw new TypeError('baseUrl must be https:// (plain http is allowed for localhost or with allowInsecureHttp)');
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new TypeError('baseUrl must not contain a query, a fragment or credentials');
  }

  const fetchImpl = options.fetch ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!fetchImpl) throw new TypeError('No global fetch: use Node.js 18+ or pass the fetch option');

  const timeoutMs = nonNegative(options.timeoutMs, 180_000, 'timeoutMs');
  if (timeoutMs === 0) throw new TypeError('timeoutMs must be positive');

  return {
    apiKey,
    apiSecret,
    baseUrl: url.href,
    net,
    timeoutMs,
    maxRetries: nonNegative(options.maxRetries, 4, 'maxRetries', true),
    retryBaseDelayMs: nonNegative(options.retryBaseDelayMs, 1000, 'retryBaseDelayMs'),
    maxRetryAfterSeconds: nonNegative(options.maxRetryAfterSeconds, 30, 'maxRetryAfterSeconds'),
    fetch: fetchImpl,
    userAgent: options.userAgent ? `${options.userAgent} ${sdkUserAgent}` : sdkUserAgent,
    onWarning: options.onWarning ?? defaultWarning,
    onResponse: options.onResponse,
    onRetry: options.onRetry,
  };
}
