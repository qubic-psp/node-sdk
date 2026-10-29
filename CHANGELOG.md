# Changelog

All notable changes to `@qubiq-psp/sdk` are documented here. The project follows [Semantic Versioning](https://semver.org/).

## 0.1.1 — 2026-10-29

No code changes: the first release through npm trusted publishing (OIDC) — GitHub Actions stages the version without a stored token, a maintainer approves it with 2FA.

## 0.1.0 — 2026-10-29

First version.

- `PspClient` with the 13 public operations of the merchant API:
  - `account.get`;
  - `invoices.create` / `list` / `listAll` / `get` / `listEvents` / `listAllEvents` / `cancel`;
  - `webhook.get` / `setUrl` / `removeUrl` / `sendTest`;
  - `webhook.deliveries.list` / `listAll` / `get` / `redeliver`.
- HMAC-SHA256 request signing (scheme `v1`), checked against the vectors of the platform. `signRequest()` for custom HTTP clients.
- Automatic retries by the platform rules, with a fresh signature per attempt. Timeouts, `AbortSignal` support, `clientRequestId`.
- Typed errors: `PspApiError` with `isPspApiError(err, code)` narrowing, `PspAuthError` with signature diagnostics, `PspConnectionError` / `PspTimeoutError` with the outcome, `PspUnexpectedResponseError`.
- Webhook verification:
  - `psp.webhook.verify()`, `verifyWebhook()` and `verifyWebhookSignature()`, with the network check and the previous secret;
  - typed `WebhookEvent`;
  - `signWebhook()` for tests.
- `getResponseMeta()`, the `onResponse` / `onRetry` / `onWarning` hooks, and a warning for requests signed with the previous key.
- Payment widget links: `psp.checkout.createUrl(invoice, { branding, locale })` and `createCheckoutToken()` — a token signed offline with the API secret for the platform payment page in an iframe (`@qubiq-psp/react`).
- ESM and CommonJS builds with type declarations, Node.js 18+, no runtime dependencies.
