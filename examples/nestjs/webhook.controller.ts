// The webhook endpoint. Needs NestFactory.create(AppModule, { rawBody: true }) — see main.ts.
import { Controller, HttpCode, HttpException, InternalServerErrorException, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PspClient, WebhookVerificationError } from '@qubiq/psp-sdk';
import { handleEvent } from '../handle-event';

@Controller('psp')
export class PspWebhookController {
  private readonly seen = new Set<string>(); // in production: a table with a unique event id

  constructor(private readonly psp: PspClient) {}

  @Post('webhook')
  @HttpCode(200)
  receive(@Req() req: RawBodyRequest<Request>): void {
    if (!req.rawBody) throw new InternalServerErrorException('Start the app with { rawBody: true }');
    try {
      const event = this.psp.webhook.verify(req.rawBody, req.headers);
      if (this.seen.has(event.id)) return;
      this.seen.add(event.id);
      setImmediate(() => {
        handleEvent(event);
      });
    } catch (err) {
      if (err instanceof WebhookVerificationError) throw new HttpException(err.reason, err.status);
      throw err;
    }
  }
}
