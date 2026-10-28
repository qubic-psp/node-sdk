import { CheckoutResource } from './checkout';
import { resolveConfig, type PspClientOptions, type PspNet } from './config';
import { AccountResource } from './resources/account';
import { InvoicesResource } from './resources/invoices';
import { WebhookSettingsResource } from './resources/webhook';
import { Transport } from './transport';
import { VERSION } from './version';
import { verifyWebhook } from './webhooks/verify';

function sdkUserAgent(): string {
  const node = typeof process === 'undefined' ? 'unknown' : process.version;
  return `psp-sdk-node/${VERSION} node/${node}`;
}

/**
 * Client of the PSP merchant API. Create one per API key and reuse it: it holds no connections of its own.
 *
 * ```ts
 * const psp = new PspClient({ apiKey, apiSecret, baseUrl: 'https://api.psp.example' });
 * const invoice = await psp.invoices.create({ externalId: 'order-10530', network: 'tron', asset: 'USDT', amount: '50' });
 * ```
 */
export class PspClient {
  /** The merchant behind the key. */
  readonly account: AccountResource;
  /** Invoices: create, read, history, cancel. */
  readonly invoices: InvoicesResource;
  /** Webhook URL, test webhook, delivery log, verification of incoming webhooks. */
  readonly webhook: WebhookSettingsResource;
  /** Links to the payment widget (an iframe page), built locally with the API secret. */
  readonly checkout: CheckoutResource;
  /** Network of the key: `mainnet` for `psp_pk_live_…`, otherwise `testnet`. */
  readonly net: PspNet;
  /** Base URL of the API, normalized. */
  readonly baseUrl: string;
  readonly #apiKey: string;

  constructor(options: PspClientOptions = {}) {
    const config = resolveConfig(options, sdkUserAgent());
    const transport = new Transport(config);
    this.net = config.net;
    this.baseUrl = config.baseUrl;
    this.#apiKey = config.apiKey;
    this.account = new AccountResource(transport);
    this.checkout = new CheckoutResource(config.apiKey, config.apiSecret, config.checkoutUrl);
    this.invoices = new InvoicesResource(transport);
    let warnedPreviousSecret = false;
    this.webhook = new WebhookSettingsResource(transport, (body, headers, verifyOptions) =>
      verifyWebhook({
        ...verifyOptions,
        body,
        headers,
        secret: config.apiSecret,
        previousSecret: config.previousApiSecret,
        onPreviousSecret: () => {
          if (warnedPreviousSecret) return;
          warnedPreviousSecret = true;
          config.onWarning({
            code: 'webhook_previous_secret',
            message: 'A webhook was signed with previousApiSecret: finish the rotation and remove previousApiSecret',
          });
        },
      }),
    );
  }

  /** `true` for a mainnet key: real money. */
  get isLive(): boolean {
    return this.net === 'mainnet';
  }

  /** The API key, `psp_pk_…` (not a secret). */
  get apiKey(): string {
    return this.#apiKey;
  }

  /** The client never shows its secret: not in `JSON.stringify`, not in `console.log`. */
  toJSON(): { baseUrl: string; net: PspNet; apiKey: string } {
    return { baseUrl: this.baseUrl, net: this.net, apiKey: this.#apiKey };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `PspClient { baseUrl: '${this.baseUrl}', net: '${this.net}', apiKey: '${this.#apiKey}' }`;
  }
}
