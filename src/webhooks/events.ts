// Bodies of the webhooks webhook-service sends (webhook-service docs/13-merchant-webhooks.md, 13.3–13.4), format
// version 1. The OpenAPI of gateway has no schemas for them, so they are written from the spec.
import type {
  AmlStatus,
  DecimalString,
  DepositStatus,
  Invoice,
  IsoDateTime,
  PaymentDropReason,
  PaymentResult,
  RawAmountString,
  Uuid,
} from '../types';

/** Webhook types that carry the payment that caused them. */
export type InvoicePaymentEventType =
  | 'invoice.payment_detected'
  | 'invoice.payment_dropped'
  | 'invoice.payment_held'
  | 'invoice.underpaid'
  | 'invoice.paid'
  | 'invoice.overpaid'
  | 'invoice.late_payment'
  | 'invoice.wrong_asset_payment';

/** Webhook types not caused by a payment: `data.payment` is `null`. */
export type InvoiceStateEventType = 'invoice.expired' | 'invoice.expired_partial' | 'invoice.cancelled';

/** The 11 invoice webhook types. */
export type InvoiceEventType = InvoicePaymentEventType | InvoiceStateEventType;

/** The payment of the buyer that caused a webhook, as the network shows it. */
export interface WebhookPayment {
  /** Id of the deposit; may change after a restore of the platform: identify a payment by `(network, txHash, eventIndex)`. */
  depositId: Uuid;
  network: string;
  txHash: string;
  /** Number of the transfer inside the transaction, from 0. */
  eventIndex: number;
  /** Actual asset of the payment; differs from `invoice.asset` at `wrong_asset`. */
  asset: string;
  decimals: number;
  /** The whole transfer of the buyer. */
  amount: DecimalString;
  amountRaw: RawAmountString;
  /** Sender; may be an exchange address — ask the buyer for a refund address. */
  fromAddress: string;
  blockNumber: number;
  blockTimestamp: IsoDateTime;
  /** `detected` — seen, not confirmed; `confirmed` — final; `dropped` — will not confirm. */
  depositStatus: DepositStatus;
  /** `in_time` — in the window; `after_final` — in the pause after payment; `late`; `wrong_asset`. */
  matchKind: 'in_time' | 'after_final' | 'late' | 'wrong_asset';
  result: PaymentResult | null;
  /** Part that closed the invoice amount; `"0"` at `late` and `wrong_asset`. */
  applied: DecimalString;
  overpaid: DecimalString;
  /** AML check; `status: null` until the payment is confirmed. `flags` only when the platform discloses them. */
  aml: { status: AmlStatus | null; flags?: string[] };
  /** The payment extended the invoice window. */
  extended: boolean;
  dropReason: PaymentDropReason | null;
}

/** Fields every webhook body has. */
export interface WebhookEnvelope<T extends string> {
  /** Id of the notification, equals `X-Webhook-Id`: the same in every retry. Deduplicate by it. */
  id: Uuid;
  type: T;
  /** Body format version; the SDK accepts `1`. */
  version: 1;
  /** Time of the change of the invoice (not of the sending): apply a snapshot only if it is newer than the last one. */
  occurredAt: IsoDateTime;
  network: string;
  /** `mainnet` is real money. */
  chain: string;
  merchantId: Uuid;
}

/** A webhook caused by a payment: the invoice snapshot after the change and the payment. */
export interface InvoicePaymentWebhookEvent extends WebhookEnvelope<InvoicePaymentEventType> {
  data: { invoice: Invoice; payment: WebhookPayment };
}

/** A webhook not caused by a payment: expiry or cancellation. */
export interface InvoiceStateWebhookEvent extends WebhookEnvelope<InvoiceStateEventType> {
  data: { invoice: Invoice; payment: null };
}

/** `webhook.test` — sent by `psp.webhook.sendTest()` or the cabinet. No business action. */
export interface TestWebhookEvent extends WebhookEnvelope<'webhook.test'> {
  data: { test: true; message: string };
}

/**
 * A verified webhook. Narrow it by `type`:
 * ```ts
 * if (event.type === 'invoice.paid' || event.type === 'invoice.overpaid') ship(event.data.invoice.externalId);
 * ```
 * Ship an order only on `invoice.paid` and `invoice.overpaid`. New types may appear: answer `2xx` and skip them.
 */
export type WebhookEvent = InvoicePaymentWebhookEvent | InvoiceStateWebhookEvent | TestWebhookEvent;
