// Links to the payment widget (gateway docs/20-pay.md, 20.2–20.4): a checkout token signed offline with the API
// secret, put after `#` of the page URL so it never reaches a server log.
//   token = "v1." + payload + "." + signature
//   payload = base64url(JSON {k, i, e, b?, l?}),  signature = base64url(HMAC-SHA256(secret, "psp-checkout-v1." + payload))
import { createHmac } from 'node:crypto';
import { API_SECRET_RE, netOfCredential } from './config';

/** How the payment page looks. Every field is optional; text is shown as text, the logo only as an image. */
export interface CheckoutBranding {
  /** Shop name in the header, 1–64 characters. */
  companyName?: string;
  /** Logo in the header: an `https:` URL up to 1024 characters. The buyer's browser loads it from your server. */
  logoUrl?: string;
  /** Accent colour of buttons, links and the header line, `#rrggbb`. */
  accentColor?: string;
  /** `light`, `dark` or `auto` (the buyer's system theme, the default). */
  theme?: 'light' | 'dark' | 'auto';
  /** Order caption under the header for the buyer, 1–100 characters, e.g. `Order #10530`. */
  title?: string;
}

/** Language of the payment page. Without it the page follows the buyer's browser (`ru`, otherwise `en`). */
export type CheckoutLocale = 'ru' | 'en';

/** Longest lifetime of a link: 7 days (gateway `PAY_TOKEN_MAX_TTL_SECONDS`). */
export const CHECKOUT_MAX_TTL_SECONDS = 604_800;
/** Default lifetime of a link: 24 hours. */
export const CHECKOUT_DEFAULT_TTL_SECONDS = 86_400;

const KEY_RE = /^psp_pk_(test_|live_)?[0-9A-Za-z]{24}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** Input of {@link createCheckoutToken}. */
export interface CreateCheckoutTokenInput {
  /** API key `psp_pk_…` whose secret signs the token. */
  apiKey: string;
  /** API secret of that key. It only keys the HMAC and is not put into the token. */
  apiSecret: string;
  /** Invoice to show (lower-case uuid). */
  invoiceId: string;
  branding?: CheckoutBranding | undefined;
  locale?: CheckoutLocale | undefined;
  /** Expiry as a `Date` or Unix seconds. Default: now + {@link CHECKOUT_DEFAULT_TTL_SECONDS}. */
  expiresAt?: Date | number | undefined;
  /** Current time (Unix seconds or a `Date`) — for tests. */
  now?: Date | number | undefined;
}

/** A signed checkout token and its expiry. */
export interface CheckoutToken {
  token: string;
  /** Expiry, Unix seconds. */
  expiresAt: number;
}

const seconds = (value: Date | number): number =>
  value instanceof Date ? Math.floor(value.getTime() / 1000) : Math.floor(value);

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new TypeError(`branding.${name} must be a non-empty string`);
  // Length as JavaScript counts it (UTF-16 code units), the same rule as gateway 20.3
  if (value.length > max) throw new TypeError(`branding.${name} must be at most ${max} characters`);
  if (CONTROL_RE.test(value)) throw new TypeError(`branding.${name} must not contain control characters`);
  if (value !== value.trim()) throw new TypeError(`branding.${name} must not start or end with whitespace`);
  return value;
}

function logo(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) {
    throw new TypeError('branding.logoUrl must be a URL of 1–1024 characters');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('branding.logoUrl must be a valid URL');
  }
  if (url.protocol !== 'https:') throw new TypeError('branding.logoUrl must be https');
  // `includes`, not `url.hash`: an empty fragment (a trailing `#`) is refused by gateway too
  if (url.username || url.password || value.includes('#')) {
    throw new TypeError('branding.logoUrl must not contain credentials or a fragment');
  }
  return value;
}

/** Validates the branding and returns it with the keys in the order of the spec (gateway 20.3). */
function brandingPayload(branding: CheckoutBranding): Record<string, string> | undefined {
  const allowed = new Set(['companyName', 'logoUrl', 'accentColor', 'theme', 'title']);
  for (const key of Object.keys(branding))
    if (!allowed.has(key)) throw new TypeError(`branding.${key} is not supported`);
  const out: Record<string, string> = {};
  if (branding.companyName !== undefined) out['companyName'] = text(branding.companyName, 'companyName', 64);
  if (branding.logoUrl !== undefined) out['logoUrl'] = logo(branding.logoUrl);
  if (branding.accentColor !== undefined) {
    if (typeof branding.accentColor !== 'string' || !COLOR_RE.test(branding.accentColor)) {
      throw new TypeError('branding.accentColor must be #rrggbb');
    }
    out['accentColor'] = branding.accentColor;
  }
  if (branding.theme !== undefined) {
    if (!['light', 'dark', 'auto'].includes(branding.theme))
      throw new TypeError('branding.theme must be light, dark or auto');
    out['theme'] = branding.theme;
  }
  if (branding.title !== undefined) out['title'] = text(branding.title, 'title', 100);
  return Object.keys(out).length ? out : undefined;
}

/**
 * Signs a checkout token for an invoice, without a network call. Put it after `#` of the payment page URL —
 * or use `psp.checkout.createUrl()`, which does both.
 */
export function createCheckoutToken(input: CreateCheckoutTokenInput): CheckoutToken {
  if (!KEY_RE.test(input.apiKey)) throw new TypeError('apiKey must look like psp_pk_test_ + 24 letters and digits');
  if (typeof input.apiSecret !== 'string' || !API_SECRET_RE.test(input.apiSecret)) {
    throw new TypeError('apiSecret must be the API secret psp_sk_test_ + 36 letters and digits');
  }
  // A secret of the other net would sign a token gateway refuses with bad_signature
  if (netOfCredential(input.apiSecret) !== netOfCredential(input.apiKey)) {
    throw new TypeError('apiSecret must be of the same net as apiKey');
  }
  if (!UUID_RE.test(input.invoiceId)) throw new TypeError('invoiceId must be a lower-case uuid');
  const now = seconds(input.now ?? new Date());
  const expiresAt = input.expiresAt === undefined ? now + CHECKOUT_DEFAULT_TTL_SECONDS : seconds(input.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new TypeError('expiresAt must be in the future');
  if (expiresAt - now > CHECKOUT_MAX_TTL_SECONDS) throw new TypeError('a checkout link lives at most 7 days');
  if (input.locale !== undefined && !['ru', 'en'].includes(input.locale)) {
    throw new TypeError('locale must be ru or en');
  }

  const payloadObject: Record<string, unknown> = { k: input.apiKey, i: input.invoiceId, e: expiresAt };
  const branding = input.branding === undefined ? undefined : brandingPayload(input.branding);
  if (branding !== undefined) payloadObject['b'] = branding;
  if (input.locale !== undefined) payloadObject['l'] = input.locale;

  const payload = Buffer.from(JSON.stringify(payloadObject), 'utf8').toString('base64url');
  const signature = createHmac('sha256', Buffer.from(input.apiSecret, 'utf8'))
    .update(`psp-checkout-v1.${payload}`, 'utf8')
    .digest('base64url');
  return { token: `v1.${payload}.${signature}`, expiresAt };
}

/** Options of `psp.checkout.createUrl()`. */
export interface CheckoutUrlOptions {
  branding?: CheckoutBranding;
  locale?: CheckoutLocale;
  /** Lifetime of the link, seconds: 1 to 604 800 (7 days). Default 86 400 (24 hours). */
  expiresInSeconds?: number;
}

/** A link to the payment page for an iframe. */
export interface CheckoutLink {
  /** `https://pay…/#v1.…` — the `src` of the iframe, or the `url` of `<PspCheckout>` from `@qubiq-psp/react`. */
  url: string;
  /** The token alone (after `#`). */
  token: string;
  /** Expiry of the link, ISO 8601. */
  expiresAt: string;
}

/** `psp.checkout` — links to the payment widget, built locally with the API secret of the client. */
export class CheckoutResource {
  readonly #apiKey: string;
  readonly #apiSecret: string;
  readonly #pageUrl: string | undefined;

  constructor(apiKey: string, apiSecret: string, pageUrl: string | undefined) {
    this.#apiKey = apiKey;
    this.#apiSecret = apiSecret;
    this.#pageUrl = pageUrl;
  }

  /**
   * Builds the payment page link for an invoice: no network call, the token is signed with the API secret.
   * Build it every time you render the order page — branding comes with each call.
   * Build it only for the buyer who owns the order: whoever has the link sees the invoice.
   *
   * ```ts
   * const { url } = psp.checkout.createUrl(invoice, { branding: { companyName: 'My Shop' }, locale: 'en' });
   * ```
   */
  createUrl(invoice: string | { id: string }, options: CheckoutUrlOptions = {}): CheckoutLink {
    if (this.#pageUrl === undefined) {
      throw new TypeError('checkoutUrl is required: pass it to new PspClient({ checkoutUrl }) or set PSP_CHECKOUT_URL');
    }
    const ttl = options.expiresInSeconds ?? CHECKOUT_DEFAULT_TTL_SECONDS;
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > CHECKOUT_MAX_TTL_SECONDS) {
      throw new TypeError(`expiresInSeconds must be an integer from 1 to ${CHECKOUT_MAX_TTL_SECONDS}`);
    }
    const now = Math.floor(Date.now() / 1000);
    const { token, expiresAt } = createCheckoutToken({
      apiKey: this.#apiKey,
      apiSecret: this.#apiSecret,
      invoiceId: typeof invoice === 'string' ? invoice : invoice.id,
      branding: options.branding,
      locale: options.locale,
      expiresAt: now + ttl,
      now,
    });
    const url = new URL(this.#pageUrl);
    url.hash = token;
    return { url: url.href, token, expiresAt: new Date(expiresAt * 1000).toISOString() };
  }
}
