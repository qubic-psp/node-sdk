import type { RequestOptions, Transport } from '../transport';
import type { Account } from '../types';

/** `psp.account` — the merchant behind the API key. */
export class AccountResource {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /**
   * `GET /api/v1/account`: merchant, status, rights, the key of the request and the server time.
   * A cheap way to check the key, the secret, the IP allowlist and the clock.
   */
  get(options?: RequestOptions): Promise<Account> {
    return this.#transport.call('getAccount', { options });
  }
}
