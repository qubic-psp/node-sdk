// Vectors of webhook-service docs/13-merchant-webhooks.md: 13.6 (the webhook.test body) and the table «Проверка
// своей реализации» of 13.7. The bodies are byte-exact copies in test/vectors/.
import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { PspClient } from '../client';
import type { WebhookEvent, WebhookPayment } from './events';
import { WebhookVerificationError, signWebhook, verifyWebhook, verifyWebhookSignature } from './verify';

const SECRET = 'psp_sk_9fT2kQ7mW4xL1vR8nB5cJ3hD6gZ0aY2eUq4N';
const TEST_BODY = readFileSync(new URL('../../test/vectors/webhook-test.json', import.meta.url));
const PAID_BODY = readFileSync(new URL('../../test/vectors/invoice-paid.json', import.meta.url));

const testHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'x-webhook-id': '0b7f3d2e-8c41-4a9b-b6e5-1f2a3c4d5e6f',
  'x-webhook-event': 'webhook.test',
  'x-webhook-timestamp': '1790684400',
  'x-webhook-signature': 'v1=e35e9b0ea7e02ffcff516436483fedda7b1b01e16c65e3d4a7a61274670df250',
  'x-webhook-attempt': '1',
};

const paidHeaders = {
  'x-webhook-id': 'c65065bb-9874-49d4-b44b-4930a167a5c1',
  'x-webhook-event': 'invoice.paid',
  'x-webhook-timestamp': '1790683568',
  'x-webhook-signature': 'v1=295caa04b9830dd6669011d09cd5b0a5e4d3bf7bcc4a9c8d9cdd943216026433',
  'x-webhook-attempt': '1',
};

const reason = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    if (err instanceof WebhookVerificationError) return err.reason;
    throw err;
  }
  return 'valid';
};

const check = (over: { body?: Buffer | string; headers?: Record<string, string>; secret?: string; now?: number }) =>
  reason(() =>
    verifyWebhook({
      body: over.body ?? TEST_BODY,
      headers: { ...testHeaders, ...over.headers },
      secret: over.secret ?? SECRET,
      now: over.now ?? 1790684400,
    }),
  );

describe('vectors of 13.6 / 13.7', () => {
  it('the bodies are byte-exact: 279 and 1530 bytes', () => {
    expect(TEST_BODY.length).toBe(279);
    expect(PAID_BODY.length).toBe(1530);
  });

  it('1: valid', () => {
    expect(check({})).toBe('valid');
  });

  it('2: exactly 300 s later is still valid; 300 s earlier too', () => {
    expect(check({ now: 1790684700 })).toBe('valid');
    expect(check({ now: 1790684100 })).toBe('valid');
  });

  it('3: 301 s later is timestamp_out_of_window', () => {
    expect(check({ now: 1790684701 })).toBe('timestamp_out_of_window');
  });

  it('4: the body with a trailing newline is signature_mismatch', () => {
    expect(check({ body: Buffer.concat([TEST_BODY, Buffer.from('\n')]) })).toBe('signature_mismatch');
  });

  it('5: a re-serialized body is signature_mismatch', () => {
    expect(check({ body: JSON.stringify(JSON.parse(TEST_BODY.toString('utf8')), null, 1) })).toBe('signature_mismatch');
  });

  it('6: another secret is signature_mismatch', () => {
    expect(check({ secret: `${SECRET.slice(0, -1)}M` })).toBe('signature_mismatch');
  });

  it('7: an upper-case signature is bad_signature_header', () => {
    expect(check({ headers: { 'x-webhook-signature': testHeaders['x-webhook-signature'].toUpperCase() } })).toBe(
      'bad_signature_header',
    );
  });

  it('8: a timestamp with a trailing space is bad_timestamp', () => {
    expect(check({ headers: { 'x-webhook-timestamp': '1790684400 ' } })).toBe('bad_timestamp');
  });

  it('9: invoice.paid, both attempts of 13.2', () => {
    const paid = verifyWebhook({ body: PAID_BODY, headers: paidHeaders, secret: SECRET, now: 1790683568 });
    expect(paid.type).toBe('invoice.paid');
    const second = {
      ...paidHeaders,
      'x-webhook-timestamp': '1790683579',
      'x-webhook-signature': 'v1=9dfde3aed23fa92b06cfec5595976a2107ec8834189514cd5b1d12b716e9e87e',
      'x-webhook-attempt': '2',
    };
    expect(verifyWebhookSignature({ body: PAID_BODY, headers: second, secret: SECRET, now: 1790683579 })).toEqual({
      signedWith: 'current',
      timestamp: 1790683579,
      attempt: 2,
    });
  });
});

describe('signature', () => {
  it('signWebhook reproduces the vector and accepts a string, a Buffer and a Uint8Array', () => {
    const expected = testHeaders['x-webhook-signature'];
    expect(signWebhook(SECRET, 1790684400, TEST_BODY)).toBe(expected);
    expect(signWebhook(SECRET, '1790684400', TEST_BODY.toString('utf8'))).toBe(expected);
    expect(signWebhook(SECRET, 1790684400, new Uint8Array(TEST_BODY))).toBe(expected);
  });

  it('the previous secret passes during a rotation and is reported', () => {
    const NEW = 'psp_sk_Hq3vN8xK1mT6wR4cZ9bL2fJ7dY5gA0sEp6Wt';
    const input = { body: TEST_BODY, headers: testHeaders, now: 1790684400 };
    expect(verifyWebhookSignature({ ...input, secret: NEW, previousSecret: SECRET }).signedWith).toBe('previous');
    expect(verifyWebhookSignature({ ...input, secret: SECRET, previousSecret: NEW }).signedWith).toBe('current');
    expect(reason(() => verifyWebhookSignature({ ...input, secret: NEW }))).toBe('signature_mismatch');
  });

  it('missing headers', () => {
    const { 'x-webhook-signature': _s, ...noSignature } = testHeaders;
    expect(
      reason(() => verifyWebhook({ body: TEST_BODY, headers: noSignature, secret: SECRET, now: 1790684400 })),
    ).toBe('missing_header');
    const { 'x-webhook-id': _i, ...noId } = testHeaders;
    expect(reason(() => verifyWebhook({ body: TEST_BODY, headers: noId, secret: SECRET, now: 1790684400 }))).toBe(
      'missing_header',
    );
  });

  it('reads Fetch Headers, header names in any case and repeated headers', () => {
    expect(
      verifyWebhook({ body: TEST_BODY, headers: new Headers(testHeaders), secret: SECRET, now: 1790684400 }).id,
    ).toBe(testHeaders['x-webhook-id']);
    const upper = Object.fromEntries(Object.entries(testHeaders).map(([k, v]) => [k.toUpperCase(), [v]]));
    expect(verifyWebhook({ body: TEST_BODY, headers: upper, secret: SECRET, now: 1790684400 }).type).toBe(
      'webhook.test',
    );
  });

  it('a parsed object instead of the raw body is a TypeError that says what to do', () => {
    const parsed = JSON.parse(TEST_BODY.toString('utf8')) as unknown as string;
    expect(() => verifyWebhook({ body: parsed, headers: testHeaders, secret: SECRET, now: 1790684400 })).toThrow(
      /express\.raw/,
    );
  });

  it('a refusal carries the HTTP status to answer with', () => {
    try {
      verifyWebhook({ body: TEST_BODY, headers: testHeaders, secret: SECRET, now: 1790690000 });
    } catch (err) {
      expect(err).toBeInstanceOf(WebhookVerificationError);
      expect((err as WebhookVerificationError).status).toBe(401);
      expect((err as Error).message).toContain('sync it with NTP');
    }
  });
});

describe('the body after a valid signature', () => {
  const signed = (body: string, headers: Record<string, string> = {}) => {
    const parsed = JSON.parse(body) as { id: string; type: string };
    return {
      body,
      headers: {
        'x-webhook-id': parsed.id,
        'x-webhook-event': parsed.type,
        'x-webhook-timestamp': '1790684400',
        'x-webhook-signature': signWebhook(SECRET, '1790684400', body),
        ...headers,
      },
      secret: SECRET,
      now: 1790684400,
    };
  };
  const base = JSON.parse(TEST_BODY.toString('utf8')) as Record<string, unknown>;
  const variant = (over: Record<string, unknown>) => JSON.stringify({ ...base, ...over });

  it('id and type must equal the headers', () => {
    expect(reason(() => verifyWebhook(signed(variant({}), { 'x-webhook-id': 'other' })))).toBe('id_mismatch');
    expect(reason(() => verifyWebhook(signed(variant({}), { 'x-webhook-event': 'invoice.paid' })))).toBe(
      'type_mismatch',
    );
  });

  it('an unknown body version is refused with 400, so the platform retries after an SDK update', () => {
    const err = (() => {
      try {
        verifyWebhook(signed(variant({ version: 2 })));
      } catch (e) {
        return e as WebhookVerificationError;
      }
      throw new Error('expected a refusal');
    })();
    expect(err.reason).toBe('unsupported_version');
    expect(err.status).toBe(400);
  });

  it('a body that is not an object, or lacks the envelope', () => {
    const notObject = '[1,2]';
    const input = {
      body: notObject,
      headers: { ...testHeaders, 'x-webhook-signature': signWebhook(SECRET, '1790684400', notObject) },
      secret: SECRET,
      now: 1790684400,
    };
    expect(reason(() => verifyWebhook(input))).toBe('bad_body');
    expect(reason(() => verifyWebhook(signed(variant({ data: null }))))).toBe('bad_body');
  });

  it('expectedMerchantId and the network of the key', () => {
    expect(reason(() => verifyWebhook({ ...signed(variant({})), expectedMerchantId: 'another' }))).toBe(
      'merchant_mismatch',
    );
    expect(
      reason(() => verifyWebhook({ ...signed(variant({})), expectedMerchantId: base['merchantId'] as string })),
    ).toBe('valid');
    expect(reason(() => verifyWebhook({ ...signed(variant({})), net: 'mainnet' }))).toBe('chain_mismatch');
    expect(reason(() => verifyWebhook({ ...signed(variant({})), net: 'testnet' }))).toBe('valid');
    expect(reason(() => verifyWebhook({ ...signed(variant({ chain: 'mainnet' })), net: 'testnet' }))).toBe(
      'chain_mismatch',
    );
  });

  it('aml: null reads as aml.status: null', () => {
    const paid = JSON.parse(PAID_BODY.toString('utf8')) as { data: { payment: Record<string, unknown> } };
    paid.data.payment['aml'] = null;
    const event = verifyWebhook(signed(JSON.stringify(paid)));
    if (event.type !== 'invoice.paid') throw new Error('wrong type');
    expect(event.data.payment.aml).toEqual({ status: null });
  });
});

describe('psp.webhook.verify', () => {
  const psp = new PspClient({
    apiKey: 'psp_pk_3Kd9Lm2Qx7Rt5Vb8Nw1Hc4Zp',
    apiSecret: SECRET,
    baseUrl: 'https://api.nile.psp.example',
  });

  it('uses the secret and the network of the client', () => {
    const event = psp.webhook.verify(PAID_BODY, paidHeaders, { now: 1790683568 });
    expect(event.id).toBe('c65065bb-9874-49d4-b44b-4930a167a5c1');
    if (event.type === 'invoice.paid') expect(event.data.invoice.externalId).toBe('order-10530');
  });

  it('a live client refuses a nile webhook', () => {
    const live = new PspClient({
      apiKey: 'psp_pk_live_3Kd9Lm2Qx7Rt5Vb8Nw1Hc4Zp',
      apiSecret: 'psp_sk_live_9fT2kQ7mW4xL1vR8nB5cJ3hD6gZ0aY2eUq4N',
      baseUrl: 'https://api.psp.example',
    });
    const body = PAID_BODY.toString('utf8');
    const headers = {
      ...paidHeaders,
      'x-webhook-signature': signWebhook('psp_sk_live_9fT2kQ7mW4xL1vR8nB5cJ3hD6gZ0aY2eUq4N', '1790683568', body),
    };
    expect(reason(() => live.webhook.verify(body, headers, { now: 1790683568 }))).toBe('chain_mismatch');
  });

  it('accepts webhooks signed with previousApiSecret', () => {
    const rotated = new PspClient({
      apiKey: 'psp_pk_3Kd9Lm2Qx7Rt5Vb8Nw1Hc4Zp',
      apiSecret: 'psp_sk_Hq3vN8xK1mT6wR4cZ9bL2fJ7dY5gA0sEp6Wt',
      previousApiSecret: SECRET,
      baseUrl: 'https://api.nile.psp.example',
    });
    expect(rotated.webhook.verify(TEST_BODY, testHeaders, { now: 1790684400 }).type).toBe('webhook.test');
  });
});

describe('the webhook objects and the API objects', () => {
  const spec = JSON.parse(readFileSync(new URL('../../api/openapi.v1.json', import.meta.url), 'utf8')) as {
    components: { schemas: Record<string, { required: string[] }> };
  };
  const paid = JSON.parse(PAID_BODY.toString('utf8')) as {
    data: { invoice: Record<string, unknown>; payment: Record<string, unknown> };
  };

  it('data.invoice has exactly the fields of the API Invoice (V1Invoice)', () => {
    expect(Object.keys(paid.data.invoice).sort()).toEqual(
      [...(spec.components.schemas['V1Invoice']?.required ?? [])].sort(),
    );
  });

  it('data.payment has the fields of the API payment without creditStatus (13.3)', () => {
    const api = (spec.components.schemas['V1InvoicePayment']?.required ?? []).filter((k) => k !== 'creditStatus');
    expect(Object.keys(paid.data.payment).sort()).toEqual([...api].sort());
  });
});

describe('types of events', () => {
  it('narrowing by type gives the payment or null', () => {
    const handle = (event: WebhookEvent): void => {
      switch (event.type) {
        case 'invoice.paid':
        case 'invoice.overpaid':
          expectTypeOf(event.data.payment).toEqualTypeOf<WebhookPayment>();
          expectTypeOf(event.data.invoice.externalId).toEqualTypeOf<string>();
          break;
        case 'invoice.expired':
        case 'invoice.cancelled':
          expectTypeOf(event.data.payment).toEqualTypeOf<null>();
          break;
        case 'webhook.test':
          expectTypeOf(event.data.message).toEqualTypeOf<string>();
          break;
        default:
          break;
      }
    };
    handle(verifyWebhook({ body: TEST_BODY, headers: testHeaders, secret: SECRET, now: 1790684400 }));
  });
});
