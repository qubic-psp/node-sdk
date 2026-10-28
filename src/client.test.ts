import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KEY, SECRET, startFakeGateway, type FakeGateway, type RecordedRequest } from '../test/fake-gateway';
import { PspClient } from './client';
import { getResponseMeta } from './transport';

let gw: FakeGateway;
let psp: PspClient;

beforeEach(async () => {
  gw = await startFakeGateway();
  psp = new PspClient({ apiKey: KEY, apiSecret: SECRET, baseUrl: gw.url, retryBaseDelayMs: 1 });
});
afterEach(async () => {
  await gw.close();
});

const last = (): RecordedRequest => {
  const req = gw.requests.at(-1);
  if (!req) throw new Error('no request');
  expect(req.signatureValid).toBe(true);
  return req;
};

describe('the 13 operations', () => {
  it('account.get', async () => {
    gw.queue.push({ json: { merchantId: 'm', serverTime: 1 } });
    expect(await psp.account.get()).toMatchObject({ merchantId: 'm' });
    expect(last()).toMatchObject({ method: 'GET', target: '/api/v1/account', body: '' });
  });

  it('invoices.create sends the params as the body; meta tells 201 from 200', async () => {
    gw.queue.push({ status: 201, json: { id: 'i1' } }, { status: 200, json: { id: 'i1' } });
    const params = { externalId: 'order-10530', network: 'tron', asset: 'USDT', amount: '50', metadata: { a: 1 } };
    const created = await psp.invoices.create(params);
    expect(last()).toMatchObject({ method: 'POST', target: '/api/v1/invoices', body: JSON.stringify(params) });
    expect(getResponseMeta(created)?.status).toBe(201);
    expect(getResponseMeta(await psp.invoices.create(params))?.status).toBe(200);
  });

  it('invoices.list builds the query in the order of the params, dates as ISO, lists with a comma', async () => {
    gw.queue.push({ json: { items: [], page: 2, limit: 10, total: 0 } });
    await psp.invoices.list({
      status: ['active', 'partially_paid'],
      from: new Date(Date.UTC(2026, 9, 1)),
      to: '2026-10-28T00:00:00.000Z',
      network: 'tron',
      page: 2,
      limit: 10,
    });
    expect(last().target).toBe(
      '/api/v1/invoices?status=active,partially_paid&from=2026-10-01T00%3A00%3A00.000Z' +
        '&to=2026-10-28T00%3A00%3A00.000Z&network=tron&page=2&limit=10',
    );
  });

  it('invoices.get, listEvents, cancel', async () => {
    await psp.invoices.get('97da92f5-45c0-411b-9ed5-6793b396cd5f');
    expect(last()).toMatchObject({ method: 'GET', target: '/api/v1/invoices/97da92f5-45c0-411b-9ed5-6793b396cd5f' });

    gw.queue.push({ json: { items: [], page: 1, limit: 5, total: 0 } });
    await psp.invoices.listEvents('inv', { limit: 5 });
    expect(last().target).toBe('/api/v1/invoices/inv/events?limit=5');

    await psp.invoices.cancel('inv');
    expect(last()).toMatchObject({ method: 'POST', target: '/api/v1/invoices/inv/cancel', body: '' });
    await psp.invoices.cancel('inv', { reason: 'Покупатель передумал' });
    expect(last().body).toBe(JSON.stringify({ reason: 'Покупатель передумал' }));
  });

  it('webhook settings: get, setUrl, removeUrl, sendTest', async () => {
    await psp.webhook.get();
    expect(last()).toMatchObject({ method: 'GET', target: '/api/v1/webhook' });
    await psp.webhook.setUrl('https://shop.example/psp/webhook');
    expect(last()).toMatchObject({ method: 'PUT', body: '{"url":"https://shop.example/psp/webhook"}' });
    await psp.webhook.removeUrl();
    expect(last()).toMatchObject({ method: 'DELETE', target: '/api/v1/webhook', body: '' });
    await psp.webhook.sendTest();
    expect(last()).toMatchObject({ method: 'POST', target: '/api/v1/webhook/test', body: '' });
    await psp.webhook.sendTest({ message: 'Hello' });
    expect(last().body).toBe('{"message":"Hello"}');
  });

  it('webhook deliveries: list, get, redeliver', async () => {
    gw.queue.push({ json: { items: [], page: 1, limit: 50, total: 0 } });
    await psp.webhook.deliveries.list({
      status: 'failed',
      kind: 'notification',
      type: ['invoice.paid', 'invoice.overpaid'],
    });
    expect(last().target).toBe(
      '/api/v1/webhook/deliveries?status=failed&kind=notification&type=invoice.paid,invoice.overpaid',
    );
    await psp.webhook.deliveries.get('d1');
    expect(last()).toMatchObject({ method: 'GET', target: '/api/v1/webhook/deliveries/d1' });
    await psp.webhook.deliveries.redeliver('d1');
    expect(last()).toMatchObject({ method: 'POST', target: '/api/v1/webhook/deliveries/d1/redeliver', body: '' });
  });
});

describe('listAll', () => {
  const pageOf = (page: number, ids: string[], total: number) => ({
    json: { items: ids.map((id) => ({ id })), page, limit: 2, total },
  });

  it('walks every page and stops at total', async () => {
    gw.queue.push(pageOf(1, ['a', 'b'], 5), pageOf(2, ['c', 'd'], 5), pageOf(3, ['e'], 5));
    const ids: string[] = [];
    for await (const invoice of psp.invoices.listAll({ status: 'active', limit: 2 })) ids.push(invoice.id);
    expect(ids).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(gw.requests.map((r) => r.target)).toEqual([
      '/api/v1/invoices?status=active&limit=2&page=1',
      '/api/v1/invoices?status=active&limit=2&page=2',
      '/api/v1/invoices?status=active&limit=2&page=3',
    ]);
  });

  it('skips an item that moved to the next page because a new one was added on top', async () => {
    gw.queue.push(pageOf(1, ['b', 'a'], 3), pageOf(2, ['a', 'z'], 4));
    const ids: string[] = [];
    for await (const invoice of psp.invoices.listAll({ limit: 2 })) ids.push(invoice.id);
    expect(ids).toEqual(['b', 'a', 'z']);
  });

  it('uses 100 per page by default and stops on an empty page', async () => {
    gw.queue.push({ json: { items: [], page: 1, limit: 100, total: 7 } });
    const ids: string[] = [];
    for await (const event of psp.invoices.listAllEvents('inv')) ids.push(event.id);
    expect(ids).toEqual([]);
    expect(last().target).toBe('/api/v1/invoices/inv/events?limit=100&page=1');
  });

  it('deliveries.listAll works the same way', async () => {
    gw.queue.push(pageOf(1, ['d1'], 1));
    const ids: string[] = [];
    for await (const delivery of psp.webhook.deliveries.listAll({ kind: 'test' })) ids.push(delivery.id);
    expect(ids).toEqual(['d1']);
  });
});

describe('the client itself', () => {
  it('knows the network of the key', () => {
    expect(psp.net).toBe('testnet');
    expect(psp.isLive).toBe(false);
    expect(psp.apiKey).toBe(KEY);
  });

  it('never shows the secret', () => {
    expect(JSON.stringify(psp)).not.toContain(SECRET);
    expect(inspect(psp, { depth: 10, showHidden: true })).not.toContain(SECRET);
    expect(inspect(psp)).toContain(KEY);
  });
});
