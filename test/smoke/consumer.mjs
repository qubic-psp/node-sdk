// Runs inside a temp project that installed the packed tarball: `node consumer.mjs` (ESM) and, through
// consumer.cjs, the same checks with require(). Exits non-zero on the first failed check.
import { createServer } from 'node:http';

export async function run(sdk, flavor) {
  const { PspClient, signRequest, verifyWebhook, signWebhook, PspApiError, isPspApiError, VERSION } = sdk;
  const assert = (ok, what) => {
    if (!ok) throw new Error(`${flavor}: ${what}`);
  };

  // Signing: vector 1 of gateway 13.5
  const signed = signRequest({
    apiKey: 'psp_pk_3Kd9Lm2Qx7Rt5Vb8Nw1Hc4Zp',
    apiSecret: 'psp_sk_9fT2kQ7mW4xL1vR8nB5cJ3hD6gZ0aY2eUq4N',
    method: 'POST',
    target: '/api/v1/invoices',
    timestamp: '1790683200',
    nonce: '6f1c2a9e-4b7d-4e21-9a3c-8d5f0b2e7c41',
    body: '{"externalId":"order-10530","network":"tron","asset":"USDT","amount":"50","description":"Заказ 10530","metadata":{"orderId":"10530"}}',
  });
  assert(signed.signature === 'v1=e2fda22d1cbec087e2edc769f9bfc2368c29fd43aff2f36822fa19d9396463d9', 'vector 1');

  // Webhook round trip
  const secret = 'psp_sk_9fT2kQ7mW4xL1vR8nB5cJ3hD6gZ0aY2eUq4N';
  const body =
    '{"id":"0b7f3d2e-8c41-4a9b-b6e5-1f2a3c4d5e6f","type":"webhook.test","version":1,"occurredAt":"2026-09-29T12:20:00.214Z","network":"tron","chain":"nile","merchantId":"6a1f3c9e-2b4d-4e8a-9c71-5d0e8f2a4b13","data":{"test":true,"message":"Проверка после смены URL"}}';
  const headers = {
    'x-webhook-id': '0b7f3d2e-8c41-4a9b-b6e5-1f2a3c4d5e6f',
    'x-webhook-event': 'webhook.test',
    'x-webhook-timestamp': '1790684400',
    'x-webhook-signature': signWebhook(secret, '1790684400', body),
  };
  assert(
    headers['x-webhook-signature'] === 'v1=e35e9b0ea7e02ffcff516436483fedda7b1b01e16c65e3d4a7a61274670df250',
    'webhook vector',
  );
  assert(verifyWebhook({ body, headers, secret, now: 1790684400 }).type === 'webhook.test', 'verifyWebhook');

  // A real fetch to a local server: the global fetch of this Node.js works with the SDK
  const server = createServer((req, res) => {
    const conflict = req.url.startsWith('/api/v1/invoices');
    res.writeHead(conflict ? 409 : 200, { 'Content-Type': 'application/json', 'X-Request-Id': 'smoke-1' });
    res.end(
      JSON.stringify(
        conflict
          ? { errorCode: 'invoice_conflict', errorMessage: 'taken', details: { invoiceId: 'i-1' } }
          : { merchantId: 'm-1', serverTime: 1 },
      ),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const psp = new PspClient({
      apiKey: 'psp_pk_test_3Kd9Lm2Qx7Rt5Vb8Nw1Hc4Zp',
      apiSecret: 'psp_sk_test_9fT2kQ7mW4xL1vR8nB5cJ3hD6gZ0aY2eUq4N',
      baseUrl: `http://127.0.0.1:${server.address().port}`,
    });
    assert((await psp.account.get()).merchantId === 'm-1', 'account.get');
    try {
      await psp.invoices.create({ externalId: 'o', network: 'tron', asset: 'USDT', amount: '1' });
      assert(false, 'conflict expected');
    } catch (err) {
      assert(err instanceof PspApiError && isPspApiError(err, 'invoice_conflict'), 'PspApiError instance');
      assert(err.details.invoiceId === 'i-1' && err.requestId === 'smoke-1', 'error details');
    }
  } finally {
    server.close();
  }
  console.log(`${flavor} ok — @qubiq/psp-sdk ${VERSION} on Node.js ${process.version}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await run(await import('@qubiq/psp-sdk'), 'esm');
}
