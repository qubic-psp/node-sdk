// One call of an operation: URL and body built once, every attempt signed anew, retries by gateway 13.10.
import type { PspResponseInfo, ResolvedConfig } from './config';
import {
  PspApiError,
  PspAuthError,
  PspConnectionError,
  PspError,
  PspTimeoutError,
  PspUnexpectedResponseError,
  type ApiErrorInit,
  type PspErrorContext,
} from './errors';
import { buildQuery, pathSegment, resolveTarget, type QueryParams } from './query';
import { ROUTES, type OperationId, type RetryRule } from './routes';
import { signRequest } from './signing';

/** Per-call options, accepted by every method as the last argument. */
export interface RequestOptions {
  /**
   * `X-Client-Request-Id`: your id of the request, 1–128 printable ASCII characters without spaces. Not signed;
   * echoed in the answer and shown in the action log of the merchant cabinet. The same value goes with every retry.
   */
  clientRequestId?: string;
  /** Aborts the request and the pending retries; the promise rejects with the reason of the signal. */
  signal?: AbortSignal;
  /** Timeout of one attempt for this call, ms. */
  timeoutMs?: number;
  /** Retries for this call; `0` turns them off. */
  maxRetries?: number;
}

/** HTTP details of a successful answer, see {@link getResponseMeta}. */
export interface ResponseMeta {
  /** HTTP status: e.g. `201` — the invoice was created by this call, `200` — it existed before. */
  status: number;
  /** `X-Request-Id`: give it to support together with your `clientRequestId`. */
  requestId: string | null;
  /** `X-Client-Request-Id` echoed by the platform. */
  clientRequestId: string | null;
  /** Attempts made, retries included. */
  attempts: number;
  headers: Headers;
}

const responseMeta = new WeakMap<object, ResponseMeta>();

/**
 * HTTP details of an object returned by an SDK method (an invoice, a page, settings…):
 * `getResponseMeta(invoice)?.status === 201`. `undefined` for other objects.
 */
export function getResponseMeta(value: object): ResponseMeta | undefined {
  return responseMeta.get(value);
}

/** Arguments of one call. */
export interface CallInput {
  /** Values of the `{param}` placeholders of the path. */
  path?: Readonly<Record<string, string>>;
  query?: QueryParams;
  /** JSON body; `undefined` — a request without a body. */
  body?: unknown;
  options?: RequestOptions | undefined;
}

const CLIENT_REQUEST_ID_RE = /^[\x21-\x7E]{1,128}$/;

/** Error codes of connections that surely did not deliver the request. */
const NOT_SENT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/** TLS failures: the request was not sent and a retry does not help. */
const TLS_CODE_RE = /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/;

function errorCodes(err: unknown): string[] {
  const codes: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current && typeof current === 'object' && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') codes.push(code);
    current = (current as { cause?: unknown }).cause;
  }
  return codes;
}

function parseRetryAfter(header: string | null, now: number): number | null {
  if (header === null) return null;
  if (/^\d+$/.test(header.trim())) return Number(header.trim());
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - now) / 1000));
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason as Error);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason as Error);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

interface Exchange {
  response: Response;
  text: string;
}

/** State of the retries of one call. */
interface RetryState {
  rule: RetryRule;
  attempt: number;
  maxRetries: number;
  authRetried: boolean;
  internalRetried: boolean;
}

/** Sends the operations of the merchant API. One instance per client. */
export class Transport {
  readonly #config: ResolvedConfig;
  readonly #warnedDeprecated = new Set<string>();

  constructor(config: ResolvedConfig) {
    this.#config = config;
  }

  async call<T>(operationId: OperationId, input: CallInput = {}): Promise<T> {
    const route = ROUTES[operationId];
    const options = input.options ?? {};
    const path = route.path.replace(/\{(\w+)\}/g, (_, name: string) => {
      const value = input.path?.[name];
      if (typeof value !== 'string' || value === '') throw new TypeError(`${name} is required`);
      return pathSegment(value);
    });
    const { url, target } = resolveTarget(this.#config.baseUrl, `${path}${buildQuery(input.query)}`);
    const body = input.body === undefined ? null : JSON.stringify(input.body);
    const clientRequestId = options.clientRequestId;
    if (clientRequestId !== undefined && !CLIENT_REQUEST_ID_RE.test(clientRequestId)) {
      throw new TypeError('clientRequestId must be 1–128 printable ASCII characters without spaces');
    }
    const timeoutMs = options.timeoutMs ?? this.#config.timeoutMs;
    const state: RetryState = {
      rule: route.retry,
      attempt: 0,
      maxRetries: options.maxRetries ?? this.#config.maxRetries,
      authRetried: false,
      internalRetried: false,
    };

    for (;;) {
      state.attempt++;
      const context: PspErrorContext = { operationId, method: route.method, url: url.href, attempts: state.attempt };
      const signed = signRequest({
        apiKey: this.#config.apiKey,
        apiSecret: this.#config.apiSecret,
        method: route.method,
        target,
        body,
      });
      const headers: Record<string, string> = {
        ...signed.headers,
        Accept: 'application/json',
        'User-Agent': this.#config.userAgent,
      };
      if (body !== null) headers['Content-Type'] = 'application/json';
      if (clientRequestId !== undefined) headers['X-Client-Request-Id'] = clientRequestId;

      const started = Date.now();
      let outcome: Exchange | PspError;
      try {
        outcome = await this.#send(url, route.method, headers, body, timeoutMs, options.signal, context);
      } catch (err) {
        if (!(err instanceof PspError)) throw err;
        outcome = err;
      }
      const exchange = outcome instanceof PspError ? null : outcome;
      this.#report({
        operationId,
        method: route.method,
        url: url.href,
        status: exchange?.response.status ?? null,
        requestId: exchange?.response.headers.get('x-request-id') ?? null,
        attempt: state.attempt,
        durationMs: Date.now() - started,
      });

      let error: PspError;
      if (exchange === null) {
        error = outcome as PspError;
      } else {
        this.#warnDeprecatedKey(exchange.response.headers);
        const result = this.#interpret(exchange, signed, context);
        if (!(result instanceof PspError)) return result as T;
        error = result;
      }

      const delayMs = this.#retryDelay(state, error);
      if (delayMs === null) throw error;
      try {
        this.#config.onRetry?.({
          operationId,
          method: route.method,
          url: url.href,
          attempt: state.attempt,
          delayMs,
          error,
        });
      } catch {
        // a failing hook must not change the outcome of the call
      }
      await sleep(delayMs, options.signal);
    }
  }

  async #send(
    url: URL,
    method: string,
    headers: Record<string, string>,
    body: string | null,
    timeoutMs: number,
    signal: AbortSignal | undefined,
    context: PspErrorContext,
  ): Promise<Exchange> {
    if (signal?.aborted) throw signal.reason;
    const controller = new AbortController();
    const timeoutReason = new Error('timeout');
    const timer = setTimeout(() => {
      controller.abort(timeoutReason);
    }, timeoutMs);
    const onAbort = (): void => {
      controller.abort(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await this.#config.fetch(url.href, {
        method,
        headers,
        body: body ?? undefined,
        redirect: 'manual',
        signal: controller.signal,
      });
      const text = await response.text();
      return { response, text };
    } catch (err) {
      if (controller.signal.reason === timeoutReason) throw new PspTimeoutError(timeoutMs, { cause: err, context });
      if (signal?.aborted) throw signal.reason;
      const codes = errorCodes(err);
      const notSent = codes.some((c) => NOT_SENT_CODES.has(c) || TLS_CODE_RE.test(c));
      const reason = codes.length ? ` (${codes.join(', ')})` : '';
      throw new PspConnectionError(
        notSent
          ? `The request did not reach ${url.host}${reason}`
          : `The connection to ${url.host} broke${reason}; the outcome is unknown`,
        notSent ? 'not_sent' : 'unknown',
        { cause: err, context },
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** The value of a successful answer, or the error of an unsuccessful one. */
  #interpret(
    { response, text }: Exchange,
    signed: { stringToSign: string; timestamp: string },
    context: PspErrorContext,
  ): unknown {
    const { status, headers } = response;
    const requestId = headers.get('x-request-id');
    const unexpected = (message: string): PspUnexpectedResponseError =>
      new PspUnexpectedResponseError(message, { status, body: text, requestId, headers }, context);

    if (status >= 300 && status < 400) {
      return unexpected(`Redirect ${status} to ${headers.get('location') ?? '?'}: check baseUrl`);
    }
    let json: unknown;
    try {
      json = text === '' ? undefined : JSON.parse(text);
    } catch {
      return unexpected(`HTTP ${status} with a body that is not JSON: check baseUrl or the proxy in front of it`);
    }

    if (status >= 200 && status < 300) {
      if (json === undefined) return unexpected(`HTTP ${status} without a body`);
      if (json !== null && typeof json === 'object') {
        responseMeta.set(json, {
          status,
          requestId,
          clientRequestId: headers.get('x-client-request-id'),
          attempts: context.attempts,
          headers,
        });
      }
      return json;
    }

    const shape = json as { errorCode?: unknown; errorMessage?: unknown; details?: unknown } | undefined;
    if (!shape || typeof shape !== 'object' || typeof shape.errorCode !== 'string') {
      return unexpected(`HTTP ${status} without an API error body`);
    }
    const details = shape.details ?? null;
    const detailsRetry =
      details !== null && typeof details === 'object'
        ? (details as Record<string, unknown>)['retryAfterSeconds']
        : undefined;
    const init: ApiErrorInit = {
      status,
      errorCode: shape.errorCode,
      errorMessage: typeof shape.errorMessage === 'string' ? shape.errorMessage : '',
      details,
      requestId,
      retryAfterSeconds:
        parseRetryAfter(headers.get('retry-after'), Date.now()) ??
        (typeof detailsRetry === 'number' ? detailsRetry : null),
      headers,
    };
    return status === 401 && shape.errorCode === 'api_auth_failed'
      ? new PspAuthError(init, signed, context)
      : new PspApiError(init, context);
  }

  /** Pause before the next attempt, or `null` when the error must be thrown. */
  #retryDelay(state: RetryState, error: PspError): number | null {
    if (state.attempt > state.maxRetries) return null;
    const backoff = Math.round(this.#config.retryBaseDelayMs * 2 ** (state.attempt - 1) * (0.8 + Math.random() * 0.4));

    const permanentConnection =
      error instanceof PspConnectionError && errorCodes(error.cause).some((c) => TLS_CODE_RE.test(c));
    // Failures after which the operation surely did not run: safe to repeat whatever it is
    const notApplied =
      (error instanceof PspConnectionError && error.outcome === 'not_sent' && !permanentConnection) ||
      (error instanceof PspApiError &&
        ((error.errorCode === 'service_unavailable' && error.details === null) ||
          error.errorCode === 'net_unavailable'));
    if (state.rule === 'never') return notApplied ? backoff : null;
    if (state.rule === 'once' && state.attempt >= 2) return null;

    if (error instanceof PspConnectionError) return permanentConnection ? null : backoff;
    if (error instanceof PspAuthError) {
      // A single timestamp_out_of_window right after a restart of the platform passes with a fresh time (13.3)
      if (error.reason !== 'timestamp_out_of_window' || state.authRetried) return null;
      state.authRetried = true;
      return backoff;
    }
    if (error instanceof PspApiError) {
      switch (error.errorCode) {
        case 'service_unavailable':
        case 'address_pool_unavailable':
        case 'net_unavailable':
          return backoff;
        case 'internal_error':
          if (state.internalRetried) return null;
          state.internalRetried = true;
          return backoff;
        case 'too_many_requests':
        case 'maintenance': {
          const seconds = error.retryAfterSeconds;
          return seconds !== null && seconds <= this.#config.maxRetryAfterSeconds ? seconds * 1000 : null;
        }
        default:
          return null;
      }
    }
    if (error instanceof PspUnexpectedResponseError) {
      return [502, 503, 504].includes(error.status) ? backoff : null;
    }
    return null;
  }

  #report(info: PspResponseInfo): void {
    try {
      this.#config.onResponse?.(info);
    } catch {
      // a failing hook must not change the outcome of the call
    }
  }

  #warnDeprecatedKey(headers: Headers): void {
    const validUntil = headers.get('x-api-key-deprecated');
    if (validUntil === null || this.#warnedDeprecated.has(validUntil)) return;
    this.#warnedDeprecated.add(validUntil);
    try {
      this.#config.onWarning({
        code: 'deprecated_api_key',
        message: `The request was signed with the previous API key, valid until ${validUntil}: switch to the new key and secret`,
        validUntil,
      });
    } catch {
      // a failing hook must not change the outcome of the call
    }
  }
}
