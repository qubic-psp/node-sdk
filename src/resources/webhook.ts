import { paginate } from '../pagination';
import type { RequestOptions, Transport } from '../transport';
import type {
  Delivery,
  DeliveryWithAttempts,
  ListDeliveriesParams,
  Page,
  SendTestWebhookParams,
  WebhookSettings,
} from '../types';

/** `psp.webhook.deliveries` — the log of webhook deliveries to your endpoint. */
export class DeliveriesResource {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /** `GET /api/v1/webhook/deliveries`: one page of deliveries, newest first. */
  list(params: ListDeliveriesParams = {}, options?: RequestOptions): Promise<Page<Delivery>> {
    return this.#transport.call('listDeliveries', { query: { ...params }, options });
  }

  /** All deliveries matching the filters, page by page (100 per page by default here). */
  listAll(params: Omit<ListDeliveriesParams, 'page'> = {}, options?: RequestOptions): AsyncGenerator<Delivery, void> {
    const limit = params.limit ?? 100;
    return paginate((page) => this.list({ ...params, limit, page }, options));
  }

  /** `GET /api/v1/webhook/deliveries/{deliveryId}`: the delivery with its body and every attempt. */
  get(deliveryId: string, options?: RequestOptions): Promise<DeliveryWithAttempts> {
    return this.#transport.call('getDelivery', { path: { deliveryId }, options });
  }

  /**
   * `POST /api/v1/webhook/deliveries/{deliveryId}/redeliver`: a new cycle of attempts for a `delivered`, `failed`
   * or `expired` delivery. Whether a new cycle started shows in `cycle` and `redeliveries`.
   */
  redeliver(deliveryId: string, options?: RequestOptions): Promise<Delivery> {
    return this.#transport.call('redeliverDelivery', { path: { deliveryId }, options });
  }
}

/**
 * `psp.webhook` — the callback URL, the test webhook and the delivery log. Incoming webhooks are checked with
 * `psp.webhook.verify()`.
 */
export class WebhookSettingsResource {
  readonly #transport: Transport;
  readonly deliveries: DeliveriesResource;

  constructor(transport: Transport) {
    this.#transport = transport;
    this.deliveries = new DeliveriesResource(transport);
  }

  /** `GET /api/v1/webhook`: the URL, the secret state and the delivery state. */
  get(options?: RequestOptions): Promise<WebhookSettings> {
    return this.#transport.call('getWebhookSettings', { options });
  }

  /**
   * `PUT /api/v1/webhook`: sets the callback URL (https, public CA certificate, no redirects).
   * Status `202` (`getResponseMeta`) with `sync.state: 'pending'` — the platform finishes the change itself:
   * read the result later with `get()`, do not repeat the call.
   */
  setUrl(url: string, options?: RequestOptions): Promise<WebhookSettings> {
    return this.#transport.call('setWebhookUrl', { body: { url }, options });
  }

  /** `DELETE /api/v1/webhook`: removes the URL; new webhooks wait (up to 7 days) for a new one. */
  removeUrl(options?: RequestOptions): Promise<WebhookSettings> {
    return this.#transport.call('removeWebhookUrl', { options });
  }

  /**
   * `POST /api/v1/webhook/test`: sends a `webhook.test` to your URL and returns the delivery with the attempt.
   * At most once per 10 s (`429`). Never repeated automatically after a possible delivery: on an unknown outcome
   * look for it with `deliveries.list({ kind: 'test' })`.
   */
  sendTest(params?: SendTestWebhookParams, options?: RequestOptions): Promise<DeliveryWithAttempts> {
    return this.#transport.call('sendTestWebhook', { body: params, options });
  }
}
