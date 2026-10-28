import { describe, expect, it } from 'vitest';
import { buildQuery, pathSegment, resolveTarget } from './query';

describe('buildQuery', () => {
  it('joins list values with a literal comma and keeps the order of keys', () => {
    expect(buildQuery({ limit: 20, status: ['active', 'partially_paid'], page: 2 })).toBe(
      '?limit=20&status=active,partially_paid&page=2',
    );
  });

  it('leaves out undefined, null and empty lists; no params is an empty string', () => {
    expect(buildQuery({ a: undefined, b: null, c: [] })).toBe('');
    expect(buildQuery(undefined)).toBe('');
    expect(buildQuery({})).toBe('');
  });

  it('writes dates as ISO 8601 and booleans as words', () => {
    expect(buildQuery({ from: new Date(Date.UTC(2026, 8, 29, 12)), flag: false })).toBe(
      '?from=2026-09-29T12%3A00%3A00.000Z&flag=false',
    );
  });

  it('percent-encodes a comma inside a single value, so it is never taken as a list', () => {
    expect(buildQuery({ externalId: 'a,b&c=d' })).toBe('?externalId=a%2Cb%26c%3Dd');
  });

  it('encodes Cyrillic and spaces the way the WHATWG URL parser keeps them (13.2 TARGET table)', () => {
    const query = buildQuery({ externalId: 'заказ 1' });
    expect(query).toBe('?externalId=%D0%B7%D0%B0%D0%BA%D0%B0%D0%B7%201');
    expect(resolveTarget('https://api.nile.psp.example', `/api/v1/invoices${query}`).target).toBe(
      `/api/v1/invoices${query}`,
    );
  });
});

describe('resolveTarget', () => {
  it('signs only the path and query, never the scheme, host or fragment', () => {
    const { url, target } = resolveTarget('https://api.nile.psp.example', '/api/v1/account');
    expect(url.href).toBe('https://api.nile.psp.example/api/v1/account');
    expect(target).toBe('/api/v1/account');
  });

  it('keeps a path prefix of the base URL (a merchant-side proxy) and ignores a trailing slash', () => {
    expect(resolveTarget('https://proxy.example/psp/', '/api/v1/account').target).toBe('/psp/api/v1/account');
    expect(resolveTarget('https://api.psp.example/', '/api/v1/account').target).toBe('/api/v1/account');
  });

  it('a path segment cannot escape its place', () => {
    expect(pathSegment('../account?x=1')).toBe('..%2Faccount%3Fx%3D1');
  });
});
