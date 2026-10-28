// Request signing of the merchant API, scheme v1 (gateway docs/13-merchant-api.md, 13.2–13.3):
//   string to sign = "v1" \n METHOD \n TARGET \n X-Api-Timestamp \n X-Api-Nonce \n hex(sha256(body))
//   X-Api-Signature = "v1=" + hex(HMAC-SHA256(key = UTF-8 bytes of the secret, message = UTF-8 bytes of the string))
import { createHash, createHmac, randomUUID } from 'node:crypto';

/** SHA-256 of an empty body: every GET, DELETE and POST without a body is signed with it. */
export const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const TIMESTAMP_RE = /^[0-9]{10}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const METHOD_RE = /^[A-Z]+$/;

/** Body of a signed request: exactly the bytes that go over the wire. A string is taken as UTF-8. */
export type RequestBody = Uint8Array | string;

/** Lower-case hex SHA-256 of the bytes (a string is hashed as UTF-8). */
export function sha256Hex(data: RequestBody): string {
  return createHash('sha256').update(data).digest('hex');
}

/** The six elements of the v1 string to sign. */
export interface StringToSignParts {
  /** HTTP method; upper-cased before signing. */
  method: string;
  /** Path and query exactly as in the HTTP request line, e.g. `/api/v1/invoices?status=active,paid&limit=20`. */
  target: string;
  /** `X-Api-Timestamp`: Unix seconds, 10 digits. */
  timestamp: string;
  /** `X-Api-Nonce`: 16–64 characters `[A-Za-z0-9_-]`. */
  nonce: string;
  /** Lower-case hex SHA-256 of the body bytes, {@link EMPTY_BODY_SHA256} without a body. */
  bodySha256: string;
}

/** Builds the v1 string to sign: six lines joined by a single `\n`, no trailing newline. */
export function buildStringToSign(parts: StringToSignParts): string {
  return ['v1', parts.method.toUpperCase(), parts.target, parts.timestamp, parts.nonce, parts.bodySha256].join('\n');
}

/** `v1=` and the lower-case hex HMAC-SHA256 of the string to sign, keyed with the UTF-8 bytes of the secret. */
export function signString(apiSecret: string, stringToSign: string): string {
  return `v1=${createHmac('sha256', Buffer.from(apiSecret, 'utf8')).update(stringToSign, 'utf8').digest('hex')}`;
}

/** Current time for `X-Api-Timestamp`: Unix seconds UTC as a 10-digit string. */
export function unixSeconds(ms: number = Date.now()): string {
  return String(Math.floor(ms / 1000));
}

/** A fresh nonce for `X-Api-Nonce`: a UUID v4 from the cryptographic generator. */
export function newNonce(): string {
  return randomUUID();
}

/** Input of {@link signRequest}. */
export interface SignRequestInput {
  /** `keyId` of the API key, `psp_pk_…`. */
  apiKey: string;
  /** API secret, `psp_sk_…`. Never sent: it only keys the HMAC. */
  apiSecret: string;
  /** HTTP method, e.g. `POST`. */
  method: string;
  /** Path and query exactly as they will be sent (see {@link StringToSignParts.target}). */
  target: string;
  /** The body bytes that will be sent; omit or pass `null` for a request without a body. */
  body?: RequestBody | null;
  /** Fixed `X-Api-Timestamp` (tests, replays of vectors); defaults to now. */
  timestamp?: string;
  /** Fixed `X-Api-Nonce` (tests, replays of vectors); defaults to a fresh UUID v4. */
  nonce?: string;
}

/** The four signature headers of a request. */
export interface SignatureHeaders {
  'X-Api-Key': string;
  'X-Api-Timestamp': string;
  'X-Api-Nonce': string;
  'X-Api-Signature': string;
}

/** Result of {@link signRequest}. */
export interface SignedRequest {
  /** Headers to add to the request. */
  headers: SignatureHeaders;
  /** The string that was signed: compare it with `details.stringToSign` of a `bad_signature` answer. */
  stringToSign: string;
  bodySha256: string;
  timestamp: string;
  nonce: string;
  /** `X-Api-Signature` value, `v1=<64 hex>`. */
  signature: string;
}

/**
 * Signs one request of the merchant API. Every attempt needs its own call: a retry gets a new timestamp,
 * a new nonce and a new signature.
 */
export function signRequest(input: SignRequestInput): SignedRequest {
  const method = input.method.toUpperCase();
  if (!METHOD_RE.test(method)) throw new TypeError(`Invalid HTTP method: ${JSON.stringify(input.method)}`);
  if (!input.target.startsWith('/') || input.target.includes('#')) {
    throw new TypeError('target must be the path and query of the request line: start with "/", no scheme, host or #');
  }
  const timestamp = input.timestamp ?? unixSeconds();
  if (!TIMESTAMP_RE.test(timestamp)) throw new TypeError('timestamp must be Unix seconds, exactly 10 digits');
  const nonce = input.nonce ?? newNonce();
  if (!NONCE_RE.test(nonce)) throw new TypeError('nonce must be 16–64 characters [A-Za-z0-9_-]');

  const body = input.body ?? null;
  const bodySha256 = body === null || body.length === 0 ? EMPTY_BODY_SHA256 : sha256Hex(body);
  const stringToSign = buildStringToSign({ method, target: input.target, timestamp, nonce, bodySha256 });
  const signature = signString(input.apiSecret, stringToSign);
  return {
    headers: {
      'X-Api-Key': input.apiKey,
      'X-Api-Timestamp': timestamp,
      'X-Api-Nonce': nonce,
      'X-Api-Signature': signature,
    },
    stringToSign,
    bodySha256,
    timestamp,
    nonce,
    signature,
  };
}
