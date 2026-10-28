// The hand-written public types match the OpenAPI schemas of gateway (src/generated/schema.d.ts, `yarn api:sync`).
// After a sync, a changed field of the spec shows up here as a type error.
import { describe, expectTypeOf, it } from 'vitest';
import type { components, operations } from './generated/schema';
import type {
  Account,
  CancelInvoiceParams,
  CreateInvoiceParams,
  Delivery,
  DeliveryAttempt,
  DeliveryWithAttempts,
  Invoice,
  InvoiceEvent,
  InvoicePayment,
  InvoiceWithPayments,
  ListDeliveriesParams,
  ListInvoicesParams,
  Page,
  SendTestWebhookParams,
  WebhookEventType,
  WebhookSettings,
} from './types';
import type { InvoiceEventType } from './webhooks/events';

type Schemas = components['schemas'];

/** `true` when A and B are assignable both ways and have the same keys. */
type Same<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? [keyof A] extends [keyof B]
      ? [keyof B] extends [keyof A]
        ? true
        : false
      : false
    : false
  : false;

type Json<T extends keyof operations, S extends number> =
  operations[T]['responses'] extends Record<S, { content: { 'application/json': infer R } }> ? R : never;

type Query<T extends keyof operations> = NonNullable<operations[T]['parameters']['query']>;
type Body<T extends keyof operations> =
  NonNullable<operations[T]['requestBody']> extends { content: { 'application/json': infer B } } ? B : never;

describe('the Same check itself', () => {
  it('sees a missing, an extra and a narrowed field', () => {
    expectTypeOf<Same<Omit<Invoice, 'memo'>, Schemas['V1Invoice']>>().toEqualTypeOf<false>();
    expectTypeOf<Same<Invoice & { extra?: string }, Schemas['V1Invoice']>>().toEqualTypeOf<false>();
    expectTypeOf<Same<Omit<Invoice, 'memo'> & { memo: string }, Schemas['V1Invoice']>>().toEqualTypeOf<false>();
  });
});

describe('responses', () => {
  it('account', () => {
    expectTypeOf<Same<Account, Schemas['AccountResponse']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Account['apiKey'], Schemas['AccountApiKey']>>().toEqualTypeOf<true>();
  });

  it('invoices', () => {
    expectTypeOf<Same<Invoice, Schemas['V1Invoice']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<InvoicePayment, Schemas['V1InvoicePayment']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<InvoiceWithPayments, Schemas['V1InvoiceWithPayments']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<InvoiceEvent, Schemas['V1InvoiceEvent']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Page<Invoice>, Json<'listInvoices', 200>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Page<InvoiceEvent>, Json<'listInvoiceEvents', 200>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Invoice, Json<'createInvoice', 201>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Invoice, Json<'cancelInvoice', 200>>>().toEqualTypeOf<true>();
  });

  it('webhook settings and deliveries', () => {
    expectTypeOf<Same<WebhookSettings, Schemas['GatewayWebhookSettings']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<WebhookSettings, Json<'setWebhookUrl', 202>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Delivery, Schemas['V1Delivery']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<DeliveryAttempt, Schemas['V1DeliveryAttempt']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<DeliveryWithAttempts, Schemas['V1DeliveryFull']>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Page<Delivery>, Json<'listDeliveries', 200>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<DeliveryWithAttempts, Json<'sendTestWebhook', 201>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<Delivery, Json<'redeliverDelivery', 200>>>().toEqualTypeOf<true>();
  });
});

describe('webhook types', () => {
  it('the 11 invoice events and webhook.test are the delivery types of the spec', () => {
    expectTypeOf<InvoiceEventType | 'webhook.test'>().toEqualTypeOf<WebhookEventType>();
    expectTypeOf<WebhookEventType>().toEqualTypeOf<Schemas['V1Delivery']['type']>();
  });
});

describe('request bodies', () => {
  it('match the spec exactly', () => {
    expectTypeOf<Same<CreateInvoiceParams, Body<'createInvoice'>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<CancelInvoiceParams, Body<'cancelInvoice'>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<SendTestWebhookParams, Body<'sendTestWebhook'>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<{ url: string }, Body<'setWebhookUrl'>>>().toEqualTypeOf<true>();
  });
});

describe('query parameters', () => {
  it('have the keys of the spec; values accept what the spec accepts', () => {
    expectTypeOf<Same<keyof ListInvoicesParams, keyof Query<'listInvoices'>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<keyof ListDeliveriesParams, keyof Query<'listDeliveries'>>>().toEqualTypeOf<true>();
    expectTypeOf<Same<'page' | 'limit', keyof Query<'listInvoiceEvents'>>>().toEqualTypeOf<true>();
    expectTypeOf<Query<'listInvoices'>>().toExtend<ListInvoicesParams>();
    expectTypeOf<Query<'listDeliveries'>>().toExtend<ListDeliveriesParams>();
  });
});
