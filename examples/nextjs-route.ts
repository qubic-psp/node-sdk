// Next.js App Router: app/api/psp/webhook/route.ts. The Node.js runtime is needed for node:crypto.
import { PspClient, WebhookVerificationError } from '@qubiq-psp/sdk';
import { handleEvent } from './handle-event';

export const runtime = 'nodejs';

// Created on the first request, not at build time when the environment variables may be absent
let client: PspClient | undefined;
const psp = (): PspClient => (client ??= new PspClient());

export async function POST(request: Request): Promise<Response> {
  const body = Buffer.from(await request.arrayBuffer()); // the raw bytes: never request.json() here
  try {
    const event = psp().webhook.verify(body, request.headers);
    handleEvent(event); // keep it fast: the platform waits 10 s for the answer
    return new Response(null, { status: 200 });
  } catch (err) {
    if (err instanceof WebhookVerificationError) return new Response(err.reason, { status: err.status });
    throw err;
  }
}
