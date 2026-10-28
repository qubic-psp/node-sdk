import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, KEY, SECRET, startFakeGateway, type FakeGateway } from '../test/fake-gateway';
import { resolveConfig, type PspClientOptions, type PspWarning } from './config';
import {
  PspApiError,
  PspAuthError,
  PspConnectionError,
  PspTimeoutError,
  PspUnexpectedResponseError,
  isPspApiError,
} from './errors';
import { getResponseMeta, Transport } from './transport';

let gw: FakeGateway;

beforeEach(async () => {
  gw = await startFakeGateway();
});
afterEach(async () => {
  await gw.close();
});

const transport = (options: PspClientOptions = {}): Transport =>
  new Transport(
    resolveConfig(
      { apiKey: KEY, apiSecret: SECRET, baseUrl: gw.url, retryBaseDelayMs: 1, onWarning: () => undefined, ...options },
      'psp-sdk-node/test',
    ),
  );

const rejection = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected a rejection');
};

describe('signed requests', () => {
  it('GET: the signed TARGET is the request-target that arrived, no body, no Content-Type', async () => {
    gw.queue.push({ json: { items: [], page: 1, limit: 20, total: 0 } });
    const page = await transport().call<object>('listInvoices', {
      query: { status: ['active', 'partially_paid'], limit: 20 },
    });
    const [req] = gw.requests;
    expect(req?.target).toBe('/api/v1/invoices?status=active,partially_paid&limit=20');
    expect(req?.signatureValid).toBe(true);
    expect(req?.headers['content-type']).toBeUndefined();
    expect(req?.headers['user-agent']).toBe('psp-sdk-node/test');
    expect(req?.headers['accept']).toBe('application/json');
    expect(getResponseMeta(page)).toMatchObject({ status: 200, requestId: 'req-1', attempts: 1 });
  });

  it('POST: the body bytes are signed and sent once serialized, X-Client-Request-Id goes along', async () => {
    gw.queue.push({ status: 201, json: { id: 'x' } });
    const body = { externalId: 'order-1', network: 'tron', asset: 'USDT', amount: '50', description: 'Заказ 1' };
    const invoice = await transport({ userAgent: 'shop/2.4' }).call<object>('createInvoice', {
      body,
      options: { clientRequestId: 'shop-req-1' },
    });
    const [req] = gw.requests;
    expect(req?.signatureValid).toBe(true);
    expect(req?.body).toBe(JSON.stringify(body));
    expect(req?.headers['content-type']).toBe('application/json');
    expect(req?.headers['x-client-request-id']).toBe('shop-req-1');
    expect(req?.headers['user-agent']).toBe('shop/2.4 psp-sdk-node/test');
    expect(getResponseMeta(invoice)).toMatchObject({ status: 201, clientRequestId: 'shop-req-1' });
  });

  it('path parameters are percent-encoded and required', async () => {
    await transport().call('getInvoice', { path: { invoiceId: 'a/b?c' } });
    expect(gw.requests[0]?.target).toBe('/api/v1/invoices/a%2Fb%3Fc');
    await expect(transport().call('getInvoice', { path: { invoiceId: '' } })).rejects.toThrow(TypeError);
  });

  it('refuses a dot id that the URL parser would drop from the path', async () => {
    await expect(transport().call('getInvoice', { path: { invoiceId: '.' } })).rejects.toThrow(/must be an id/);
    await expect(transport().call('getInvoice', { path: { invoiceId: '..' } })).rejects.toThrow(/must be an id/);
    expect(gw.requests).toHaveLength(0);
  });

  it('refuses broken per-call numbers instead of retrying forever', async () => {
    await expect(transport().call('getAccount', { options: { maxRetries: Number.NaN } })).rejects.toThrow(/maxRetries/);
    await expect(transport().call('getAccount', { options: { timeoutMs: 0 } })).rejects.toThrow(/timeoutMs/);
    await expect(transport().call('getAccount', { options: { timeoutMs: 2 ** 31 } })).rejects.toThrow(/timeoutMs/);
    expect(gw.requests).toHaveLength(0);
  });

  it('refuses a malformed clientRequestId before sending', async () => {
    await expect(transport().call('getAccount', { options: { clientRequestId: 'has space' } })).rejects.toThrow(
      /clientRequestId/,
    );
    expect(gw.requests).toHaveLength(0);
  });
});

describe('errors', () => {
  it('an API error carries the code, details, X-Request-Id; is() narrows details', async () => {
    gw.queue.push(apiError(409, 'invoice_conflict', { invoiceId: 'inv-1' }));
    const err = await rejection(transport().call('createInvoice', { body: { externalId: 'o' } }));
    expect(err).toBeInstanceOf(PspApiError);
    expect(gw.requests).toHaveLength(1);
    if (!isPspApiError(err, 'invoice_conflict')) throw new Error('wrong error');
    expect(err.details.invoiceId).toBe('inv-1');
    expect(err.status).toBe(409);
    expect(err.requestId).toBe('req-1');
    expect(err.message).toContain('POST /api/v1/invoices: 409 invoice_conflict');
    expect(err.context).toMatchObject({ operationId: 'createInvoice', attempts: 1 });
  });

  it('401 bad_signature: PspAuthError with both strings and the line where they differ, no retry', async () => {
    gw.fallback = (req) =>
      apiError(401, 'api_auth_failed', {
        reason: 'bad_signature',
        stringToSign: req.stringToSign.replace('/api/v1/account', '/api/v1/account/'),
      });
    const err = await rejection(transport().call('getAccount'));
    expect(err).toBeInstanceOf(PspAuthError);
    const auth = err as PspAuthError;
    expect(auth.reason).toBe('bad_signature');
    expect(auth.localStringToSign).toBe(gw.requests[0]?.stringToSign);
    expect(auth.serverStringToSign).not.toBe(auth.localStringToSign);
    expect(auth.message).toContain('differ at line 3');
    expect(gw.requests).toHaveLength(1);
  });

  it('401 bad_signature with equal strings points at the secret', async () => {
    gw.fallback = (req) =>
      apiError(401, 'api_auth_failed', { reason: 'bad_signature', stringToSign: req.stringToSign });
    const err = (await rejection(transport().call('getAccount'))) as PspAuthError;
    expect(err.message).toContain('check apiSecret');
  });

  it('401 timestamp_out_of_window: one retry with a fresh signature, then the clock skew', async () => {
    gw.fallback = (req) =>
      apiError(401, 'api_auth_failed', {
        reason: 'timestamp_out_of_window',
        serverTime: Number(req.headers['x-api-timestamp']) + 400,
      });
    const err = (await rejection(transport().call('getAccount'))) as PspAuthError;
    expect(gw.requests).toHaveLength(2);
    expect(err.clockSkewSeconds).toBe(400);
    expect(err.message).toContain('by 400 s');
  });

  it('a redirect is not followed', async () => {
    gw.queue.push({ status: 302, headers: { Location: 'https://elsewhere.example/' } });
    const err = await rejection(transport().call('getAccount'));
    expect(err).toBeInstanceOf(PspUnexpectedResponseError);
    expect((err as Error).message).toContain('https://elsewhere.example/');
    expect(gw.requests).toHaveLength(1);
  });

  it('an HTML page of a proxy is an unexpected answer; 502 of a GET is retried', async () => {
    gw.fallback = () => ({ status: 502, raw: '<html>Bad Gateway</html>' });
    const err = await rejection(transport({ maxRetries: 2 }).call('getAccount'));
    expect(err).toBeInstanceOf(PspUnexpectedResponseError);
    expect((err as PspUnexpectedResponseError).body).toContain('Bad Gateway');
    expect(gw.requests).toHaveLength(3);
  });
});

describe('retries (gateway 13.10)', () => {
  it('503 service_unavailable, then success: every attempt has a new nonce and a valid signature', async () => {
    gw.queue.push(apiError(503, 'service_unavailable'), apiError(503, 'service_unavailable', { outcome: 'unknown' }));
    const onRetry = vi.fn();
    const account = await transport({ onRetry }).call<object>('getAccount');
    expect(gw.requests).toHaveLength(3);
    expect(gw.requests.every((r) => r.signatureValid && !r.nonceReused)).toBe(true);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(getResponseMeta(account)?.attempts).toBe(3);
  });

  it('gives up after maxRetries and throws the last error', async () => {
    gw.fallback = () => apiError(503, 'service_unavailable');
    await expect(transport({ maxRetries: 2 }).call('getAccount')).rejects.toMatchObject({
      errorCode: 'service_unavailable',
      context: { attempts: 3 },
    });
  });

  it('createInvoice is repeated on address_pool_unavailable with the same body', async () => {
    gw.queue.push(apiError(503, 'address_pool_unavailable', { network: 'tron' }));
    await transport().call('createInvoice', { body: { externalId: 'o-1' } });
    expect(gw.requests.map((r) => r.body)).toEqual([
      JSON.stringify({ externalId: 'o-1' }),
      JSON.stringify({ externalId: 'o-1' }),
    ]);
  });

  it('400, 403, 404 and 409 are never retried', async () => {
    for (const reply of [
      apiError(400, 'invalid_schema', { fields: [] }),
      apiError(403, 'ip_not_allowed', { ip: '192.0.2.1' }),
      apiError(404, 'not_found', { object: 'invoice', id: 'x' }),
      apiError(409, 'invalid_state', { object: 'invoice', id: 'x', status: 'paid', allowed: ['active'] }),
    ]) {
      gw.requests.length = 0;
      gw.queue.push(reply);
      await expect(transport().call('getAccount')).rejects.toBeInstanceOf(PspApiError);
      expect(gw.requests).toHaveLength(1);
    }
  });

  it('500 internal_error is retried once', async () => {
    gw.fallback = () => apiError(500, 'internal_error');
    await expect(transport().call('getAccount')).rejects.toMatchObject({ errorCode: 'internal_error' });
    expect(gw.requests).toHaveLength(2);
  });

  it('429 waits Retry-After when it is short; a long one is thrown with retryAfterSeconds', async () => {
    gw.queue.push(
      apiError(
        429,
        'too_many_requests',
        { scope: 'api_auth', limit: 100, retryAfterSeconds: 0 },
        { 'Retry-After': '0' },
      ),
    );
    await transport().call('getAccount');
    expect(gw.requests).toHaveLength(2);

    gw.requests.length = 0;
    gw.queue.push(
      apiError(
        429,
        'too_many_requests',
        { scope: 'api_auth', limit: 100, retryAfterSeconds: 41 },
        { 'Retry-After': '41' },
      ),
    );
    const err = (await rejection(transport().call('getAccount'))) as PspApiError;
    expect(err.retryAfterSeconds).toBe(41);
    expect(gw.requests).toHaveLength(1);
  });

  it('503 maintenance with Retry-After 300 is thrown at once', async () => {
    gw.queue.push(apiError(503, 'maintenance', { message: 'works' }, { 'Retry-After': '300' }));
    const err = (await rejection(transport().call('getAccount'))) as PspApiError;
    expect(err.is('maintenance') && err.details.message).toBe('works');
    expect(err.retryAfterSeconds).toBe(300);
    expect(gw.requests).toHaveLength(1);
  });

  it('sendTestWebhook is never repeated after a possible delivery, only when it surely did not run', async () => {
    gw.queue.push(apiError(503, 'service_unavailable', { outcome: 'unknown' }));
    await expect(transport().call('sendTestWebhook', { body: {} })).rejects.toMatchObject({
      errorCode: 'service_unavailable',
    });
    expect(gw.requests).toHaveLength(1);

    gw.requests.length = 0;
    gw.queue.push(apiError(503, 'service_unavailable'));
    await transport().call('sendTestWebhook', { body: {} });
    expect(gw.requests).toHaveLength(2);
  });

  it('redeliverDelivery is repeated at most once', async () => {
    gw.fallback = () => apiError(503, 'service_unavailable', { outcome: 'unknown' });
    await expect(transport().call('redeliverDelivery', { path: { deliveryId: 'd' } })).rejects.toBeInstanceOf(
      PspApiError,
    );
    expect(gw.requests).toHaveLength(2);
  });

  it('a 202 of setWebhookUrl is a success, not a retry', async () => {
    gw.queue.push({ status: 202, json: { sync: { state: 'pending' } } });
    const settings = await transport().call<object>('setWebhookUrl', { body: { url: 'https://shop.example/hook' } });
    expect(getResponseMeta(settings)?.status).toBe(202);
    expect(gw.requests).toHaveLength(1);
  });

  it('the pause between attempts is capped at 60 s (±20 %) whatever the base', async () => {
    gw.fallback = () => apiError(503, 'service_unavailable');
    const controller = new AbortController();
    const delays: number[] = [];
    const call = transport({
      retryBaseDelayMs: 10 * 60_000,
      onRetry: ({ delayMs }) => {
        delays.push(delayMs);
        controller.abort(new Error('enough'));
      },
    }).call('getAccount', { options: { signal: controller.signal } });
    await expect(call).rejects.toThrow('enough');
    expect(delays[0]).toBeLessThanOrEqual(72_000);
  });

  it('maxRetries: 0 per call turns retries off', async () => {
    gw.fallback = () => apiError(503, 'service_unavailable');
    await expect(transport().call('getAccount', { options: { maxRetries: 0 } })).rejects.toBeInstanceOf(PspApiError);
    expect(gw.requests).toHaveLength(1);
  });
});

describe('connections', () => {
  it('a timeout is PspTimeoutError with an unknown outcome; a GET is retried', async () => {
    gw.fallback = () => ({ json: {}, delayMs: 300 });
    const err = await rejection(transport({ timeoutMs: 50, maxRetries: 1 }).call('getAccount'));
    expect(err).toBeInstanceOf(PspTimeoutError);
    expect((err as PspTimeoutError).outcome).toBe('unknown');
    expect(gw.requests).toHaveLength(2);
  });

  it('connection refused: not_sent; even sendTestWebhook is repeated', async () => {
    const url = gw.url;
    await gw.close();
    const err = await rejection(
      new Transport(
        resolveConfig({ apiKey: KEY, apiSecret: SECRET, baseUrl: url, retryBaseDelayMs: 1, maxRetries: 2 }, 'ua'),
      ).call('sendTestWebhook', { body: {} }),
    );
    expect(err).toBeInstanceOf(PspConnectionError);
    expect((err as PspConnectionError).outcome).toBe('not_sent');
    expect((err as PspConnectionError).context?.attempts).toBe(3);
    gw = await startFakeGateway();
  });

  it('an abort signal stops the call and the pending retries', async () => {
    gw.fallback = () => apiError(503, 'service_unavailable');
    const controller = new AbortController();
    const call = transport({ retryBaseDelayMs: 10_000 }).call('getAccount', { options: { signal: controller.signal } });
    setTimeout(() => controller.abort(new Error('stop')), 50);
    await expect(call).rejects.toThrow('stop');
    expect(gw.requests).toHaveLength(1);
  });
});

describe('hooks and warnings', () => {
  it('X-Api-Key-Deprecated gives one warning per value', async () => {
    gw.fallback = () => ({ json: {}, headers: { 'X-Api-Key-Deprecated': '2026-10-28T12:00:00.000Z' } });
    const warnings: PspWarning[] = [];
    const t = transport({ onWarning: (w) => warnings.push(w) });
    await t.call('getAccount');
    await t.call('getAccount');
    expect(warnings).toEqual([
      expect.objectContaining({ code: 'deprecated_api_key', validUntil: '2026-10-28T12:00:00.000Z' }),
    ]);
  });

  it('onResponse sees every attempt; a throwing hook does not break the call', async () => {
    gw.queue.push(apiError(503, 'service_unavailable'));
    const seen: (number | null)[] = [];
    await transport({
      onResponse: (info) => {
        seen.push(info.status);
        throw new Error('hook failed');
      },
    }).call('getAccount');
    expect(seen).toEqual([503, 200]);
  });
});
