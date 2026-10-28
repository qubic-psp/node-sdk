import { paginate } from '../pagination';
import type { RequestOptions, Transport } from '../transport';
import type {
  CancelInvoiceParams,
  CreateInvoiceParams,
  Invoice,
  InvoiceEvent,
  InvoiceWithPayments,
  ListInvoicesParams,
  Page,
  PageParams,
} from '../types';

/** `psp.invoices` — create invoices, read them and their history, cancel them. */
export class InvoicesResource {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /**
   * `POST /api/v1/invoices`: creates an invoice and issues its payment address.
   *
   * Idempotent by `externalId`: the same `externalId` with the same fields returns the invoice created before
   * (`getResponseMeta(invoice).status` is `200` instead of `201`); with other fields — `409 invoice_conflict`.
   * The SDK repeats the call itself after a lost connection or a `503`, with the same body.
   */
  create(params: CreateInvoiceParams, options?: RequestOptions): Promise<Invoice> {
    return this.#transport.call('createInvoice', { body: params, options });
  }

  /** `GET /api/v1/invoices`: one page of invoices, newest first. */
  list(params: ListInvoicesParams = {}, options?: RequestOptions): Promise<Page<Invoice>> {
    return this.#transport.call('listInvoices', { query: { ...params }, options });
  }

  /**
   * All invoices matching the filters, page by page (`limit` per page, 100 by default here):
   * `for await (const invoice of psp.invoices.listAll({ status: 'active' })) { … }`.
   */
  listAll(params: Omit<ListInvoicesParams, 'page'> = {}, options?: RequestOptions): AsyncGenerator<Invoice, void> {
    const limit = params.limit ?? 100;
    return paginate((page) => this.list({ ...params, limit, page }, options));
  }

  /** `GET /api/v1/invoices/{invoiceId}`: the invoice with all its payments. */
  get(invoiceId: string, options?: RequestOptions): Promise<InvoiceWithPayments> {
    return this.#transport.call('getInvoice', { path: { invoiceId }, options });
  }

  /** `GET /api/v1/invoices/{invoiceId}/events`: one page of the history of the invoice, oldest first. */
  listEvents(invoiceId: string, params: PageParams = {}, options?: RequestOptions): Promise<Page<InvoiceEvent>> {
    return this.#transport.call('listInvoiceEvents', { path: { invoiceId }, query: { ...params }, options });
  }

  /** The whole history of the invoice, page by page. */
  listAllEvents(
    invoiceId: string,
    params: Omit<PageParams, 'page'> = {},
    options?: RequestOptions,
  ): AsyncGenerator<InvoiceEvent, void> {
    const limit = params.limit ?? 100;
    return paginate((page) => this.listEvents(invoiceId, { limit, page }, options));
  }

  /**
   * `POST /api/v1/invoices/{invoiceId}/cancel`: cancels an invoice without payments.
   * Idempotent by state: an invoice cancelled before is returned as is. An invoice with payments —
   * `409 invoice_has_payments`; a paid one — `409 invalid_state`.
   */
  cancel(invoiceId: string, params?: CancelInvoiceParams, options?: RequestOptions): Promise<Invoice> {
    return this.#transport.call('cancelInvoice', { path: { invoiceId }, body: params, options });
  }
}
