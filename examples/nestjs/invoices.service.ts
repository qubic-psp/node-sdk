import { Injectable } from '@nestjs/common';
import { PspClient, type Invoice } from '@qubiq-psp/sdk';

@Injectable()
export class InvoicesService {
  constructor(private readonly psp: PspClient) {}

  /** One invoice per order: the order id is the externalId, so a retry never makes a duplicate. */
  createForOrder(orderId: string, amount: string): Promise<Invoice> {
    return this.psp.invoices.create({ externalId: orderId, network: 'tron', asset: 'USDT', amount });
  }
}
