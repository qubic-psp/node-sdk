// Vectors of gateway docs/20-pay.md, 20.4.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createCheckoutToken } from './checkout';
import { PspClient } from './client';

const SECRET = 'psp_sk_9fT2kQ7mW4xL1vR8nB5cJ3hD6gZ0aY2eUq4N';
const KEY = 'psp_pk_3Kd9Lm2Qx7Rt5Vb8Nw1Hc4Zp';
const INVOICE = '97da92f5-45c0-411b-9ed5-6793b396cd5f';
const EXP = 1790769600;
const NOW = 1790683200;

const VECTOR_1 =
  'v1.eyJrIjoicHNwX3BrXzNLZDlMbTJReDdSdDVWYjhOdzFIYzRacCIsImkiOiI5N2RhOTJmNS00NWMwLTQxMWItOWVkNS02NzkzYjM5NmNkNWYiLCJlIjoxNzkwNzY5NjAwLCJiIjp7ImNvbXBhbnlOYW1lIjoiU2hvcCBFeGFtcGxlIiwibG9nb1VybCI6Imh0dHBzOi8vc2hvcC5leGFtcGxlL2xvZ28ucG5nIiwiYWNjZW50Q29sb3IiOiIjNGY0NmU1IiwidGhlbWUiOiJhdXRvIiwidGl0bGUiOiLQl9Cw0LrQsNC3IDEwNTMwIn0sImwiOiJydSJ9.IzC8fVLRewHK1Xx33zRBoVFi1aMIHgRxJdk5C0vb70Y';
const VECTOR_2 =
  'v1.eyJrIjoicHNwX3BrXzNLZDlMbTJReDdSdDVWYjhOdzFIYzRacCIsImkiOiI5N2RhOTJmNS00NWMwLTQxMWItOWVkNS02NzkzYjM5NmNkNWYiLCJlIjoxNzkwNzY5NjAwfQ.guQrxJw9m2RlbNRkL3FPI08BJHsr_WzByGV6XPXrlak';

const base = { apiKey: KEY, apiSecret: SECRET, invoiceId: INVOICE, expiresAt: EXP, now: NOW };

describe('vectors of 20.4', () => {
  it('1: with branding and locale', () => {
    const { token, expiresAt } = createCheckoutToken({
      ...base,
      branding: {
        companyName: 'Shop Example',
        logoUrl: 'https://shop.example/logo.png',
        accentColor: '#4f46e5',
        theme: 'auto',
        title: 'Заказ 10530',
      },
      locale: 'ru',
    });
    expect(token).toBe(VECTOR_1);
    expect(token).toHaveLength(379);
    expect(expiresAt).toBe(EXP);
  });

  it('1: the branding keys come out in the spec order whatever the input order', () => {
    const { token } = createCheckoutToken({
      ...base,
      locale: 'ru',
      branding: {
        title: 'Заказ 10530',
        theme: 'auto',
        accentColor: '#4f46e5',
        logoUrl: 'https://shop.example/logo.png',
        companyName: 'Shop Example',
      },
    });
    expect(token).toBe(VECTOR_1);
  });

  it('2: without branding; an empty branding object is the same', () => {
    expect(createCheckoutToken(base).token).toBe(VECTOR_2);
    expect(createCheckoutToken({ ...base, branding: {} }).token).toBe(VECTOR_2);
  });

  it('negative cases: another secret and the API request prefix give other signatures', () => {
    const payload = VECTOR_2.split('.')[1] ?? '';
    const sign = (secret: string, prefix: string) =>
      createHmac('sha256', secret).update(`${prefix}${payload}`).digest('base64url');
    expect(sign(`${SECRET.slice(0, -1)}M`, 'psp-checkout-v1.')).toBe('R2Sq_oZLnUaUvY2MI6am92r3ssIx5DjdyKw86qjtAKo');
    expect(sign(SECRET, 'v1.')).toBe('DtreNmaTLcNJkb-XLLyIzHH3Rl2X8zhwxbFIvfGDthw');
  });
});

describe('validation of 20.2–20.3', () => {
  it('refuses a malformed key, invoice id or expiry', () => {
    expect(() => createCheckoutToken({ ...base, apiKey: 'psp_pk_short' })).toThrow(/apiKey/);
    expect(() => createCheckoutToken({ ...base, invoiceId: INVOICE.toUpperCase() })).toThrow(/uuid/);
    expect(() => createCheckoutToken({ ...base, expiresAt: NOW })).toThrow(/future/);
    expect(() => createCheckoutToken({ ...base, expiresAt: NOW + 604_801 })).toThrow(/7 days/);
    expect(createCheckoutToken({ ...base, expiresAt: NOW + 604_800 }).expiresAt).toBe(NOW + 604_800);
  });

  it('refuses branding that could carry markup or a non-https logo', () => {
    const bad = (branding: object) => () => createCheckoutToken({ ...base, branding });
    expect(bad({ companyName: '' })).toThrow(/companyName/);
    expect(bad({ companyName: 'x'.repeat(65) })).toThrow(/64/);
    expect(bad({ companyName: 'Shop\u0000' })).toThrow(/control/);
    expect(bad({ companyName: ' Shop' })).toThrow(/whitespace/);
    expect(bad({ logoUrl: 'http://shop.example/logo.png' })).toThrow(/https/);
    expect(bad({ logoUrl: 'javascript:alert(1)' })).toThrow(/https/);
    expect(bad({ logoUrl: 'https://user:pass@shop.example/logo.png' })).toThrow(/credentials/);
    expect(bad({ accentColor: 'red' })).toThrow(/#rrggbb/);
    expect(bad({ theme: 'neon' })).toThrow(/theme/);
    expect(bad({ title: 'x'.repeat(101) })).toThrow(/100/);
    expect(bad({ html: '<b>' })).toThrow(/not supported/);
    expect(() => createCheckoutToken({ ...base, locale: 'de' as never })).toThrow(/locale/);
  });

  it('counts the length as JavaScript does (UTF-16), like gateway: 32 emoji fit, 33 do not', () => {
    expect(() => createCheckoutToken({ ...base, branding: { companyName: '🛒'.repeat(32) } })).not.toThrow();
    expect(() => createCheckoutToken({ ...base, branding: { companyName: '🛒'.repeat(33) } })).toThrow(/64/);
  });
});

describe('psp.checkout.createUrl', () => {
  const client = (checkoutUrl?: string) =>
    new PspClient({
      apiKey: KEY,
      apiSecret: SECRET,
      baseUrl: 'https://api.psp.example',
      ...(checkoutUrl === undefined ? {} : { checkoutUrl }),
    });

  it('puts the token after # of the page URL and lives 24 h by default', () => {
    const before = Math.floor(Date.now() / 1000);
    const link = client('https://pay.psp.example').checkout.createUrl({ id: INVOICE }, { locale: 'en' });
    expect(link.url).toBe(`https://pay.psp.example/#${link.token}`);
    expect(link.token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    const expires = Date.parse(link.expiresAt) / 1000;
    expect(expires - before).toBeGreaterThanOrEqual(86_400);
    expect(expires - before).toBeLessThanOrEqual(86_401);
  });

  it('needs checkoutUrl (option or PSP_CHECKOUT_URL), https outside localhost', () => {
    expect(() => client().checkout.createUrl(INVOICE)).toThrow(/checkoutUrl is required/);
    expect(() => client('http://pay.psp.example')).toThrow(/https/);
    expect(client('http://localhost:5180').checkout.createUrl(INVOICE).url).toMatch(/^http:\/\/localhost:5180\/#v1\./);
    expect(() => client('https://pay.psp.example/?a=1')).toThrow(/query/);
  });

  it('refuses a lifetime outside 1 s … 7 days', () => {
    const psp = client('https://pay.psp.example');
    expect(() => psp.checkout.createUrl(INVOICE, { expiresInSeconds: 0 })).toThrow(/expiresInSeconds/);
    expect(() => psp.checkout.createUrl(INVOICE, { expiresInSeconds: 604_801 })).toThrow(/expiresInSeconds/);
  });
});
