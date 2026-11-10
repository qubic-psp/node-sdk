# Changelog

All notable changes to `@qubiq-psp/sdk` are documented here. The project follows [Semantic Versioning](https://semver.org/).

## 0.2.1 — 2026-11-10

No code changes: the GitHub organization was renamed from `qubic-psp` to `qubiq-psp`. `repository`, `homepage` and `bugs` in `package.json` point to `github.com/qubiq-psp`, so npm provenance matches the repository the package is built from. This release also validates the npm trusted publisher of the renamed organization.

## 0.2.0 — 2026-11-10

### Breaking

- The error code `merchant_closed` is gone: the platform no longer closes single merchants. It is replaced by two `403` codes, both with `details: null`:
  - `merchant_archived` — the owner archived the merchant in the cabinet (it can restore it there);
  - `account_closed` — the user who owns the merchant is closed.

Migration: wherever you match `merchant_closed` (`isPspApiError(err, 'merchant_closed')`, a `switch` on `err.errorCode`), match `merchant_archived` and `account_closed` instead — `isPspApiError(err, 'merchant_closed')` no longer compiles, but a comparison of `err.errorCode` with the string does, so search the code for it. Both mean that the API key gets no answer until the merchant is restored (`merchant_archived`) or never again (`account_closed`): stop creating invoices with that key and alert a person; do not retry.

### Changed

- `api/openapi.v1.json` and `src/generated/schema.d.ts` are synced with the current public OpenAPI of the platform.

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
