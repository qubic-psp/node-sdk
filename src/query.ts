// Query strings of the merchant API (gateway docs/13-merchant-api.md, 13.2 «TARGET» and 13.7 lists):
// a list of values is one parameter with values joined by a literal comma — `status=active,partially_paid`.
// URLSearchParams would send `%2C`, which is a different string to sign, so the SDK builds the query itself.

/** A value of a query parameter. `undefined`, `null` and an empty list leave the parameter out. */
export type QueryValue = string | number | boolean | Date | readonly (string | number)[] | null | undefined;

/** Query parameters in the order they must appear in the request. */
export type QueryParams = Readonly<Record<string, QueryValue>>;

function encodeScalar(value: string | number | boolean | Date): string {
  return encodeURIComponent(value instanceof Date ? value.toISOString() : String(value));
}

/** `?a=1&b=x,y` for the given parameters, or `''` when none is set. */
export function buildQuery(params: QueryParams | undefined): string {
  if (!params) return '';
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    let encoded: string;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      encoded = (value as readonly (string | number)[]).map(encodeScalar).join(',');
    } else {
      encoded = encodeScalar(value as string | number | boolean | Date);
    }
    pairs.push(`${encodeURIComponent(key)}=${encoded}`);
  }
  return pairs.length ? `?${pairs.join('&')}` : '';
}

/** One path segment, e.g. an invoice id: percent-encoded so it can never change the path. */
export function pathSegment(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Resolves the request URL against the base URL and returns the TARGET that will really go into the request line:
 * `url.pathname + url.search` after the WHATWG URL parser (the same parser `fetch` uses).
 */
export function resolveTarget(baseUrl: string, pathAndQuery: string): { url: URL; target: string } {
  const base = new URL(baseUrl);
  const prefix = base.pathname.replace(/\/+$/, '');
  const url = new URL(`${prefix}${pathAndQuery}`, base.origin);
  url.hash = '';
  return { url, target: `${url.pathname}${url.search}` };
}
