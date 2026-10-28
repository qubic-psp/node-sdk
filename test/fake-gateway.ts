// A local HTTP server in place of gateway for the tests: checks the v1 signature of every request the way the
// gateway guard does (its own HMAC code, not the SDK one), remembers nonces and answers with scripted replies.
import { createHash, createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const KEY = 'psp_pk_test_3Kd9Lm2Qx7Rt5Vb8Nw1Hc4Zp';
export const SECRET = 'psp_sk_test_9fT2kQ7mW4xL1vR8nB5cJ3hD6gZ0aY2eUq4N';

export interface RecordedRequest {
  method: string;
  /** The request-target as it arrived: path and query. */
  target: string;
  headers: IncomingMessage['headers'];
  body: string;
  /** The signature matches the request as it arrived. */
  signatureValid: boolean;
  /** The nonce was seen before. */
  nonceReused: boolean;
  stringToSign: string;
}

/** A scripted reply: status, JSON body (or a raw string), headers, delay before answering. */
export interface Reply {
  status?: number;
  json?: unknown;
  raw?: string;
  headers?: Record<string, string>;
  delayMs?: number;
}

export type Handler = (req: RecordedRequest) => Reply;

export interface FakeGateway {
  url: string;
  requests: RecordedRequest[];
  /** Replies for the next requests, in order; after them `fallback` answers. */
  queue: Reply[];
  fallback: Handler;
  close(): Promise<void>;
}

const sha256 = (data: string): string => createHash('sha256').update(data, 'utf8').digest('hex');

function verify(req: IncomingMessage, body: string, seen: Set<string>): Omit<RecordedRequest, 'headers' | 'body'> {
  const method = req.method ?? '';
  const target = req.url ?? '';
  const ts = String(req.headers['x-api-timestamp'] ?? '');
  const nonce = String(req.headers['x-api-nonce'] ?? '');
  const stringToSign = ['v1', method, target, ts, nonce, sha256(body)].join('\n');
  const expected = `v1=${createHmac('sha256', SECRET).update(stringToSign, 'utf8').digest('hex')}`;
  const nonceReused = seen.has(nonce);
  seen.add(nonce);
  return {
    method,
    target,
    stringToSign,
    nonceReused,
    signatureValid: req.headers['x-api-key'] === KEY && req.headers['x-api-signature'] === expected,
  };
}

export async function startFakeGateway(fallback: Handler = () => ({ json: { ok: true } })): Promise<FakeGateway> {
  const seen = new Set<string>();
  const sockets = new Set<import('node:net').Socket>();
  const gateway: Omit<FakeGateway, 'url' | 'close'> = { requests: [], queue: [], fallback };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const recorded: RecordedRequest = { ...verify(req, body, seen), headers: req.headers, body };
      gateway.requests.push(recorded);
      const reply = gateway.queue.shift() ?? gateway.fallback(recorded);
      const send = (): void => {
        if (res.destroyed) return;
        const payload = reply.raw ?? (reply.json === undefined ? '' : JSON.stringify(reply.json));
        res.writeHead(reply.status ?? 200, {
          'Content-Type': reply.raw === undefined ? 'application/json; charset=utf-8' : 'text/html',
          'X-Request-Id': `req-${gateway.requests.length}`,
          ...(req.headers['x-client-request-id'] ? { 'X-Client-Request-Id': req.headers['x-client-request-id'] } : {}),
          ...reply.headers,
        });
        res.end(payload);
      };
      if (reply.delayMs) setTimeout(send, reply.delayMs);
      else send();
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return Object.assign(gateway, {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  });
}

/** An API error body. */
export const apiError = (
  status: number,
  errorCode: string,
  details: unknown = null,
  headers?: Record<string, string>,
): Reply => ({
  status,
  json: { errorCode, errorMessage: `${errorCode} message`, details },
  ...(headers ? { headers } : {}),
});
