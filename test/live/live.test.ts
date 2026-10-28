// Live check against a real platform (testnet). Runs only with credentials of a test merchant:
//   PSP_E2E_API_URL=https://… PSP_E2E_API_KEY=psp_pk_test_… PSP_E2E_API_SECRET=psp_sk_test_… yarn test:live
// Optional: PSP_E2E_NETWORK (tron), PSP_E2E_ASSET (USDT), PSP_E2E_AMOUNT (10). The invoice it creates is cancelled.
// The test webhook is verified with the SDK over the body and the headers the platform recorded for the attempt.
import { beforeAll, describe, expect, it } from 'vitest';
import { PspClient, getResponseMeta, isPspApiError, verifyWebhook, type DeliveryWithAttempts } from '../../src/index';

const env = (name: string): string | undefined => process.env[name] || undefined;
const apiUrl = env('PSP_E2E_API_URL');
const apiKey = env('PSP_E2E_API_KEY');
const apiSecret = env('PSP_E2E_API_SECRET');
const enabled = apiUrl !== undefined && apiKey !== undefined && apiSecret !== undefined;

describe.skipIf(!enabled)('live testnet', () => {
  // Built in beforeAll: the body of a skipped describe still runs while the tests are collected
  let psp: PspClient;
  beforeAll(() => {
    psp = new PspClient({ apiKey, apiSecret, baseUrl: apiUrl, userAgent: 'psp-sdk-live-test' });
  });
  const externalId = `sdk-live-${Date.now()}`;
  let invoiceId = '';

  it('account: the key works, the network is testnet, the clock is within the window', async () => {
    expect(psp.isLive).toBe(false);
    const account = await psp.account.get();
    expect(account.apiKey.keyId).toBe(apiKey);
    expect(Math.abs(account.serverTime - Date.now() / 1000)).toBeLessThan(300);
    console.log(`merchant ${account.merchantId} (${account.status}), key ${account.apiKey.status}`);
  });

  it('invoices: create (201), the same again (200), get, list by externalId, history', async () => {
    const params = {
      externalId,
      network: env('PSP_E2E_NETWORK') ?? 'tron',
      asset: env('PSP_E2E_ASSET') ?? 'USDT',
      amount: env('PSP_E2E_AMOUNT') ?? '10',
      description: 'SDK live test',
      metadata: { source: 'node-sdk' },
    };
    const created = await psp.invoices.create(params, { clientRequestId: `${externalId}-1` });
    expect(getResponseMeta(created)?.status).toBe(201);
    invoiceId = created.id;
    console.log(`invoice ${created.id}: ${created.amount} ${created.asset} to ${created.address}`);

    const again = await psp.invoices.create(params);
    expect(getResponseMeta(again)?.status).toBe(200);
    expect(again.id).toBe(created.id);

    await expect(psp.invoices.create({ ...params, amount: '11' })).rejects.toSatisfy(
      (err) => isPspApiError(err, 'invoice_conflict') && err.details.invoiceId === created.id,
    );

    const full = await psp.invoices.get(created.id);
    expect(full.payments).toEqual([]);
    const page = await psp.invoices.list({ externalId, status: ['active'] });
    expect(page.items.map((i) => i.id)).toEqual([created.id]);
    const events = await psp.invoices.listEvents(created.id);
    expect(events.total).toBeGreaterThan(0);
  });

  it('invoices: cancel, and cancel again returns the same state', async () => {
    const cancelled = await psp.invoices.cancel(invoiceId, { reason: 'SDK live test' });
    expect(cancelled.status).toBe('cancelled');
    expect((await psp.invoices.cancel(invoiceId)).status).toBe('cancelled');
  });

  it('webhook: settings, a test webhook verified by the SDK, the delivery log', async () => {
    const settings = await psp.webhook.get();
    console.log(`webhook ${settings.webhookUrl ?? '(no URL)'}: ${settings.deliveryState ?? 'unknown'}`);
    if (settings.webhookUrl === null) {
      await expect(psp.webhook.sendTest()).rejects.toSatisfy((err) => isPspApiError(err, 'url_not_set'));
      return;
    }
    let delivery: DeliveryWithAttempts;
    try {
      delivery = await psp.webhook.sendTest({ message: 'SDK live test' });
    } catch (err) {
      if (isPspApiError(err, 'too_many_requests')) return; // a test webhook less than 10 s ago
      throw err;
    }
    const attempt = delivery.deliveryAttempts[0];
    expect(attempt).toBeDefined();
    if (!attempt) return;
    const event = verifyWebhook({
      body: delivery.body,
      headers: attempt.requestHeaders,
      secret: apiSecret ?? '',
      net: 'testnet',
      now: Number(attempt.requestHeaders['x-webhook-timestamp']),
    });
    expect(event.type).toBe('webhook.test');
    console.log(`test webhook ${event.id}: your endpoint answered ${String(attempt.httpStatus)}`);

    const log = await psp.webhook.deliveries.list({ kind: 'test', limit: 5 });
    expect(log.items.some((d) => d.id === delivery.id)).toBe(true);
  });
});
