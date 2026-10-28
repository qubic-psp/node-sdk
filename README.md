# @qubiq/psp-sdk

Node.js SDK for the PSP merchant API. Use it on your backend to accept crypto payments: create invoices, check their state, manage the webhook endpoint, and verify the webhooks the platform sends you.

- Every request is signed with HMAC-SHA256 (scheme `v1`). The SDK handles query encoding, body bytes, timestamps and nonces.
- Failed calls are retried by the platform rules. Retries never create duplicates: invoices are idempotent by `externalId`.
- Errors are typed. `isPspApiError(err, 'invoice_conflict')` narrows `err.details` to the shape of that code.
- Webhooks are verified over the raw bytes in constant time, within a ±300 s window, and returned as typed events.
- No runtime dependencies. It runs on Node.js 18+ and ships ESM and CommonJS builds with TypeScript types.
- It works with any framework or none. There are recipes for Express, Fastify, NestJS and Next.js.

> **Server-side only.** The API secret signs requests and verifies webhooks. Never ship it to a browser or a mobile app.

## Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Frameworks](#frameworks): [NestJS](#nestjs), [Express](#express), [Fastify](#fastify), [Next.js](#nextjs), [plain Node.js](#plain-nodejs)
- [Invoices](#invoices)
- [Payment widget](#payment-widget)
- [Webhooks](#webhooks)
- [Webhook settings and the delivery log](#webhook-settings-and-the-delivery-log)
- [Errors](#errors)
- [Retries and timeouts](#retries-and-timeouts)
- [Request options and response details](#request-options-and-response-details)
- [Logging and monitoring](#logging-and-monitoring)
- [Rotating the API secret](#rotating-the-api-secret)
- [Data formats](#data-formats)
- [Low-level signing](#low-level-signing)
- [TypeScript](#typescript)

## Installation

```bash
npm install @qubiq/psp-sdk
# or: yarn add @qubiq/psp-sdk / pnpm add @qubiq/psp-sdk
```

Requires Node.js 18 or newer: the SDK uses the built-in `fetch` and `node:crypto`.

## Quick start

Take the API key, the API secret and the API URL from the merchant cabinet (**Integration → API keys**). Each network has its own pair: a `psp_pk_test_…` key works only in testnet, a `psp_pk_live_…` key only in mainnet.

```ts
import { PspClient } from '@qubiq/psp-sdk';

const psp = new PspClient({
  apiKey: process.env.PSP_API_KEY, // psp_pk_test_…
  apiSecret: process.env.PSP_API_SECRET, // psp_sk_test_…
  baseUrl: process.env.PSP_API_URL, // the API URL from the cabinet, e.g. https://api.psp.example
});

// 1. Create an invoice for an order. The order id is the externalId: repeating the call never makes a duplicate.
const invoice = await psp.invoices.create({
  externalId: 'order-10530',
  network: 'tron',
  asset: 'USDT',
  amount: '50',
  description: 'Order 10530',
  metadata: { orderId: '10530' },
});

// 2. Show the buyer where and how much to pay.
console.log(
  `Pay ${invoice.amount} ${invoice.asset} (${invoice.network}) to ${invoice.address} before ${invoice.expiresAt}`,
);

// 3. Receive the webhook (raw body bytes + headers) and ship on invoice.paid / invoice.overpaid.
const event = psp.webhook.verify(rawBody, headers);
if (event.type === 'invoice.paid' || event.type === 'invoice.overpaid') {
  await shipOrder(event.data.invoice.externalId);
}
```

`new PspClient()` with no arguments reads `PSP_API_KEY`, `PSP_API_SECRET` and `PSP_API_URL` from the environment. Create one client per API key and reuse it. It keeps no connections of its own.

## Configuration

```ts
const psp = new PspClient({
  apiKey: 'psp_pk_live_…',
  apiSecret: 'psp_sk_live_…',
  baseUrl: 'https://api.psp.example',
  timeoutMs: 180_000,
  maxRetries: 4,
  userAgent: 'my-shop/2.4',
  onWarning: (warning) => logger.warn(warning.message),
});
```

| Option                 | Default                   | Description                                                                                                                                                   |
| ---------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`               | `PSP_API_KEY`             | API key `psp_pk_test_…` / `psp_pk_live_…`. Older keys without the network prefix are testnet keys.                                                            |
| `apiSecret`            | `PSP_API_SECRET`          | API secret of the same key and network. It is never sent: it only keys the HMAC.                                                                              |
| `previousApiSecret`    | `PSP_API_PREVIOUS_SECRET` | Previous secret during a [rotation](#rotating-the-api-secret). Used only by `psp.webhook.verify()`.                                                           |
| `baseUrl`              | `PSP_API_URL`             | API URL. It must be `https://`; plain `http://` is allowed only for `localhost` / `127.0.0.1` / `[::1]`, or anywhere with `allowInsecureHttp`.                |
| `checkoutUrl`          | `PSP_CHECKOUT_URL`        | URL of the payment page for [payment widget](#payment-widget) links, e.g. `https://pay.psp.example`. `https://`, or `http://` on localhost.                   |
| `timeoutMs`            | `180000`                  | Timeout of one attempt. The platform answers any request within 175 s. A shorter timeout can turn a slow success into an [unknown outcome](#unknown-outcome). |
| `maxRetries`           | `4`                       | Retries after the first attempt. `0` turns retries off.                                                                                                       |
| `retryBaseDelayMs`     | `1000`                    | First pause between attempts. It doubles with each retry: 1, 2, 4, 8 s, ±20 % jitter.                                                                         |
| `maxRetryAfterSeconds` | `30`                      | Longest `Retry-After` the SDK waits for by itself. A longer one is thrown as an error with `retryAfterSeconds`.                                               |
| `fetch`                | global `fetch`            | Your own `fetch`, e.g. one that goes through a proxy.                                                                                                         |
| `userAgent`            | —                         | Your product name, prepended to the SDK `User-Agent`.                                                                                                         |
| `allowInsecureHttp`    | `false`                   | Allows `http://` on hosts other than localhost, e.g. for an internal TLS-terminating proxy.                                                                   |
| `onWarning`            | `process.emitWarning`     | Warnings: a request signed with the [previous key](#rotating-the-api-secret), a webhook signed with `previousApiSecret`.                                      |
| `onResponse`           | —                         | Called after every HTTP attempt. See [Logging and monitoring](#logging-and-monitoring).                                                                       |
| `onRetry`              | —                         | Called before every retry.                                                                                                                                    |

The constructor checks the options and throws a `TypeError` with a clear message for:

- a missing or malformed key or secret, or one with surrounding whitespace;
- a key and a secret from different networks;
- a base URL that is not `https`.

Client properties:

- `psp.net` is `'testnet'` or `'mainnet'`, by the key prefix.
- `psp.isLive` is `true` for a mainnet key.
- `psp.apiKey` and `psp.baseUrl` are the values in use.

The secret never shows in `JSON.stringify(psp)` or `console.log(psp)`.

**Testnet and mainnet.** The key decides the network. There is no network option or header. Run two clients with two key pairs if you need both. Each network has its own webhook URL.

## Frameworks

The client is a plain class, so it works in any framework. Webhook verification only needs the **raw body bytes** and the request headers. Every framework recipe below exists to keep those bytes intact. The [`examples/`](examples) folder has complete, type-checked versions.

### NestJS

Register the client as a provider and inject it by its class:

```ts
// psp.module.ts
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PspClient } from '@qubiq/psp-sdk';

@Global()
@Module({
  providers: [
    {
      provide: PspClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new PspClient({
          apiKey: config.getOrThrow('PSP_API_KEY'),
          apiSecret: config.getOrThrow('PSP_API_SECRET'),
          baseUrl: config.getOrThrow('PSP_API_URL'),
        }),
    },
  ],
  exports: [PspClient],
})
export class PspModule {}
```

```ts
// invoices.service.ts
@Injectable()
export class InvoicesService {
  constructor(private readonly psp: PspClient) {}

  createForOrder(orderId: string, amount: string): Promise<Invoice> {
    return this.psp.invoices.create({ externalId: orderId, network: 'tron', asset: 'USDT', amount });
  }
}
```

For webhooks, start the app with `rawBody: true` and verify `req.rawBody`:

```ts
// main.ts
const app = await NestFactory.create(AppModule, { rawBody: true });

// webhook.controller.ts
@Controller('psp')
export class PspWebhookController {
  constructor(private readonly psp: PspClient) {}

  @Post('webhook')
  @HttpCode(200)
  receive(@Req() req: RawBodyRequest<Request>): void {
    if (!req.rawBody) throw new InternalServerErrorException('Start the app with { rawBody: true }');
    try {
      const event = this.psp.webhook.verify(req.rawBody, req.headers);
      // deduplicate by event.id, store, process after answering — see «Webhooks»
    } catch (err) {
      if (err instanceof WebhookVerificationError) throw new HttpException(err.reason, err.status);
      throw err;
    }
  }
}
```

Full example: [`examples/nestjs`](examples/nestjs).

### Express

Read the webhook route with `express.raw`. Register it **before** a global `app.use(express.json())`: once the JSON parser has run, the raw bytes are gone.

```ts
app.post('/psp/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = psp.webhook.verify(req.body, req.headers); // req.body is a Buffer here
    // deduplicate by event.id, store, process after answering
    res.sendStatus(200);
  } catch (err) {
    if (err instanceof WebhookVerificationError) return res.status(err.status).send(err.reason);
    throw err;
  }
});
app.use(express.json());
```

Full example: [`examples/express-webhook.ts`](examples/express-webhook.ts).

### Fastify

Give the webhook route a scope with a `Buffer` parser for JSON:

```ts
app.register((scope, _opts, done) => {
  scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, parsed) => parsed(null, body));
  scope.post('/psp/webhook', async (req, reply) => {
    const event = psp.webhook.verify(req.body as Buffer, req.headers);
    // …
    return reply.code(200).send();
  });
  done();
});
```

Full example: [`examples/fastify-webhook.ts`](examples/fastify-webhook.ts).

### Next.js

In an App Router route handler, read the bytes with `request.arrayBuffer()`, never `request.json()`. Use the Node.js runtime.

```ts
// app/api/psp/webhook/route.ts
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const body = Buffer.from(await request.arrayBuffer());
  try {
    const event = psp.webhook.verify(body, request.headers); // a Fetch Headers object works too
    // …
    return new Response(null, { status: 200 });
  } catch (err) {
    if (err instanceof WebhookVerificationError) return new Response(err.reason, { status: err.status });
    throw err;
  }
}
```

Full example: [`examples/nextjs-route.ts`](examples/nextjs-route.ts).

### Plain Node.js

```ts
import { createServer } from 'node:http';

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    try {
      const event = psp.webhook.verify(Buffer.concat(chunks), req.headers);
      res.writeHead(200).end();
      // process event
    } catch (err) {
      res.writeHead(err instanceof WebhookVerificationError ? err.status : 500).end();
    }
  });
}).listen(3000);
```

## Invoices

An invoice asks the buyer to pay `amount` of `asset` in `network` to `address` before `expiresAt`. Show the address, the amount, the asset, the network and the deadline on your own site, or embed the platform's [payment widget](#payment-widget).

### Create

```ts
const invoice = await psp.invoices.create({
  externalId: 'order-10530', // your order id, 1–128 characters
  network: 'tron', // e.g. tron, base, polygon
  asset: 'USDT',
  amount: '50', // a decimal string, never a number
  description: 'Order 10530', // optional, up to 255 characters
  metadata: { orderId: '10530' }, // optional JSON object, returned in webhooks
});
```

**Idempotency.** Choose the `externalId` before the first attempt and store it with the order.

- The same `externalId` with the same fields returns the invoice created before: status `200` instead of `201`.
- The same `externalId` with different fields fails with `409 invoice_conflict`, and `details.invoiceId` names the existing invoice.

That is why the SDK may safely repeat `create` after a lost connection.

```ts
import { getResponseMeta, isPspApiError } from '@qubiq/psp-sdk';

try {
  const invoice = await psp.invoices.create(params);
  const createdNow = getResponseMeta(invoice)?.status === 201;
} catch (err) {
  if (isPspApiError(err, 'invoice_conflict')) {
    const existing = await psp.invoices.get(err.details.invoiceId);
  } else if (isPspApiError(err, 'amount_out_of_range')) {
    console.log(`Allowed: ${err.details.min} … ${err.details.max ?? '∞'}`);
  } else throw err;
}
```

An expired or cancelled invoice never reopens. For a new payment attempt, create a new invoice with a new `externalId`, e.g. `order-10530-2`.

### Read

```ts
const invoice = await psp.invoices.get(invoiceId); // the invoice with all its payments

const page = await psp.invoices.list({ status: ['active', 'partially_paid'], limit: 20 }); // newest first
// page.items, page.page, page.limit, page.total

for await (const inv of psp.invoices.listAll({ from: new Date('2026-10-01'), network: 'tron' })) {
  // every matching invoice, page by page
}

const history = await psp.invoices.listEvents(invoiceId); // oldest first; listAllEvents() iterates all
```

List filters:

- `status` takes one status or a list.
- `from` is inclusive and `to` is exclusive; both take a `Date` or an ISO string.
- `externalId`, `network` and `asset` filter by exact value.
- `page` starts at 1. `limit` is 1–100, default 50, and `listAll` uses 100.

`listAll` skips an item it has already returned, which happens when a newest-first list shifts while you read it.

### Cancel

```ts
await psp.invoices.cancel(invoiceId, { reason: 'The buyer changed their mind' });
```

Only an invoice without payments can be cancelled. Otherwise the call fails with `409 invoice_has_payments`, or `409 invalid_state` once the invoice is paid. Cancelling twice returns the cancelled invoice.

### Statuses

| `status`          | Meaning                                                              | Final |
| ----------------- | -------------------------------------------------------------------- | ----- |
| `active`          | Waiting for the payment                                              | no    |
| `partially_paid`  | Part of the amount received, the window is open                      | no    |
| `paid`            | The amount received: **ship**                                        | yes   |
| `overpaid`        | More than the amount received: **ship**, the excess is in `overpaid` | yes   |
| `expired`         | The window closed without payments                                   | yes   |
| `expired_partial` | The window closed with an underpayment (`underpaid`)                 | yes   |
| `cancelled`       | Cancelled by you or an admin (`statusReason`)                        | yes   |

## Payment widget

Instead of building your own payment screen, you can show the platform's payment page in an `<iframe>` on your site. The page shows the buyer:

- your logo, company name and accent colour;
- the amount, the network, a QR code and the address with a copy button;
- network warnings, a countdown, and the live payment status.

Your server builds the link, and your frontend embeds it:

```ts
// server: build the link each time you render the order page — no network call
const { url, expiresAt } = psp.checkout.createUrl(invoice, {
  branding: {
    companyName: 'My Shop',
    logoUrl: 'https://shop.example/logo.png', // https only, shown as an image
    accentColor: '#4f46e5',
    theme: 'auto', // light | dark | auto
    title: 'Order #10530',
  },
  locale: 'en', // ru | en; default — the buyer's browser
  expiresInSeconds: 86_400, // default 24 h, at most 7 days
});
// url = https://pay.psp.example/#v1.eyJr…  → send it to your frontend
```

```tsx
// frontend: npm install @qubiq/psp-react
import { PspCheckout } from '@qubiq/psp-react';

<PspCheckout url={url} onPaid={() => showThankYou()} onExpired={() => offerNewInvoice()} />;
// or without React: <iframe src={url} allow="clipboard-write" style="width:100%;border:0"></iframe>
```

How it works:

- **The token.** The link carries a token after `#`. It holds the key id, the invoice id, the expiry, your branding and the locale, and it is signed with your API secret (HMAC-SHA256, its own `psp-checkout-v1.` prefix). The secret is not in the link.
- **No tampering.** Nobody can change the invoice or the branding without breaking the signature. A browser never sends the part after `#` to a server.
- **Data the page shows.** The page shows only what the buyer needs: no `externalId`, `description`, `metadata` or `merchantId`. After the payment window closes, the page hides the address.
- **Lifetime.** Links of the previous key keep working while that key works, 60 minutes after a secret rotation. Revoking the key stops all its links at once. A new link costs nothing, so build one per page view.
- **Shipping.** Ship orders on the `invoice.paid` / `invoice.overpaid` webhook, never on `onPaid` alone: browser events can be faked.

`createCheckoutToken({ apiKey, apiSecret, invoiceId, branding, locale, expiresAt })` builds the bare token, if you assemble the URL yourself. Branding rules:

| Field         | Rule                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `companyName` | 1–64 characters (JavaScript string length), no control characters, no leading or trailing whitespace |
| `title`       | Same rules, up to 100 characters                                                                     |
| `logoUrl`     | `https:` URL up to 1024 characters, no credentials or fragment                                       |
| `accentColor` | `#rrggbb`                                                                                            |
| `theme`       | `light`, `dark` or `auto`                                                                            |

The constructor and `createUrl()` throw a `TypeError` on anything else.

## Webhooks

On every change of an invoice, the platform sends a `POST` to your webhook URL. The body is a full snapshot of the invoice plus the payment that caused the change. The body is signed with your API secret: the same secret that signs your API requests.

```ts
import { WebhookVerificationError } from '@qubiq/psp-sdk';

try {
  const event = psp.webhook.verify(rawBody, headers);
  // 1. drop duplicates: the same event.id comes again on retries
  // 2. store the event (one transaction with the dedup key), answer 2xx within 10 s
  // 3. process it
} catch (err) {
  if (err instanceof WebhookVerificationError) {
    // answer err.status (401 for signature problems, 400 for body problems); do not process
  }
}
```

`psp.webhook.verify(body, headers, options?)` runs these steps in order:

1. `X-Webhook-Timestamp` is digits and within ±300 s of your clock (`toleranceSeconds`). Keep the server clock synced by NTP.
2. `X-Webhook-Signature` is `v1=` plus 64 lower-case hex characters.
3. The HMAC-SHA256 of `timestamp + "." + body` with your secret (or `previousApiSecret`) matches, compared in constant time.
4. The body is JSON, its `id` and `type` equal `X-Webhook-Id` and `X-Webhook-Event`, and its `version` is `1`.
5. The `chain` matches the network of your secret: a `psp_sk_live_…` secret accepts only `mainnet` webhooks, a testnet secret any other chain.
6. With `expectedMerchantId`, the body belongs to that merchant.

Arguments:

- `body` is a `Buffer`, a `Uint8Array` or a string holding the raw request bytes. A re-serialized `JSON.stringify(req.body)` has other bytes and fails with `signature_mismatch`.
- `headers` is a Node.js `req.headers` object (header names in any case) or a Fetch API `Headers`.

`WebhookVerificationError.reason` is one of the following. Signature problems answer `401`, body problems `400`.

| `reason`                       | `status` | Meaning                                                                                                                           |
| ------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `missing_header`               | 401      | `X-Webhook-Timestamp`, `-Signature`, `-Id` or `-Event` is missing                                                                 |
| `bad_timestamp`                | 401      | `X-Webhook-Timestamp` is not digits                                                                                               |
| `timestamp_out_of_window`      | 401      | Your clock and the signature time differ by more than the window                                                                  |
| `bad_signature_header`         | 401      | `X-Webhook-Signature` is malformed                                                                                                |
| `signature_mismatch`           | 401      | Wrong secret (or of another network) or a changed body                                                                            |
| `merchant_mismatch`            | 401      | `expectedMerchantId` differs                                                                                                      |
| `chain_mismatch`               | 401      | A testnet webhook came to a mainnet client or the other way round                                                                 |
| `bad_body`                     | 400      | The body is not a webhook JSON object                                                                                             |
| `id_mismatch`, `type_mismatch` | 400      | The body differs from `X-Webhook-Id` / `X-Webhook-Event`                                                                          |
| `unsupported_version`          | 400      | A body format this SDK version does not know: store the raw body and update the SDK. The platform keeps retrying for about a day. |

Without a client (e.g. in a separate webhook service), use the standalone functions:

```ts
import { verifyWebhook, verifyWebhookSignature } from '@qubiq/psp-sdk';

const event = verifyWebhook({ body, headers, secret: process.env.PSP_API_SECRET! });
const { signedWith, attempt } = verifyWebhookSignature({ body, headers, secret, previousSecret });
```

Both functions refuse to run with a missing or malformed secret, and they throw a `TypeError` rather than verify with it. An empty `previousSecret` (e.g. `PSP_API_PREVIOUS_SECRET=`) means none. The network for the `chain` check comes from the secret prefix.

### Events

Narrow `event` by `type`. Each case has its own `data`:

```ts
switch (event.type) {
  case 'invoice.paid':
  case 'invoice.overpaid':
    ship(event.data.invoice.externalId); // event.data.payment: WebhookPayment
    break;
  case 'invoice.expired':
  case 'invoice.cancelled':
    closeOrder(event.data.invoice.externalId); // event.data.payment: null
    break;
  case 'webhook.test':
    console.log(event.data.message);
    break;
  default:
  // answer 2xx and skip types you do not handle
}
```

| Event                         | When                                                        | Money              | What to do                                                         |
| ----------------------------- | ----------------------------------------------------------- | ------------------ | ------------------------------------------------------------------ |
| `invoice.payment_detected`    | A payment is seen in the network, not final yet             | no                 | Optionally show «payment received, waiting for confirmation»       |
| `invoice.payment_dropped`     | A seen payment will not confirm (`dropReason`)              | no                 | Remove that message; the invoice keeps waiting                     |
| `invoice.payment_held`        | Confirmed, but held by the AML check (`payment.aml.status`) | no                 | Wait; it comes again on every AML change                           |
| `invoice.underpaid`           | Credited, the amount is not complete                        | yes                | Show `invoice.remaining` and `invoice.expiresAt` (may be extended) |
| `invoice.paid`                | The amount is complete                                      | yes                | **Ship** `invoice.externalId`                                      |
| `invoice.overpaid`            | More than the amount                                        | yes                | **Ship**; the excess is `invoice.overpaid`                         |
| `invoice.expired`             | The window closed without payments                          | no                 | Cancel the order or issue a new invoice                            |
| `invoice.expired_partial`     | The window closed with an underpayment                      | `received`         | Agree with the buyer: top-up invoice, partial shipment or refund   |
| `invoice.late_payment`        | Paid after the window closed                                | yes                | The money is on your balance; the invoice does not reopen          |
| `invoice.wrong_asset_payment` | Another asset came to the invoice address                   | yes, in that asset | The invoice is not paid by it; settle with the buyer               |
| `invoice.cancelled`           | Cancelled (`statusReason`)                                  | no                 | Close the order                                                    |
| `webhook.test`                | `psp.webhook.sendTest()` or the cabinet                     | no                 | Verify and answer `2xx`                                            |

### Rules of a robust handler

- **Ship once.** Ship on the first `invoice.paid` or `invoice.overpaid`, and keep a «shipped» flag on the order. `invoice.payment_detected` is not money yet.
- **Deduplicate by `event.id`.** Delivery is at least once: retries carry the same `id` and the same body. Store processed ids under a unique key, in the same transaction that applies the event, and keep them at least 90 days.
- **Apply snapshots in order.** Webhooks of one invoice normally arrive in order, but a manual redelivery can bring an older snapshot later. Apply `data.invoice` only if `event.occurredAt` is later than the last one you applied.
- **Identify payments by `(network, txHash, eventIndex)`**, not by `depositId`.
- **Answer fast.** Any `2xx` within 10 s counts. Store first, process after. Without a `2xx`, the platform retries 12 times over about 24 hours (10 s, 30 s, 1 m, 5 m, 15 m, 30 m, 1 h, 2 h, 4 h, 8 h, 8 h), then marks the delivery `failed`. You can redeliver it.
- **Amounts are decimal strings.** Use `amountRaw` with `BigInt`, or a decimal library, never floating point.

### Testing your handler

`signWebhook()` signs a body the way the platform does, so your tests can send valid webhooks to your own handler:

```ts
import { signWebhook } from '@qubiq/psp-sdk';

const body = JSON.stringify(fakeEvent);
const timestamp = Math.floor(Date.now() / 1000);
await request(app)
  .post('/psp/webhook')
  .set('Content-Type', 'application/json')
  .set('X-Webhook-Id', fakeEvent.id)
  .set('X-Webhook-Event', fakeEvent.type)
  .set('X-Webhook-Timestamp', String(timestamp))
  .set('X-Webhook-Signature', signWebhook(testSecret, timestamp, body))
  .send(body);
```

For an end-to-end check on testnet, call `await psp.webhook.sendTest({ message: 'Hello' })`. The result is the delivery with the attempt, your endpoint's HTTP status and its answer.

## Webhook settings and the delivery log

```ts
await psp.webhook.setUrl('https://shop.example/psp/webhook'); // https, public CA certificate, no redirects
const settings = await psp.webhook.get(); // URL, secret state, deliveryState, failures, queue
await psp.webhook.removeUrl(); // new webhooks wait (up to 7 days) for a new URL

const test = await psp.webhook.sendTest({ message: 'Hello' }); // at most once per 10 s

const failed = await psp.webhook.deliveries.list({ status: 'failed', type: ['invoice.paid', 'invoice.overpaid'] });
const delivery = await psp.webhook.deliveries.get(deliveryId); // body + every attempt with your answer
await psp.webhook.deliveries.redeliver(deliveryId); // a new cycle for a delivered, failed or expired delivery
```

`setUrl()` and `removeUrl()` may answer with `202` and `settings.sync.state === 'pending'`. In that case the platform finishes the change itself: read the result later with `get()`, and do not repeat the call.

## Errors

Every error the SDK throws extends `PspError`:

| Class                                            | When                                                                 | Useful fields                                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `PspApiError`                                    | The API answered with an error                                       | `status`, `errorCode`, `details`, `requestId`, `retryAfterSeconds`, `is(code)` |
| `PspAuthError` (extends `PspApiError`)           | `401 api_auth_failed`: the signature was refused                     | `reason`, `localStringToSign`, `serverStringToSign`, `clockSkewSeconds`        |
| `PspConnectionError`                             | No answer: the connection failed or broke                            | `outcome`: `'not_sent'` or `'unknown'`                                         |
| `PspTimeoutError` (extends `PspConnectionError`) | No answer within `timeoutMs`                                         | `timeoutMs`, `outcome: 'unknown'`                                              |
| `PspUnexpectedResponseError`                     | Not an API answer: a redirect, an HTML page of a proxy, invalid JSON | `status`, `body`, `requestId`                                                  |
| `WebhookVerificationError`                       | An incoming webhook failed verification                              | `reason`, `status`                                                             |

Every error from a request has `err.context`: the `operationId`, the method, the URL and the number of attempts made.

Branch on `errorCode` and `details`, never on the message. `isPspApiError(err, code)` (or `err.is(code)`) narrows `details` to the shape of that code:

```ts
if (isPspApiError(err, 'amount_out_of_range')) err.details.min; // string
if (isPspApiError(err, 'too_many_requests')) err.details.retryAfterSeconds; // number
```

| HTTP | `errorCode`                                        | `details`                                         | What to do                                             |
| ---- | -------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| 400  | `invalid_schema`                                   | `{ fields: [{ field, message }] }`                | Fix the request                                        |
| 400  | `unknown_network`, `unknown_asset`                 | `{ network }`, `{ network, asset }`               | Use a connected network and asset                      |
| 400  | `network_disabled`, `asset_disabled`               | `{ network, asset?, operation }`                  | Another asset, or later                                |
| 400  | `amount_out_of_range`                              | `{ network, asset, min, max, actual }`            | An amount from `min` to `max`                          |
| 400  | `invalid_url`                                      | `{ field: 'url', reason }`                        | Fix the webhook URL                                    |
| 401  | `api_auth_failed`                                  | `{ reason, header?, serverTime?, stringToSign? }` | See [below](#signature-errors); do not retry in a loop |
| 403  | `ip_not_allowed`                                   | `{ ip }`                                          | Add the IP to the allowlist in the cabinet             |
| 403  | `merchant_blocked`, `merchant_closed`              | `null`                                            | Contact support                                        |
| 403  | `merchant_restricted`                              | `{ capability }`                                  | The right is off: contact support                      |
| 404  | `not_found`                                        | `{ object, id }`                                  | Wrong id, or an object of another merchant             |
| 409  | `invoice_conflict`                                 | `{ invoiceId }`                                   | Read that invoice, or use a new `externalId`           |
| 409  | `invalid_state`                                    | `{ object, id, status, allowed }`                 | Read the object: the change is not possible now        |
| 409  | `invoice_has_payments`                             | `{ received, pending, held }`                     | Do not cancel: wait for the outcome                    |
| 409  | `tariff_not_configured`                            | `{ operationType, network, asset }`               | Contact support                                        |
| 409  | `url_not_set`, `secret_not_set`, `merchant_paused` | `null`                                            | Set the URL / retry in a minute / contact support      |
| 409  | `net_not_configured`                               | `{ net }`                                         | The network of the key is not set up yet               |
| 413  | `payload_too_large`                                | `{ maxBytes }`                                    | Bodies are limited to 64 KiB                           |
| 429  | `too_many_requests`                                | `{ scope, limit, retryAfterSeconds }`             | Wait `retryAfterSeconds`                               |
| 500  | `internal_error`                                   | `null`                                            | Retried once; report `requestId` to support            |
| 503  | `maintenance`                                      | `{ message }`                                     | Planned works; retry after `retryAfterSeconds` (300)   |
| 503  | `service_unavailable`                              | `null` or `{ outcome: 'unknown' }`                | Retried automatically                                  |
| 503  | `address_pool_unavailable`                         | `{ network }`                                     | Retried automatically with the same `externalId`       |
| 503  | `operations_paused`                                | `{ flag, reason }`                                | The platform paused the operation: retry later         |
| 503  | `net_unavailable`                                  | `{ net }`                                         | Retried automatically                                  |

New codes and new `details` fields may appear in new platform versions. Handle unknown codes generically.

### Signature errors

`PspAuthError` explains a refused signature:

- `timestamp_out_of_window` means the server clock is off. `clockSkewSeconds` tells by how much: sync the clock with NTP. The SDK retries this error once with a fresh timestamp, which covers a platform restart.
- `bad_signature` with `serverStringToSign !== localStringToSign` means something between you and the platform changed the path or the query, such as a proxy. The message names the first differing line.
- `bad_signature` with equal strings means the secret is wrong.
- `unknown_key` means the key does not exist in this network: check `test_` versus `live_`.
- `key_revoked` means the key was replaced: take the new pair from the cabinet.

### Unknown outcome

`PspConnectionError` with `outcome: 'unknown'`, `PspTimeoutError`, and `503 service_unavailable` with `details.outcome === 'unknown'` all mean the request may have been applied. For `invoices.create`, repeat it with the **same** `externalId` and fields. You get the invoice that was created, never a second one. `outcome: 'not_sent'` (connection refused, DNS failure) means the request surely did not reach the platform.

## Retries and timeouts

The SDK repeats a failed attempt by itself, following the platform rules, with a new timestamp, nonce and signature each time. The body and `externalId` stay the same bytes.

| Method                                                                                          | Repeated automatically                                                                  |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `account.get`, `invoices.list` / `get` / `listEvents`, `webhook.get`, `deliveries.list` / `get` | yes                                                                                     |
| `invoices.create`                                                                               | yes: same `externalId`, no duplicates                                                   |
| `invoices.cancel`                                                                               | yes: idempotent by state                                                                |
| `webhook.setUrl`, `webhook.removeUrl`                                                           | yes: the same URL is a no-op; `202` is a success                                        |
| `deliveries.redeliver`                                                                          | at most once                                                                            |
| `webhook.sendTest`                                                                              | only if it surely did not run (`not_sent`, `503 service_unavailable` without `outcome`) |

Errors that trigger a retry:

- connection errors and timeouts;
- `503 service_unavailable`, `address_pool_unavailable` and `net_unavailable`;
- `502`, `503` and `504` without an API body (a proxy);
- `500 internal_error`, once;
- `429` and `503 maintenance`, after `Retry-After`, when it is at most `maxRetryAfterSeconds` (30 s);
- `401 timestamp_out_of_window`, once.

Never retried: `400`, `403`, `404`, `409`, any other `401`, `503 operations_paused`, and TLS certificate errors.

Pauses: 1, 2, 4, 8 s (`retryBaseDelayMs` doubled per retry, ±20 % jitter), up to `maxRetries` (4) retries. Then the last error is thrown, and `err.context.attempts` tells how many attempts were made.

## Request options and response details

Every method takes `RequestOptions` as its last argument:

```ts
const controller = new AbortController();
const invoice = await psp.invoices.create(params, {
  clientRequestId: 'shop-req-10530', // X-Client-Request-Id: shown in the action log of the cabinet
  signal: controller.signal, // aborts the call and pending retries
  timeoutMs: 60_000, // per call
  maxRetries: 0, // per call
});
```

`getResponseMeta(result)` returns the HTTP details of any object an SDK method returned:

```ts
const meta = getResponseMeta(invoice);
meta?.status; // 201 created now, 200 created earlier
meta?.requestId; // X-Request-Id: give it to support
meta?.attempts; // attempts made, retries included
meta?.headers; // all response headers
```

## Logging and monitoring

```ts
const psp = new PspClient({
  onResponse: ({ operationId, status, requestId, attempt, durationMs }) =>
    logger.info({ operationId, status, requestId, attempt, durationMs }, 'psp call'),
  onRetry: ({ operationId, attempt, delayMs, error }) =>
    logger.warn({ operationId, attempt, delayMs, err: error.message }, 'psp retry'),
  onWarning: (warning) => logger.warn(warning, warning.message),
});
```

The SDK never logs by itself. Warnings go to `onWarning`, which defaults to `process.emitWarning`. Errors thrown from a hook are ignored.

## Rotating the API secret

After you rotate the secret in the cabinet:

1. **API requests.** The previous key keeps working for 60 minutes. A request signed with it gets the `X-Api-Key-Deprecated` header, and the SDK reports it once through `onWarning` (`code: 'deprecated_api_key'`, `validUntil`). `account.get()` shows it too: `apiKey.status === 'previous'`. Deploy the new key and secret within that time.
2. **Webhooks.** Deliveries pause for 60 minutes, then go out signed with the new secret. An attempt that started before the change is still signed with the old one. During the switch, verify with both:

   ```ts
   new PspClient({ apiKey: newKey, apiSecret: newSecret, previousApiSecret: oldSecret });
   ```

   While a webhook still matches the old secret, the client warns once through `onWarning` (`code: 'webhook_previous_secret'`). `verifyWebhookSignature()` reports it as `signedWith: 'previous'`. Remove `previousApiSecret` after the switch, about an hour later: as long as it is set, it keeps working.

If the secret leaked, rotate it and switch at once, **without** `previousApiSecret`: whoever holds the leaked secret could sign webhooks with it.

## Data formats

- **Amounts** are decimal strings in units of the asset: `"50"`, `"0.5"`, `"0"`. `amountRaw` is the integer in minimal units (`"50000000"` for 50 USDT with `decimals: 6`) and is the source of truth. Send amounts as strings: a JSON number is refused.
- **Times** are ISO 8601 UTC with milliseconds: `"2026-09-29T12:00:00.000Z"`.
- **Ids** are lower-case UUIDs.
- **Networks** are open sets: `network` is a code like `tron`, `base` or `polygon`, and `chain` is `mainnet` for real money or a testnet like `nile`, `base-sepolia` or `polygon-amoy`.
- **Missing values.** Every documented field is always present, and an absent value is `null`.
- **New fields.** New fields and enum values may be added without a version change, so ignore what you do not know.

## Low-level signing

If you call the API with your own HTTP client, `signRequest()` produces the four signature headers:

```ts
import { signRequest } from '@qubiq/psp-sdk';

const body = JSON.stringify(params); // serialize once: sign and send the same bytes
const { headers } = signRequest({ apiKey, apiSecret, method: 'POST', target: '/api/v1/invoices', body });
// headers: X-Api-Key, X-Api-Timestamp, X-Api-Nonce, X-Api-Signature
```

The signature covers four things:

- `target` is the path and query **exactly as they are sent**. Join list values with a literal comma (`status=active,paid`), because `URLSearchParams` would send `%2C`, which is a different string.
- The body bytes.
- A timestamp in Unix seconds.
- A single-use nonce.

Sign every retry anew. `buildStringToSign()` shows the exact string that gets signed.

## TypeScript

The SDK is written in strict TypeScript, and every request and response is typed. The public types are exported:

- `Invoice`, `InvoiceWithPayments`, `InvoicePayment`, `InvoiceStatus`;
- `WebhookSettings`, `Delivery`, `DeliveryWithAttempts`;
- `WebhookEvent`, `WebhookPayment`;
- `PspErrorCode`, `PspErrorDetailsMap`;
- `PspClientOptions`, `RequestOptions` and the rest.

Each release checks these types against the platform OpenAPI schema.

## Versioning

The SDK follows [Semantic Versioning](https://semver.org/). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
