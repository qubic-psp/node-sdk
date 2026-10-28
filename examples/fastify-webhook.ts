// Fastify 5: a scope with a Buffer parser for JSON, so only the webhook route gets the raw body.
import Fastify from 'fastify';
import { PspClient, WebhookVerificationError } from '@qubiq/psp-sdk';
import { handleEvent } from './handle-event';

const psp = new PspClient();
const app = Fastify();
const seen = new Set<string>(); // in production: a table with a unique event id

void app.register((scope, _opts, done) => {
  scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, parsed) => {
    parsed(null, body);
  });
  scope.post('/psp/webhook', async (req, reply) => {
    try {
      const event = psp.webhook.verify(req.body as Buffer, req.headers);
      if (!seen.has(event.id)) {
        seen.add(event.id);
        setImmediate(() => {
          handleEvent(event);
        });
      }
      return await reply.code(200).send();
    } catch (err) {
      if (err instanceof WebhookVerificationError) return reply.code(err.status).send(err.reason);
      throw err;
    }
  });
  done();
});

app.listen({ port: 3000 }).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
