// Coverage of the gateway spec: the SDK covers exactly the 13 public operations, the other operations of
// api/openapi.v1.json are excluded on purpose. A new operation in gateway fails this test until it is sorted.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROUTES } from './routes';

/** Operations of /api/v1 that live in the merchant cabinet, not in the SDK (owner decision 2026-10-28). */
const EXCLUDED_OPERATIONS = [
  'getMerchantBalances',
  'listMerchantOperations',
  'getMerchantOperationsSummary',
  'getMerchantOperationsStatement',
  'getMerchantOperation',
  'listMerchantDeposits',
  'getMerchantDeposit',
  'quotePayout',
  'createPayout',
  'listPayouts',
  'getPayout',
  'cancelPayout',
  'listNetworks',
  'getMerchantTariff',
] as const;

interface SpecOperation {
  operationId: string;
  method: string;
  path: string;
  idempotent: unknown;
}

const spec = JSON.parse(readFileSync(new URL('../api/openapi.v1.json', import.meta.url), 'utf8')) as {
  paths: Record<string, Record<string, { operationId?: string; 'x-idempotency'?: unknown }>>;
};

const specOperations: SpecOperation[] = Object.entries(spec.paths).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([method]) => ['get', 'post', 'put', 'delete', 'patch'].includes(method))
    .map(([method, op]) => ({
      operationId: op.operationId ?? `${method} ${path}`,
      method: method.toUpperCase(),
      path,
      idempotent: op['x-idempotency'],
    })),
);

describe('coverage of api/openapi.v1.json', () => {
  it('every operation of the spec is either in the SDK or excluded', () => {
    const covered = new Set<string>([...Object.keys(ROUTES), ...EXCLUDED_OPERATIONS]);
    const unsorted = specOperations.map((o) => o.operationId).filter((id) => !covered.has(id));
    expect(unsorted, 'new operations in gateway: add them to ROUTES or EXCLUDED_OPERATIONS').toEqual([]);
  });

  it('the SDK has 13 operations and excludes 14, together all of the spec', () => {
    expect(Object.keys(ROUTES)).toHaveLength(13);
    expect(EXCLUDED_OPERATIONS).toHaveLength(14);
    expect(specOperations).toHaveLength(13 + 14);
  });

  it.each(Object.entries(ROUTES))('%s has the method and path of the spec', (operationId, route) => {
    const op = specOperations.find((o) => o.operationId === operationId);
    expect(op, `${operationId} is not in the spec`).toBeDefined();
    expect({ method: op?.method, path: op?.path }).toEqual({ method: route.method, path: route.path });
  });

  it('no operation of the merchant API takes an Idempotency-Key (13.10)', () => {
    expect(specOperations.filter((o) => o.idempotent !== false && o.idempotent !== undefined)).toEqual([]);
  });
});
