// What a webhook handler does with a verified event. Shared by the framework examples.
import type { Invoice, WebhookEvent } from '@qubiq-psp/sdk';

/** Last applied snapshot per invoice: webhooks of one invoice may come out of order after a manual redelivery. */
const lastApplied = new Map<string, string>();

function isNewer(invoice: Invoice, occurredAt: string): boolean {
  const last = lastApplied.get(invoice.id);
  if (last !== undefined && last >= occurredAt) return false;
  lastApplied.set(invoice.id, occurredAt);
  return true;
}

export function handleEvent(event: WebhookEvent): void {
  switch (event.type) {
    case 'webhook.test':
      console.log(`test webhook: ${event.data.message}`);
      return;
    case 'invoice.paid':
    case 'invoice.overpaid':
      // Money is credited: ship the order once (keep a «shipped» flag next to the order)
      if (isNewer(event.data.invoice, event.occurredAt)) console.log(`ship order ${event.data.invoice.externalId}`);
      return;
    case 'invoice.underpaid':
      console.log(
        `order ${event.data.invoice.externalId}: ${event.data.invoice.remaining} left until ${event.data.invoice.expiresAt}`,
      );
      return;
    case 'invoice.payment_detected':
      // Not money yet: you may show «payment received, waiting for confirmation»
      console.log(`order ${event.data.invoice.externalId}: payment ${event.data.payment.txHash} seen`);
      return;
    case 'invoice.payment_held':
      console.log(
        `order ${event.data.invoice.externalId}: payment on AML check (${String(event.data.payment.aml.status)})`,
      );
      return;
    case 'invoice.expired':
    case 'invoice.expired_partial':
    case 'invoice.cancelled':
      if (isNewer(event.data.invoice, event.occurredAt))
        console.log(`order ${event.data.invoice.externalId}: ${event.data.invoice.status}`);
      return;
    default:
      // invoice.payment_dropped, invoice.late_payment, invoice.wrong_asset_payment and types added later:
      // acknowledge with 2xx and handle when needed
      console.log(`event ${event.type} for invoice ${event.data.invoice.id}`);
  }
}
