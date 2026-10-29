// Creates an invoice and prints what to show to the buyer.
//   PSP_API_KEY=psp_pk_test_… PSP_API_SECRET=psp_sk_test_… PSP_API_URL=https://… npx tsx examples/create-invoice.ts order-10530
import { PspClient, PspConnectionError, getResponseMeta, isPspApiError } from '@qubiq-psp/sdk';

const psp = new PspClient(); // reads PSP_API_KEY, PSP_API_SECRET and PSP_API_URL

async function createInvoice(orderId: string): Promise<void> {
  try {
    // The order id is the externalId: a retry with the same id returns the same invoice, never a duplicate
    const invoice = await psp.invoices.create(
      {
        externalId: orderId,
        network: 'tron',
        asset: 'USDT',
        amount: '50',
        description: `Order ${orderId}`,
        metadata: { orderId },
      },
      { clientRequestId: `create-${orderId}` },
    );
    console.log(getResponseMeta(invoice)?.status === 201 ? 'created' : 'already existed', invoice.id);
    console.log(
      `Pay ${invoice.amount} ${invoice.asset} in ${invoice.network} to ${invoice.address} before ${invoice.expiresAt}`,
    );
  } catch (err) {
    if (isPspApiError(err, 'invoice_conflict')) {
      const existing = await psp.invoices.get(err.details.invoiceId);
      console.error(`order ${orderId} already has invoice ${existing.id} with other fields (${existing.status})`);
    } else if (isPspApiError(err, 'amount_out_of_range')) {
      console.error(`the amount must be from ${err.details.min} to ${err.details.max ?? 'any'} ${err.details.asset}`);
    } else if (err instanceof PspConnectionError && err.outcome === 'unknown') {
      console.error('the outcome is unknown: run again with the same order id, it will not create a duplicate');
    } else {
      throw err;
    }
  }
}

createInvoice(process.argv[2] ?? 'order-10530').catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
