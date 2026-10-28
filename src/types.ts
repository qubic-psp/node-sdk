// Public data types of the merchant API (`/api/v1`). Written by hand for readable docs; src/types.test-d.ts checks
// that they match the OpenAPI schemas of gateway (src/generated/schema.d.ts, `yarn api:sync`).

/** Decimal amount in units of the asset, as a string: `"50"`, `"0.5"`, `"0"`. Never a JSON number. */
export type DecimalString = string;

/** Integer amount in minimal units of the asset, as a string: `"50000000"` for 50 USDT with 6 decimals. */
export type RawAmountString = string;

/** ISO 8601 date-time in UTC with milliseconds: `"2026-09-29T12:00:00.000Z"`. */
export type IsoDateTime = string;

/** Lower-case UUID. */
export type Uuid = string;

/** One page of a list: `items` of page `page` (from 1), `limit` items per page, `total` items in the whole list. */
export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

// ---------------------------------------------------------------- account

/** The API key that signed the request. */
export interface AccountApiKey {
  /** `X-Api-Key` of this request, `psp_pk_…`. */
  keyId: string;
  /** `previous` — the request is signed with the previous key after a secret rotation: switch to the new one. */
  status: 'current' | 'previous';
  /** Until when the previous key works; `null` for the current key. */
  graceUntil: IsoDateTime | null;
}

/** The merchant behind the API key (`GET /api/v1/account`). */
export interface Account {
  merchantId: Uuid;
  name: string;
  /** A closed merchant gets no answer at all (`403 merchant_closed`). */
  status: 'active' | 'blocked';
  /** The merchant may create invoices. */
  invoicesEnabled: boolean;
  /** The merchant may request payouts (in the merchant cabinet). */
  payoutsEnabled: boolean;
  apiKey: AccountApiKey;
  /** Server time, Unix seconds: compare with your clock, the signature window is ±300 s. */
  serverTime: number;
}

// ---------------------------------------------------------------- invoices

/**
 * Status of an invoice.
 * - `active` — waiting for the payment;
 * - `partially_paid` — less than `amount` received, the window is still open;
 * - `paid` — the whole amount received: ship the order;
 * - `overpaid` — more than `amount` received: ship the order, the excess is in `overpaid`;
 * - `expired` — the window closed without payments;
 * - `expired_partial` — the window closed with an underpayment (`underpaid`);
 * - `cancelled` — cancelled by the merchant or an admin (`statusReason`).
 */
export type InvoiceStatus =
  'active' | 'partially_paid' | 'paid' | 'overpaid' | 'expired' | 'expired_partial' | 'cancelled';

/** Who cancelled the invoice. */
export type InvoiceStatusReason = 'cancelled_by_merchant' | 'cancelled_by_admin';

/** An invoice: the amount the buyer pays to `address` before `expiresAt`. */
export interface Invoice {
  id: Uuid;
  merchantId: Uuid;
  /** Your order id; unique among your invoices. */
  externalId: string;
  /** Network code, e.g. `tron`, `base`, `polygon`. */
  network: string;
  /** Chain of the network: `mainnet` is real money; testnets are e.g. `nile`, `base-sepolia`, `polygon-amoy`. */
  chain: string;
  /** Asset to pay, e.g. `USDT`. A payment in another asset does not close the invoice. */
  asset: string;
  /** Currency of the asset. */
  currency: string;
  /** Decimals of the asset. */
  decimals: number;
  /** Payment address: show it to the buyer together with `amount`, `asset`, the network and `expiresAt`. */
  address: string;
  /** Memo of memo networks; `null` in TRON and EVM networks. */
  memo: string | null;
  /** Amount to pay. */
  amount: DecimalString;
  /** Amount to pay in minimal units. */
  amountRaw: RawAmountString;
  /** Paid in the window and in the pause after payment, overpayment included. */
  received: DecimalString;
  /** Seen in the network, not confirmed yet: not money yet. */
  pending: DecimalString;
  /** Confirmed but held by the AML check; not in `received`. */
  held: DecimalString;
  /** `max(amount − received, 0)`. */
  remaining: DecimalString;
  /** Received above `amount`. */
  overpaid: DecimalString;
  /** Shortfall, fixed at `expired_partial`; `"0"` before. */
  underpaid: DecimalString;
  /** Paid by late payments after the window closed. */
  lateReceived: DecimalString;
  status: InvoiceStatus;
  statusReason: InvoiceStatusReason | null;
  /** Times an underpayment extended the window. */
  extendedCount: number;
  /** Limit of such extensions for this invoice. */
  maxUnderpaymentResets: number;
  /** The address was issued: the window starts. */
  createdAt: IsoDateTime;
  /** End of the payment window. */
  expiresAt: IsoDateTime;
  /** Block time of the payment that completed the amount. */
  paidAt: IsoDateTime | null;
  /** Transition to a final status. */
  closedAt: IsoDateTime | null;
  cancelledAt: IsoDateTime | null;
  /** Your description. */
  description: string | null;
  /** Your data, returned as given. */
  metadata: Record<string, unknown> | null;
  /** Every payment with a block time not later than this is already counted. */
  paymentsCheckedUntil: IsoDateTime | null;
  /** Monitoring of the network is late: new payments may show up later than usual. */
  monitoringDelayed: boolean;
}

/** State of a deposit in the network. */
export type DepositStatus = 'detected' | 'confirmed' | 'dropped';

/**
 * How a payment is matched to the invoice: `in_time` — in the window; `after_final` — in the pause after payment;
 * `late` — after the window closed; `wrong_asset` — another asset to the invoice address; other values are payments
 * the platform could not attribute to the invoice amount.
 */
export type PaymentMatchKind =
  | 'in_time'
  | 'after_final'
  | 'late'
  | 'wrong_asset'
  | 'orphan'
  | 'unknown_address'
  | 'dust'
  | 'wrong_network'
  | 'unattributed_native';

/** Result of a payment matched in time: `exact`, `underpaid` or `overpaid`. */
export type PaymentResult = 'exact' | 'underpaid' | 'overpaid';

/** Why a deposit was dropped. */
export type PaymentDropReason = 'fork' | 'tx_failed';

/** Credit of the deposit to the merchant balance. */
export type PaymentCreditStatus =
  'none' | 'paused' | 'aml_wait' | 'aml_hold' | 'credited' | 'unallocated' | 'dust' | 'aml_dirty' | 'income';

/** Result of the AML check; `null` — not checked yet. */
export type AmlStatus = 'pending' | 'clean' | 'review' | 'blocked' | 'unchecked';

/** A payment of the buyer to the invoice address, as the API returns it. */
export interface InvoicePayment {
  depositId: Uuid;
  network: string;
  /** Transaction hash: 64 hex without `0x` in TRON, `0x…` in EVM networks. */
  txHash: string;
  /** Number of the transfer in the transaction. A payment is identified by `(network, txHash, eventIndex)`. */
  eventIndex: number;
  /** Actual asset of the payment: differs from the invoice asset at `wrong_asset`. */
  asset: string;
  decimals: number;
  /** The whole transfer, in units of the asset of the payment. */
  amount: DecimalString;
  amountRaw: RawAmountString;
  fromAddress: string;
  blockNumber: number;
  /** Block time: the payment belongs to the invoice window by it. */
  blockTimestamp: IsoDateTime;
  depositStatus: DepositStatus;
  matchKind: PaymentMatchKind;
  /** For `in_time` and `after_final` after crediting; otherwise `null`. */
  result: PaymentResult | null;
  /** Part that closed the invoice amount; `"0"` at `late` and `wrong_asset`. */
  applied: DecimalString;
  /** Part above the invoice amount. */
  overpaid: DecimalString;
  /** The payment extended the invoice window. */
  extended: boolean;
  /** Set at `dropped`; otherwise `null`. */
  dropReason: PaymentDropReason | null;
  creditStatus: PaymentCreditStatus;
  aml: { status: AmlStatus | null };
}

/** An invoice with all its payments (`GET /api/v1/invoices/{invoiceId}`). */
export interface InvoiceWithPayments extends Invoice {
  payments: InvoicePayment[];
}

/** A change in the history of an invoice (`GET /api/v1/invoices/{invoiceId}/events`). */
export interface InvoiceEvent {
  id: Uuid;
  /** Type of the change, `invoice.*`. */
  type: string;
  statusFrom: InvoiceStatus | null;
  statusTo: InvoiceStatus | null;
  occurredAt: IsoDateTime;
  /** The invoice and the payment of the change. */
  payload: Record<string, unknown>;
}

/** Body of `POST /api/v1/invoices`. */
export interface CreateInvoiceParams {
  /**
   * Your order id, 1–128 characters. Choose it before the first attempt and store it with the order: a retry with
   * the same `externalId` and the same fields returns the invoice created before instead of a duplicate.
   */
  externalId: string;
  /** Network code, e.g. `tron`. */
  network: string;
  /** Asset code, e.g. `USDT`. */
  asset: string;
  /** Amount to pay, a decimal string: `"50"`, `"12.5"`. */
  amount: DecimalString;
  /** Up to 255 characters. */
  description?: string;
  /** Any JSON object; returned in the invoice and in webhooks. */
  metadata?: Record<string, unknown>;
}

/** A time filter: a `Date` or an ISO 8601 string. `from` is inclusive, `to` is exclusive. */
export type DateFilter = Date | IsoDateTime;

/** Page of a list: `page` from 1 (default 1), `limit` 1–100 (default 50). */
export interface PageParams {
  page?: number;
  limit?: number;
}

/** Filters of `GET /api/v1/invoices`; the list is sorted newest first. */
export interface ListInvoicesParams extends PageParams {
  from?: DateFilter;
  to?: DateFilter;
  externalId?: string;
  status?: InvoiceStatus | readonly InvoiceStatus[];
  network?: string;
  asset?: string;
}

/** Body of `POST /api/v1/invoices/{invoiceId}/cancel`. */
export interface CancelInvoiceParams {
  /** Up to 500 characters. */
  reason?: string;
}

// ---------------------------------------------------------------- webhook settings

/** First match of `paused`, `no_url`, `no_secret`, `secret_hold`, `active`. */
export type WebhookDeliveryState = 'active' | 'no_url' | 'no_secret' | 'secret_hold' | 'paused';

/** Deliveries waiting for a URL or a secret, and deliveries in the queue. */
export interface WebhookQueue {
  waiting: number;
  pending: number;
}

/** Whether the platform has applied the last URL change; `pending` after a `202` answer. */
export interface WebhookUrlSync {
  state: 'synced' | 'pending' | 'rejected';
  desiredUrl: string | null;
  rejectedReason: string | null;
  pendingSince: IsoDateTime | null;
}

/**
 * Webhook settings and delivery state (`GET`, `PUT`, `DELETE /api/v1/webhook`). Fields other than `sync` are `null`
 * while the delivery service is unreachable.
 */
export interface WebhookSettings {
  merchantId: Uuid | null;
  /** Callback URL; `null` — not set or removed. */
  webhookUrl: string | null;
  webhookUrlSetAt: IsoDateTime | null;
  /** The secret has reached the delivery service. */
  secretSet: boolean | null;
  secretSetAt: IsoDateTime | null;
  /** Webhooks wait until this time after a secret change; in the past — the hold is over. */
  secretHoldUntil: IsoDateTime | null;
  /** Deliveries are paused by the platform. */
  paused: boolean | null;
  deliveryState: WebhookDeliveryState | null;
  /** Failed notification attempts in a row; any 2xx resets it. */
  consecutiveFailures: number | null;
  /** Since when your endpoint is failing. */
  failingSince: IsoDateTime | null;
  lastAttemptAt: IsoDateTime | null;
  lastSuccessAt: IsoDateTime | null;
  queue: WebhookQueue | null;
  sync: WebhookUrlSync;
}

/** Body of `POST /api/v1/webhook/test`. */
export interface SendTestWebhookParams {
  /** 1–200 characters, default `"Test webhook from PSP"`. */
  message?: string;
}

// ---------------------------------------------------------------- deliveries

/** Type of a webhook body. */
export type WebhookEventType =
  | 'invoice.payment_detected'
  | 'invoice.payment_dropped'
  | 'invoice.payment_held'
  | 'invoice.underpaid'
  | 'invoice.paid'
  | 'invoice.overpaid'
  | 'invoice.expired'
  | 'invoice.expired_partial'
  | 'invoice.late_payment'
  | 'invoice.wrong_asset_payment'
  | 'invoice.cancelled'
  | 'webhook.test';

/** `notification` — a change of an invoice; `test` — `POST /api/v1/webhook/test`. */
export type DeliveryKind = 'notification' | 'test';

/** `waiting` — no URL or secret yet; `pending` — in the retry queue; final: `delivered`, `failed`, `expired`. */
export type DeliveryStatus = 'waiting' | 'pending' | 'delivered' | 'failed' | 'expired';

/** Error of a delivery attempt. */
export type DeliveryErrorCode =
  | 'timeout'
  | 'dns_failed'
  | 'blocked_address'
  | 'connect_failed'
  | 'tls_failed'
  | 'redirect'
  | 'http_error'
  | 'body_too_large'
  | 'lost';

/** A webhook delivery in the delivery log. */
export interface Delivery {
  /** Equals `X-Webhook-Id` and the `id` of the body. */
  id: Uuid;
  /** Order of arrival: deliveries of one invoice go by `seq`. */
  seq: number;
  kind: DeliveryKind;
  merchantId: Uuid;
  invoiceId: Uuid | null;
  type: WebhookEventType;
  /** Version of the body format. */
  version: number;
  network: string;
  chain: string;
  occurredAt: IsoDateTime;
  causationId: Uuid | null;
  /** SHA-256 of the body bytes. */
  bodySha256: string;
  status: DeliveryStatus;
  waitReason: 'no_url' | 'no_secret' | null;
  waitingSince: IsoDateTime | null;
  expiredReason: 'no_url' | 'no_secret' | 'paused' | null;
  /** Attempts in the current cycle. */
  attempts: number;
  /** Attempts of all cycles. */
  totalAttempts: number;
  /** 1 for the first cycle, +1 for every redelivery. */
  cycle: number;
  nextAttemptAt: IsoDateTime | null;
  lastAttemptAt: IsoDateTime | null;
  lastHttpStatus: number | null;
  lastErrorCode: DeliveryErrorCode | null;
  lastError: string | null;
  deliveredAt: IsoDateTime | null;
  failedAt: IsoDateTime | null;
  expiredAt: IsoDateTime | null;
  /** Manual redeliveries. */
  redeliveries: number;
  /** `system:webhook.requests` for a notification, `merchant` for a test webhook. */
  createdBy: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/**
 * Headers of a delivery attempt as they were sent to your endpoint (lower-case names). A type literal, so it can be
 * passed to `verifyWebhook({ headers })` as is.
 */
export type DeliveryRequestHeaders = {
  'content-type': string;
  'user-agent': string;
  'x-webhook-id': string;
  'x-webhook-event': string;
  'x-webhook-timestamp': string;
  'x-webhook-signature': string;
  'x-webhook-attempt': string;
};

/** One HTTP attempt of a delivery. */
export interface DeliveryAttempt {
  id: Uuid;
  deliveryId: Uuid;
  cycle: number;
  /** Number in the cycle from 1, equals `X-Webhook-Attempt`. */
  attemptNo: number;
  url: string;
  /** The address the platform connected to; `null` — no connection. */
  resolvedIp: string | null;
  status: 'in_flight' | 'succeeded' | 'failed' | 'lost';
  httpStatus: number | null;
  errorCode: DeliveryErrorCode | null;
  error: string | null;
  /** Headers of your answer, lower-case names; `null` — no answer. */
  responseHeaders: Record<string, string> | null;
  /** The first 4096 bytes of your answer; `null` — no answer. */
  responseBody: string | null;
  startedAt: IsoDateTime;
  finishedAt: IsoDateTime | null;
  durationMs: number | null;
  createdAt: IsoDateTime;
  requestHeaders: DeliveryRequestHeaders;
  /** Which secret signed the attempt; `null` — unknown. */
  signedWith: 'current' | 'previous' | null;
}

/** A delivery with its body and attempts (`GET /api/v1/webhook/deliveries/{deliveryId}`, the test webhook). */
export interface DeliveryWithAttempts extends Delivery {
  /** The body exactly as sent. */
  body: string;
  deliveryAttempts: DeliveryAttempt[];
}

/** Filters of `GET /api/v1/webhook/deliveries`; the list is sorted newest first. */
export interface ListDeliveriesParams extends PageParams {
  from?: DateFilter;
  to?: DateFilter;
  status?: DeliveryStatus | readonly DeliveryStatus[];
  kind?: DeliveryKind;
  type?: WebhookEventType | readonly WebhookEventType[];
  invoiceId?: Uuid;
}
