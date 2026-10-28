import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { InvoicesService } from './invoices.service';
import { PspModule } from './psp.module';
import { PspWebhookController } from './webhook.controller';

@Module({ imports: [PspModule], controllers: [PspWebhookController], providers: [InvoicesService] })
class AppModule {}

async function bootstrap(): Promise<void> {
  // rawBody: true keeps the raw bytes next to the parsed JSON: the webhook signature is checked over them
  const app = await NestFactory.create(AppModule, { rawBody: true });
  await app.listen(3000);
}

void bootstrap();
