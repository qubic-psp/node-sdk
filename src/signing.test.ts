// Test vectors of gateway docs/13-merchant-api.md, 13.5 (both vectors and the table «Проверка своей реализации»).
import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildQuery, resolveTarget } from './query';
import {
  EMPTY_BODY_SHA256,
  buildStringToSign,
  sha256Hex,
  signRequest,
  signString,
  unixSeconds,
  type SignRequestInput,
} from './signing';

const SECRET = 'psp_sk_9fT2kQ7mW4xL1vR8nB5cJ3hD6gZ0aY2eUq4N';
const KEY = 'psp_pk_3Kd9Lm2Qx7Rt5Vb8Nw1Hc4Zp';

const V1 = {
  method: 'POST',
  target: '/api/v1/invoices',
  timestamp: '1790683200',
  nonce: '6f1c2a9e-4b7d-4e21-9a3c-8d5f0b2e7c41',
  body: '{"externalId":"order-10530","network":"tron","asset":"USDT","amount":"50","description":"Заказ 10530","metadata":{"orderId":"10530"}}',
  bodySha256: 'c3e5c7ad5ff7b2b32958d47b76dccfa8587be1882fefb19f393a6652990008d1',
  signature: 'v1=e2fda22d1cbec087e2edc769f9bfc2368c29fd43aff2f36822fa19d9396463d9',
};

const V2 = {
  method: 'GET',
  target: '/api/v1/invoices?status=active,partially_paid&limit=20',
  timestamp: '1790683260',
  nonce: 'b2d4f6a8-1c3e-4f50-8a7b-9c0d1e2f3a4b',
  signature: 'v1=e336ed5f635db2db5de16f78a38feb28c86dd5245a0d92a2f2cf0f54e503d5f9',
};

const sign = (over: Partial<SignRequestInput> = {}) => signRequest({ apiKey: KEY, apiSecret: SECRET, ...V1, ...over });

const signV2 = (over: Partial<SignRequestInput> = {}) =>
  signRequest({ apiKey: KEY, apiSecret: SECRET, ...V2, body: null, ...over });

describe('vector 1: POST with a body', () => {
  it('has the documented body, hash, string to sign and signature', () => {
    expect(Buffer.byteLength(V1.body, 'utf8')).toBe(138);
    expect(V1.body.length).toBe(133);
    const signed = sign();
    expect(signed.bodySha256).toBe(V1.bodySha256);
    expect(Buffer.byteLength(signed.stringToSign, 'utf8')).toBe(137);
    expect(signed.stringToSign).toBe(
      `v1\nPOST\n/api/v1/invoices\n1790683200\n6f1c2a9e-4b7d-4e21-9a3c-8d5f0b2e7c41\n${V1.bodySha256}`,
    );
    expect(signed.signature).toBe(V1.signature);
    expect(signed.headers).toEqual({
      'X-Api-Key': KEY,
      'X-Api-Timestamp': V1.timestamp,
      'X-Api-Nonce': V1.nonce,
      'X-Api-Signature': V1.signature,
    });
  });

  it('signs the same bytes given as a Buffer', () => {
    expect(sign({ body: Buffer.from(V1.body, 'utf8') }).signature).toBe(V1.signature);
  });
});

describe('vector 2: GET without a body, with a query', () => {
  it('has the documented string to sign and signature', () => {
    const signed = signV2();
    expect(signed.bodySha256).toBe(EMPTY_BODY_SHA256);
    expect(Buffer.byteLength(signed.stringToSign, 'utf8')).toBe(174);
    expect(signed.signature).toBe(V2.signature);
  });

  it('an empty string body is the empty body', () => {
    expect(signRequest({ apiKey: KEY, apiSecret: SECRET, ...V2, body: '' }).signature).toBe(V2.signature);
  });

  it('the SDK query builder and URL resolution give exactly the TARGET of the vector', () => {
    const query = buildQuery({ status: ['active', 'partially_paid'], limit: 20 });
    expect(query).toBe('?status=active,partially_paid&limit=20');
    expect(resolveTarget('https://api.nile.psp.example', `/api/v1/invoices${query}`).target).toBe(V2.target);
  });
});

describe('negative cases of 13.5', () => {
  it('3: a Python json.dumps body (170 bytes) is another signature', () => {
    const body =
      '{"externalId": "order-10530", "network": "tron", "asset": "USDT", "amount": "50", ' +
      '"description": "\\u0417\\u0430\\u043a\\u0430\\u0437 10530", "metadata": {"orderId": "10530"}}';
    expect(Buffer.byteLength(body, 'utf8')).toBe(170);
    expect(sign({ body }).signature).toBe('v1=8f3d573e923659b4f914d3f7f09ff27ffbaae1efb4a077a6b7a17a57e23f7696');
  });

  it('4: the body with a trailing newline', () => {
    expect(sign({ body: `${V1.body}\n` }).signature).toBe(
      'v1=2e6165861be82a3d72c1cef75fb110c12735c05b391960282492f6d904d1a310',
    );
  });

  it('5: a newline after the body hash', () => {
    const stringToSign = `${buildStringToSign({ ...V1 })}\n`;
    expect(signString(SECRET, stringToSign)).toBe(
      'v1=75f067cdbef871f45f4d164270326c031d5fb314db8733918eff03fb2d70247d',
    );
  });

  it('6: a lower-case method in the string to sign; the SDK upper-cases it', () => {
    const lower = ['v1', 'post', V1.target, V1.timestamp, V1.nonce, V1.bodySha256].join('\n');
    expect(signString(SECRET, lower)).toBe('v1=9d4fb5f0b5d6c0d94e0d52b58e491142d9cd5109f93dd9e73e499280f6cce2f6');
    expect(sign({ method: 'post' }).signature).toBe(V1.signature);
  });

  it('7: another secret', () => {
    const signed = signRequest({ apiKey: KEY, apiSecret: `${SECRET.slice(0, -1)}M`, ...V1 });
    expect(signed.signature).toBe('v1=c565da8aec7cb9a1ffd9f1d2e5e72026f80f0e393b2d10bd04ea270f6861ed5f');
  });

  it('8: the HMAC key is the raw sha256 of the secret', () => {
    const key = createHash('sha256').update(SECRET, 'utf8').digest();
    const mac = createHmac('sha256', key).update(sign().stringToSign, 'utf8').digest('hex');
    expect(`v1=${mac}`).toBe('v1=505fcfff3388c243506ef90fbd9648904ee00657191a5501c89eafb2aa49306b');
  });

  it('9: %2C in the query', () => {
    expect(signV2({ target: '/api/v1/invoices?status=active%2Cpartially_paid&limit=20' }).signature).toBe(
      'v1=453a7c48e1d7d30fb8b0efc8918ba064e8549d58bcc084d67199af1740303db4',
    );
  });

  it('10: parameters swapped', () => {
    expect(signV2({ target: '/api/v1/invoices?limit=20&status=active,partially_paid' }).signature).toBe(
      'v1=affa3dbbb6ce1b4ee17ecd53d55c5035a2cfa7d5bef79eb68bd5862396b0afb9',
    );
  });

  it('11: no query', () => {
    expect(signV2({ target: '/api/v1/invoices' }).signature).toBe(
      'v1=f91aa50c250f4111e4c0e412729b639e1fc1c73286ff64aac225660edb292f6b',
    );
  });

  it('12: scheme and host in TARGET; signRequest refuses such a target', () => {
    const withHost = [
      'v1',
      'GET',
      `https://api.nile.psp.example${V2.target}`,
      V2.timestamp,
      V2.nonce,
      EMPTY_BODY_SHA256,
    ];
    expect(signString(SECRET, withHost.join('\n'))).toBe(
      'v1=ed69a23f02d7758a78844a9f06fd713868615ae8ac3f0eeb5b12ec88f7758c9f',
    );
    expect(() => signV2({ target: `https://api.nile.psp.example${V2.target}` })).toThrow(TypeError);
  });

  it('13–14: malformed timestamp and nonce never get signed', () => {
    expect(() => sign({ timestamp: '1790683200000' })).toThrow(/10 digits/);
    expect(() => sign({ nonce: 'short' })).toThrow(/nonce/);
    expect(() => sign({ target: '/api/v1/invoices#list' })).toThrow(TypeError);
  });
});

describe('helpers', () => {
  it('{} and the empty body hash differently', () => {
    expect(sha256Hex('{}')).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
    expect(sha256Hex('')).toBe(EMPTY_BODY_SHA256);
  });

  it('unixSeconds gives 10 digits and drops milliseconds', () => {
    expect(unixSeconds(1790683200999)).toBe('1790683200');
  });

  it('fresh timestamp and nonce differ on every call', () => {
    const fresh = { apiKey: KEY, apiSecret: SECRET, method: 'GET', target: '/api/v1/account' };
    const a = signRequest(fresh);
    const b = signRequest(fresh);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.signature).not.toBe(b.signature);
    expect(a.timestamp).toMatch(/^[0-9]{10}$/);
  });
});
