import { afterEach, describe, expect, it, vi } from 'vitest';
import { netOfCredential, resolveConfig, type PspClientOptions } from './config';

const KEY = 'psp_pk_test_3Kd9Lm2Qx7Rt5Vb8Nw1Hc4Zp';
const SECRET = 'psp_sk_test_9fT2kQ7mW4xL1vR8nB5cJ3hD6gZ0aY2eUq4N';
const base = { apiKey: KEY, apiSecret: SECRET, baseUrl: 'https://api.psp.example' };
const resolve = (options: PspClientOptions) => resolveConfig(options, 'ua');

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('credentials', () => {
  it('takes the options, else PSP_API_KEY, PSP_API_SECRET and PSP_API_URL', () => {
    vi.stubEnv('PSP_API_KEY', KEY);
    vi.stubEnv('PSP_API_SECRET', SECRET);
    vi.stubEnv('PSP_API_URL', 'https://api.nile.psp.example');
    expect(resolve({})).toMatchObject({ apiKey: KEY, apiSecret: SECRET, baseUrl: 'https://api.nile.psp.example/' });
  });

  it('accepts the key formats of 13.2: test_, live_ and the older ones without a net prefix', () => {
    expect(resolve(base).net).toBe('testnet');
    expect(
      resolve({
        ...base,
        apiKey: 'psp_pk_3Kd9Lm2Qx7Rt5Vb8Nw1Hc4Zp',
        apiSecret: 'psp_sk_9fT2kQ7mW4xL1vR8nB5cJ3hD6gZ0aY2eUq4N',
      }).net,
    ).toBe('testnet');
    expect(
      resolve({
        ...base,
        apiKey: 'psp_pk_live_3Kd9Lm2Qx7Rt5Vb8Nw1Hc4Zp',
        apiSecret: 'psp_sk_live_9fT2kQ7mW4xL1vR8nB5cJ3hD6gZ0aY2eUq4N',
      }).net,
    ).toBe('mainnet');
  });

  it('refuses a missing, padded, malformed or mixed-network credential', () => {
    vi.stubEnv('PSP_API_KEY', '');
    expect(() => resolve({ ...base, apiKey: undefined })).toThrow(/apiKey is required/);
    expect(() => resolve({ ...base, apiKey: ` ${KEY}` })).toThrow(/whitespace/);
    expect(() => resolve({ ...base, apiSecret: 'psp_sk_short' })).toThrow(/apiSecret must look like/);
    expect(() => resolve({ ...base, apiSecret: 'psp_sk_live_9fT2kQ7mW4xL1vR8nB5cJ3hD6gZ0aY2eUq4N' })).toThrow(
      /other network/,
    );
  });

  it('netOfCredential reads the prefix', () => {
    expect(netOfCredential('psp_pk_live_x')).toBe('mainnet');
    expect(netOfCredential('psp_sk_test_x')).toBe('testnet');
    expect(netOfCredential('psp_pk_x')).toBe('testnet');
  });
});

describe('baseUrl', () => {
  it('is required and must be https outside localhost', () => {
    vi.stubEnv('PSP_API_URL', '');
    expect(() => resolve({ ...base, baseUrl: undefined })).toThrow(/baseUrl is required/);
    expect(() => resolve({ ...base, baseUrl: SECRET })).toThrow(/^baseUrl is not a valid URL$/);
    expect(() => resolve({ ...base, baseUrl: 'http://api.psp.example' })).toThrow(/https/);
    expect(() => resolve({ ...base, baseUrl: 'ftp://api.psp.example' })).toThrow(/https/);
    expect(resolve({ ...base, baseUrl: 'http://127.0.0.1:4000' }).baseUrl).toBe('http://127.0.0.1:4000/');
    expect(resolve({ ...base, baseUrl: 'http://psp.internal', allowInsecureHttp: true }).baseUrl).toBe(
      'http://psp.internal/',
    );
  });

  it('has no query, fragment or credentials', () => {
    expect(() => resolve({ ...base, baseUrl: 'https://api.psp.example/?a=1' })).toThrow(/query/);
    expect(() => resolve({ ...base, baseUrl: 'https://u:p@api.psp.example' })).toThrow(/credentials/);
  });
});

describe('numbers', () => {
  it('defaults follow 13.10: timeout 180 s, 4 retries from 1 s, Retry-After up to 30 s', () => {
    expect(resolve(base)).toMatchObject({
      timeoutMs: 180_000,
      maxRetries: 4,
      retryBaseDelayMs: 1000,
      maxRetryAfterSeconds: 30,
    });
  });

  it('refuses negative, fractional retries and a zero timeout', () => {
    expect(() => resolve({ ...base, maxRetries: -1 })).toThrow(/maxRetries/);
    expect(() => resolve({ ...base, maxRetries: 1.5 })).toThrow(/integer/);
    expect(() => resolve({ ...base, timeoutMs: 0 })).toThrow(/timeoutMs must be from 1/);
  });
});
