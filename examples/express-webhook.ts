// Express 4.17+ / 5: the webhook route reads the raw body with express.raw — register it BEFORE app.use(express.json()).
import express from 'express';
import { PspClient, WebhookVerificationError, type WebhookEvent } from '@qubiq/psp-sdk';
import { handleEvent } from './handle-event';

const psp = new PspClient();
const app = express();
const seen = new Set<string>(); // in production: a table with a unique event id

app.post('/psp/webhook', express.raw({ type: 'application/json', limit: '1mb' }), (req, res) => {
  let event: WebhookEvent;
  try {
    event = psp.webhook.verify(req.body as Buffer, req.headers);
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      res.status(err.status).send(err.reason);
      return;
    }
    throw err;
  }
  // Duplicates (retries of a delivered webhook) are acknowledged and skipped
  if (!seen.has(event.id)) {
    seen.add(event.id);
    setImmediate(() => {
      handleEvent(event);
    }); // answer within 10 s, process after
  }
  res.sendStatus(200);
});

app.use(express.json()); // the rest of the API

app.listen(3000, () => {
  console.log('listening on :3000');
});
