// The 13 operations of the merchant API the SDK covers (owner decision 2026-10-28: the public /docs set).
// src/routes.test.ts checks this table against api/openapi.v1.json, the copy of the gateway spec.

/**
 * Retry rule of an operation (gateway docs/13-merchant-api.md, 13.10):
 * - `safe` — repeat after a connection error, a timeout or a retryable answer (reads, idempotent writes);
 * - `once` — at most one repeat, only when the connection broke before an answer;
 * - `never` — every call is a new action on the platform.
 */
export type RetryRule = 'safe' | 'once' | 'never';

/** One operation: HTTP method, path template with `{param}` placeholders, retry rule. */
export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  retry: RetryRule;
}

export const ROUTES = {
  getAccount: { method: 'GET', path: '/api/v1/account', retry: 'safe' },
  createInvoice: { method: 'POST', path: '/api/v1/invoices', retry: 'safe' },
  listInvoices: { method: 'GET', path: '/api/v1/invoices', retry: 'safe' },
  getInvoice: { method: 'GET', path: '/api/v1/invoices/{invoiceId}', retry: 'safe' },
  listInvoiceEvents: { method: 'GET', path: '/api/v1/invoices/{invoiceId}/events', retry: 'safe' },
  cancelInvoice: { method: 'POST', path: '/api/v1/invoices/{invoiceId}/cancel', retry: 'safe' },
  getWebhookSettings: { method: 'GET', path: '/api/v1/webhook', retry: 'safe' },
  setWebhookUrl: { method: 'PUT', path: '/api/v1/webhook', retry: 'safe' },
  removeWebhookUrl: { method: 'DELETE', path: '/api/v1/webhook', retry: 'safe' },
  sendTestWebhook: { method: 'POST', path: '/api/v1/webhook/test', retry: 'never' },
  listDeliveries: { method: 'GET', path: '/api/v1/webhook/deliveries', retry: 'safe' },
  getDelivery: { method: 'GET', path: '/api/v1/webhook/deliveries/{deliveryId}', retry: 'safe' },
  redeliverDelivery: { method: 'POST', path: '/api/v1/webhook/deliveries/{deliveryId}/redeliver', retry: 'once' },
} as const satisfies Record<string, Route>;

/** operationId of one of the covered operations. */
export type OperationId = keyof typeof ROUTES;
