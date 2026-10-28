// Verification of incoming webhooks (webhook-service docs/13-merchant-webhooks.md, 13.6):
//   string to sign = X-Webhook-Timestamp + "." + raw body bytes
//   X-Webhook-Signature: v1=<hex(HMAC-SHA256(key = UTF-8 bytes of the API secret, message = string to sign))>
// The time is accepted within ±300 s, signatures are compared in constant time, and only then the JSON is parsed.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PspNet } from '../config';
import { PspError } from '../errors';
import type { WebhookEvent } from './events';

/** Default window of `X-Webhook-Timestamp` around the clock of your server, seconds. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * Why a webhook was refused:
 * - signature (answer `401`): `missing_header`, `bad_timestamp`, `timestamp_out_of_window`, `bad_signature_header`,
 *   `signature_mismatch`;
 * - body after a valid signature (answer `400`): `bad_body`, `id_mismatch`, `type_mismatch`, `unsupported_version`;
 * - another merchant or network (answer `401`): `merchant_mismatch`, `chain_mismatch`.
 */
export type WebhookVerificationReason =
  | 'missing_header'
  | 'bad_timestamp'
  | 'timestamp_out_of_window'
  | 'bad_signature_header'
  | 'signature_mismatch'
  | 'bad_body'
  | 'id_mismatch'
  | 'type_mismatch'
  | 'unsupported_version'
  | 'merchant_mismatch'
  | 'chain_mismatch';

const STATUS: Record<WebhookVerificationReason, 400 | 401> = {
  missing_header: 401,
  bad_timestamp: 401,
  timestamp_out_of_window: 401,
  bad_signature_header: 401,
  signature_mismatch: 401,
  bad_body: 400,
  id_mismatch: 400,
  type_mismatch: 400,
  unsupported_version: 400,
  merchant_mismatch: 401,
  chain_mismatch: 401,
};

/**
 * The webhook did not pass verification. Answer with `status` (any non-2xx makes the platform retry later) and do not
 * process the body.
 */
export class WebhookVerificationError extends PspError {
  override name = 'WebhookVerificationError';
  readonly reason: WebhookVerificationReason;
  /** HTTP status to answer with: `401` for signature problems, `400` for body problems. */
  readonly status: 400 | 401;

  constructor(reason: WebhookVerificationReason, message: string) {
    super(`${reason}: ${message}`);
    this.reason = reason;
    this.status = STATUS[reason];
  }
}

/** Raw bytes of the request body exactly as they arrived. A string is taken as UTF-8. */
export type WebhookBody = Uint8Array | string;

/** Request headers: Node.js `req.headers` (any case of names) or a Fetch API `Headers`. */
export type WebhookHeaders = Headers | Readonly<Record<string, string | readonly string[] | undefined>>;

function header(headers: WebhookHeaders, name: string): string | undefined {
  if (typeof (headers as Headers).get === 'function') return (headers as Headers).get(name) ?? undefined;
  const record = headers as Readonly<Record<string, string | readonly string[] | undefined>>;
  const key = name in record ? name : Object.keys(record).find((k) => k.toLowerCase() === name);
  const value = key === undefined ? undefined : record[key];
  return Array.isArray(value) ? (value as readonly string[])[0] : (value as string | undefined);
}

function toBuffer(body: WebhookBody): Buffer {
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  throw new TypeError(
    'Pass the raw body bytes (Buffer or string), not a parsed object: e.g. express.raw({ type: "application/json" })',
  );
}

/** `v1=<hex>` signature of a webhook body; use it to sign fake webhooks in the tests of your handler. */
export function signWebhook(secret: string, timestamp: string | number, body: WebhookBody): string {
  const mac = createHmac('sha256', Buffer.from(secret, 'utf8'));
  mac.update(`${String(timestamp)}.`, 'utf8');
  mac.update(toBuffer(body));
  return `v1=${mac.digest('hex')}`;
}

/** Input of {@link verifyWebhookSignature}. */
export interface VerifyWebhookSignatureInput {
  /** Raw body bytes, before any JSON parsing. */
  body: WebhookBody;
  headers: WebhookHeaders;
  /** The API secret of the network the webhooks come from. */
  secret: string;
  /** The previous secret during a rotation: the webhook passes if it matches either. */
  previousSecret?: string | undefined;
  /** Window of `X-Webhook-Timestamp`, seconds. Default 300. */
  toleranceSeconds?: number | undefined;
  /** Current time (Unix seconds or a `Date`) — for tests. Default: now. */
  now?: number | Date | undefined;
}

/** Result of a valid signature. */
export interface WebhookSignatureResult {
  /** Which secret matched: `previous` — the platform still signs with the old secret (the hold after a rotation). */
  signedWith: 'current' | 'previous';
  /** `X-Webhook-Timestamp`, Unix seconds. */
  timestamp: number;
  /** `X-Webhook-Attempt`, from 1; `null` when absent. */
  attempt: number | null;
}

const TIMESTAMP_RE = /^[0-9]{1,12}$/;
const SIGNATURE_RE = /^v1=([0-9a-f]{64})$/;

function nowSeconds(now: number | Date | undefined): number {
  if (now instanceof Date) return Math.floor(now.getTime() / 1000);
  return now ?? Math.floor(Date.now() / 1000);
}

/** Steps 1–6 of 13.6: time window, signature format, HMAC, constant-time comparison. Throws on a failure. */
export function verifyWebhookSignature(input: VerifyWebhookSignatureInput): WebhookSignatureResult {
  const body = toBuffer(input.body);
  const timestamp = header(input.headers, 'x-webhook-timestamp');
  const signature = header(input.headers, 'x-webhook-signature');
  if (timestamp === undefined || signature === undefined) {
    throw new WebhookVerificationError('missing_header', 'X-Webhook-Timestamp and X-Webhook-Signature are required');
  }
  if (!TIMESTAMP_RE.test(timestamp)) {
    throw new WebhookVerificationError('bad_timestamp', 'X-Webhook-Timestamp must be Unix seconds, digits only');
  }
  const tolerance = input.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  const skew = nowSeconds(input.now) - Number(timestamp);
  if (Math.abs(skew) > tolerance) {
    throw new WebhookVerificationError(
      'timestamp_out_of_window',
      `X-Webhook-Timestamp is ${skew} s away from the clock of this server (window ±${tolerance} s): sync it with NTP`,
    );
  }
  const match = SIGNATURE_RE.exec(signature);
  if (!match?.[1]) {
    throw new WebhookVerificationError('bad_signature_header', 'X-Webhook-Signature must be v1= and 64 lower-case hex');
  }
  const received = Buffer.from(match[1], 'hex');
  const matches = (secret: string): boolean => {
    const expected = Buffer.from(signWebhook(secret, timestamp, body).slice(3), 'hex');
    return timingSafeEqual(expected, received);
  };
  const attemptHeader = header(input.headers, 'x-webhook-attempt');
  const attempt = attemptHeader !== undefined && /^\d+$/.test(attemptHeader) ? Number(attemptHeader) : null;
  if (matches(input.secret)) return { signedWith: 'current', timestamp: Number(timestamp), attempt };
  if (input.previousSecret !== undefined && matches(input.previousSecret)) {
    return { signedWith: 'previous', timestamp: Number(timestamp), attempt };
  }
  throw new WebhookVerificationError(
    'signature_mismatch',
    'the signature does not match: check the secret (of this network) and that the body is the raw bytes',
  );
}

/** Input of {@link verifyWebhook}. */
export interface VerifyWebhookInput extends VerifyWebhookSignatureInput {
  /** Your merchant id (`psp.account.get()`); the body must carry it. */
  expectedMerchantId?: string | undefined;
  /** Network of your secret: `mainnet` accepts only `chain: "mainnet"`, `testnet` — any other chain. */
  net?: PspNet | undefined;
}

type Json = Record<string, unknown>;

/**
 * Verifies a webhook and returns its typed body (13.6, steps 1–7). Throws {@link WebhookVerificationError}: answer
 * with its `status` and do not process. After it returns: drop duplicates by `event.id`, store, answer `2xx`.
 */
export function verifyWebhook(input: VerifyWebhookInput): WebhookEvent {
  verifyWebhookSignature(input);
  const id = header(input.headers, 'x-webhook-id');
  const type = header(input.headers, 'x-webhook-event');
  if (id === undefined || type === undefined) {
    throw new WebhookVerificationError('missing_header', 'X-Webhook-Id and X-Webhook-Event are required');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(toBuffer(input.body).toString('utf8'));
  } catch {
    throw new WebhookVerificationError('bad_body', 'the body is not JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new WebhookVerificationError('bad_body', 'the body is not a JSON object');
  }
  const event = parsed as Json;
  const data = event['data'];
  if (
    typeof event['id'] !== 'string' ||
    typeof event['type'] !== 'string' ||
    typeof event['chain'] !== 'string' ||
    typeof event['merchantId'] !== 'string' ||
    data === null ||
    typeof data !== 'object'
  ) {
    throw new WebhookVerificationError('bad_body', 'id, type, chain, merchantId and data are required');
  }
  if (event['id'] !== id)
    throw new WebhookVerificationError('id_mismatch', 'the id of the body differs from X-Webhook-Id');
  if (event['type'] !== type) {
    throw new WebhookVerificationError('type_mismatch', 'the type of the body differs from X-Webhook-Event');
  }
  if (event['version'] !== 1) {
    throw new WebhookVerificationError(
      'unsupported_version',
      `body format version ${String(event['version'])} is not supported by this SDK: store the raw body and update the SDK`,
    );
  }
  if (input.expectedMerchantId !== undefined && event['merchantId'] !== input.expectedMerchantId) {
    throw new WebhookVerificationError('merchant_mismatch', 'the webhook is for another merchant');
  }
  if (input.net !== undefined && (event['chain'] === 'mainnet') !== (input.net === 'mainnet')) {
    throw new WebhookVerificationError(
      'chain_mismatch',
      `a ${event['chain']} webhook came to a ${input.net} handler: check the webhook URL of each network`,
    );
  }
  // 13.3: `aml: null` reads as `aml.status: null`
  const payment = (data as Json)['payment'];
  if (payment !== null && typeof payment === 'object' && (payment as Json)['aml'] === null) {
    (payment as Json)['aml'] = { status: null };
  }
  return parsed as WebhookEvent;
}
