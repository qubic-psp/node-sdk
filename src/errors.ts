// Errors of the SDK. Every error the SDK throws is a PspError:
//   PspApiError       — the API answered with an error (`{ errorCode, errorMessage, details }`, gateway 13.14);
//   PspAuthError      — the 401 api_auth_failed subclass, with both strings to sign for debugging;
//   PspConnectionError — no answer: the connection failed or broke (PspTimeoutError — the timeout ran out);
//   PspUnexpectedResponseError — an answer that is not the API: a redirect, an HTML page of a proxy, broken JSON.

/** Error codes the 13 operations of the SDK can return (gateway docs/13-merchant-api.md, 13.14). */
export type PspErrorCode = keyof PspErrorDetailsMap;

/** Why the signature of a request was refused (gateway 13.4). */
export type ApiAuthFailureReason =
  | 'missing_header'
  | 'malformed_header'
  | 'timestamp_out_of_window'
  | 'unknown_key'
  | 'key_revoked'
  | 'bad_signature'
  | 'nonce_reused';

/** `details` of `401 api_auth_failed`. */
export interface ApiAuthFailedDetails {
  reason: ApiAuthFailureReason;
  /** The header at `missing_header` and `malformed_header`, lower case. */
  header?: string;
  /** Server time in Unix seconds at `timestamp_out_of_window`. */
  serverTime?: number;
  /** The string the server built at `bad_signature`: diff it with your own. */
  stringToSign?: string;
}

/** `details` of each error code. */
export interface PspErrorDetailsMap {
  invalid_schema: { fields: { field: string; message: string }[] };
  invalid_url: { field: 'url'; reason: string };
  unknown_network: { network: string };
  unknown_asset: { network: string; asset: string };
  network_disabled: { network: string; operation: string };
  asset_disabled: { network: string; asset: string; operation: string };
  /** The amount must be from `min` to `max`. */
  amount_out_of_range: { network: string; asset: string; min: string; max: string | null; actual: string };
  api_auth_failed: ApiAuthFailedDetails;
  ip_not_allowed: { ip: string };
  merchant_blocked: null;
  merchant_closed: null;
  merchant_restricted: { capability: 'invoices' | 'payouts' };
  not_found: { object: string; id: string | null };
  /** The `externalId` is taken by an invoice with other fields: read `invoiceId` or use a new `externalId`. */
  invoice_conflict: { invoiceId: string };
  invalid_state: { object: string; id: string; status: string; allowed: string[] };
  invoice_has_payments: { received: string; pending: string; held: string };
  tariff_not_configured: { operationType: string; network: string; asset: string };
  merchant_paused: null;
  url_not_set: null;
  secret_not_set: null;
  /** The network of the key (`testnet` or `mainnet`) is not set up on the platform. */
  net_not_configured: { net: string };
  payload_too_large: { maxBytes: number };
  too_many_requests: { scope: string; limit: number; retryAfterSeconds: number };
  internal_error: null;
  maintenance: { message: string };
  /** `outcome: "unknown"` — a write may have been applied: repeat a create with the same `externalId`. */
  service_unavailable: { outcome: 'unknown' } | null;
  operations_paused: { flag: string; reason: string | null };
  address_pool_unavailable: { network: string };
  network_service_unavailable: { network: string };
  net_unavailable: { net: string };
}

/** What the SDK knows about the HTTP exchange of an error. */
export interface PspErrorContext {
  /** operationId, e.g. `createInvoice`. */
  operationId: string;
  method: string;
  /** Full URL of the request. */
  url: string;
  /** Number of attempts made, retries included. */
  attempts: number;
}

/** Base class of every error the SDK throws. */
export class PspError extends Error {
  override name = 'PspError';
  /** The request the error belongs to; `undefined` for errors outside a request. */
  readonly context: PspErrorContext | undefined;

  constructor(message: string, options: { cause?: unknown; context?: PspErrorContext } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.context = options.context;
  }
}

/** Fields of an API error answer. */
export interface ApiErrorInit {
  status: number;
  errorCode: string;
  errorMessage: string;
  details: unknown;
  /** `X-Request-Id`: give it to support. */
  requestId: string | null;
  /** `Retry-After` in seconds, or `details.retryAfterSeconds` of a 429. */
  retryAfterSeconds: number | null;
  headers: Headers;
}

/**
 * The API answered with an error. Branch on `errorCode` (and `details`), never on `errorMessage`.
 * `isPspApiError(err, 'invoice_conflict')` narrows `details` to the shape of the code.
 */
export class PspApiError extends PspError {
  override name = 'PspApiError';
  /** HTTP status. */
  readonly status: number;
  /** Error code; codes outside {@link PspErrorCode} may appear in new platform versions. */
  readonly errorCode: PspErrorCode | (string & {});
  /** English text for developers; it may change — do not branch on it or show it to buyers. */
  readonly errorMessage: string;
  /** Details of the code, see {@link PspErrorDetailsMap}. */
  readonly details: unknown;
  readonly requestId: string | null;
  readonly retryAfterSeconds: number | null;
  /** Headers of the answer. */
  readonly headers: Headers;

  constructor(init: ApiErrorInit, context?: PspErrorContext) {
    const where = context ? `${context.method} ${new URL(context.url).pathname}: ` : '';
    const id = init.requestId ? ` (X-Request-Id ${init.requestId})` : '';
    super(`${where}${init.status} ${init.errorCode} — ${init.errorMessage}${id}`, context ? { context } : {});
    this.status = init.status;
    this.errorCode = init.errorCode;
    this.errorMessage = init.errorMessage;
    this.details = init.details;
    this.requestId = init.requestId;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.headers = init.headers;
  }

  /** `true` when the error has this code; narrows `details`. */
  is<C extends PspErrorCode>(code: C): this is PspApiError & { errorCode: C; details: PspErrorDetailsMap[C] } {
    return this.errorCode === code;
  }
}

/**
 * `401 api_auth_failed`: the signature was refused. Do not retry in a loop: fix the key, the secret or the clock.
 * `localStringToSign` next to `serverStringToSign` shows what differs at `bad_signature`.
 */
export class PspAuthError extends PspApiError {
  override name = 'PspAuthError';
  readonly reason: ApiAuthFailureReason | (string & {});
  /** The string this SDK signed. */
  readonly localStringToSign: string;
  /** The string gateway built (only at `bad_signature`). */
  readonly serverStringToSign: string | null;
  /** Server time minus the signed time, seconds (only at `timestamp_out_of_window`). */
  readonly clockSkewSeconds: number | null;

  constructor(init: ApiErrorInit, signed: { stringToSign: string; timestamp: string }, context?: PspErrorContext) {
    super(init, context);
    const details = (init.details ?? {}) as Partial<ApiAuthFailedDetails>;
    this.reason = typeof details.reason === 'string' ? details.reason : 'unknown';
    this.localStringToSign = signed.stringToSign;
    this.serverStringToSign = typeof details.stringToSign === 'string' ? details.stringToSign : null;
    this.clockSkewSeconds =
      typeof details.serverTime === 'number' ? details.serverTime - Number(signed.timestamp) : null;
    const hint = authHint(this);
    if (hint) this.message = `${this.message}. ${hint}`;
  }
}

function authHint(err: PspAuthError): string | null {
  switch (err.reason) {
    case 'timestamp_out_of_window':
      return err.clockSkewSeconds === null
        ? 'Sync the clock of this server with NTP'
        : `The clock of this server differs from the platform by ${err.clockSkewSeconds} s: sync it with NTP`;
    case 'unknown_key':
      return 'The API key is unknown: check apiKey and that it belongs to this network (test_ / live_)';
    case 'key_revoked':
      return 'The API key was replaced: take the new key and secret from the merchant cabinet';
    case 'bad_signature': {
      if (err.serverStringToSign !== null && err.serverStringToSign !== err.localStringToSign) {
        const line = firstDifferentLine(err.localStringToSign, err.serverStringToSign);
        return `The strings to sign differ at line ${line} (a proxy changed the path or query?)`;
      }
      return 'The strings to sign are equal, so the secret is wrong: check apiSecret';
    }
    default:
      return null;
  }
}

function firstDifferentLine(a: string, b: string): number {
  const la = a.split('\n');
  const lb = b.split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) return i + 1;
  return 0;
}

/**
 * No answer came. `outcome: 'not_sent'` — the request surely did not reach the platform (connection refused, DNS);
 * `outcome: 'unknown'` — it may have been applied: repeat a create with the same `externalId`.
 */
export class PspConnectionError extends PspError {
  override name = 'PspConnectionError';
  readonly outcome: 'not_sent' | 'unknown';

  constructor(
    message: string,
    outcome: 'not_sent' | 'unknown',
    options: { cause?: unknown; context?: PspErrorContext },
  ) {
    super(message, options);
    this.outcome = outcome;
  }
}

/** The request did not finish within `timeoutMs`; the outcome is unknown. */
export class PspTimeoutError extends PspConnectionError {
  override name = 'PspTimeoutError';
  readonly timeoutMs: number;

  constructor(timeoutMs: number, options: { cause?: unknown; context?: PspErrorContext }) {
    super(`No answer within ${timeoutMs} ms; the outcome is unknown`, 'unknown', options);
    this.timeoutMs = timeoutMs;
  }
}

/** An answer that is not an API answer: a redirect, a page of a proxy, invalid JSON. */
export class PspUnexpectedResponseError extends PspError {
  override name = 'PspUnexpectedResponseError';
  readonly status: number;
  /** The first 2048 characters of the body. */
  readonly body: string;
  readonly requestId: string | null;
  readonly headers: Headers;

  constructor(
    message: string,
    init: { status: number; body: string; requestId: string | null; headers: Headers },
    context?: PspErrorContext,
  ) {
    super(message, context ? { context } : {});
    this.status = init.status;
    this.body = init.body.slice(0, 2048);
    this.requestId = init.requestId;
    this.headers = init.headers;
  }
}

/** `true` when `err` is an API error; with a code — an API error with that code and typed `details`. */
export function isPspApiError(err: unknown): err is PspApiError;
export function isPspApiError<C extends PspErrorCode>(
  err: unknown,
  code: C,
): err is PspApiError & { errorCode: C; details: PspErrorDetailsMap[C] };
export function isPspApiError(err: unknown, code?: PspErrorCode): boolean {
  return err instanceof PspApiError && (code === undefined || err.errorCode === code);
}
