// The public API as a merchant sees it through the package entry: signatures, narrowing of errors and events.
import { describe, expectTypeOf, it } from 'vitest';
import {
  PspClient,
  isPspApiError,
  verifyWebhook,
  type DeliveryWithAttempts,
  type Invoice,
  type InvoiceWithPayments,
  type Page,
  type WebhookEvent,
  type WebhookSettings,
} from '../../src/index';

declare const psp: PspClient;

describe('public API', () => {
  it('methods return the documented types', () => {
    expectTypeOf(psp.invoices.create).returns.toEqualTypeOf<Promise<Invoice>>();
    expectTypeOf(psp.invoices.get).returns.toEqualTypeOf<Promise<InvoiceWithPayments>>();
    expectTypeOf(psp.invoices.list).returns.toEqualTypeOf<Promise<Page<Invoice>>>();
    expectTypeOf(psp.invoices.listAll).returns.toEqualTypeOf<AsyncGenerator<Invoice, void>>();
    expectTypeOf(psp.webhook.setUrl).returns.toEqualTypeOf<Promise<WebhookSettings>>();
    expectTypeOf(psp.webhook.sendTest).returns.toEqualTypeOf<Promise<DeliveryWithAttempts>>();
    expectTypeOf(psp.webhook.verify).returns.toEqualTypeOf<WebhookEvent>();
    expectTypeOf(verifyWebhook).returns.toEqualTypeOf<WebhookEvent>();
  });

  it('create takes decimal strings only, list takes typed statuses', () => {
    expectTypeOf(psp.invoices.create).parameter(0).toEqualTypeOf<{
      externalId: string;
      network: string;
      asset: string;
      amount: string;
      description?: string;
      metadata?: Record<string, unknown>;
    }>();
    // @ts-expect-error a JSON number is not an amount
    void psp.invoices.create({ externalId: 'o', network: 'tron', asset: 'USDT', amount: 50 });
    // @ts-expect-error unknown status
    void psp.invoices.list({ status: 'unpaid' });
  });

  it('isPspApiError narrows details by the code', () => {
    const err: unknown = null;
    if (isPspApiError(err, 'amount_out_of_range')) {
      expectTypeOf(err.details.min).toEqualTypeOf<string>();
      expectTypeOf(err.details.max).toEqualTypeOf<string | null>();
    }
    if (isPspApiError(err) && err.is('invoice_conflict')) {
      expectTypeOf(err.details.invoiceId).toEqualTypeOf<string>();
    }
  });
});
