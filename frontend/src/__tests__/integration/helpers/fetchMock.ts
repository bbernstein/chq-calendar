/**
 * fetchMock — small route-based fetch replacement for integration tests.
 *
 * Each test installs the mock, registers (method, url) → response handlers,
 * exercises the page, and asserts on `calls()`.
 *
 * By default, an unhandled request throws a descriptive error so missing
 * routes fail loudly. Tests that genuinely want a 404 default can opt in via
 * `installFetchMock({ allowUnhandled: true })`. The handle also exposes
 * `unhandledCalls()` so a strict test can assert nothing slipped through.
 *
 * ## Supported response shapes (`MockResponseInit`)
 *
 * A registered response can be any of:
 *
 *  - `number` — status code with empty JSON body (e.g. `mock.on(..., 204)`)
 *  - `Response` — used as-is
 *  - `{ status, body, headers? }` — structured shape; `status` is required for
 *    the structured form (presence of `status` OR `headers` triggers it). The
 *    `body` is JSON-stringified unless it is already a string.
 *  - any other `object` — treated as a JSON body with status 200
 *  - `(req) => Response | object | number | Promise<...>` — function variant,
 *    each return type follows the rules above
 */

export interface StructuredMockResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type MockResponseInit =
  | number
  | object
  | Response
  | StructuredMockResponse
  | ((req: Request) => Response | Promise<Response> | object | number | StructuredMockResponse);

interface Route {
  method: string;
  url: string | RegExp;
  responder: (req: Request) => Response | Promise<Response>;
}

export interface FetchMock {
  on: (method: string, url: string | RegExp, response: MockResponseInit) => void;
  calls: (url?: string | RegExp) => Request[];
  unhandledCalls: () => Request[];
  reset: () => void;
  uninstall: () => void;
}

export interface InstallFetchMockOptions {
  /**
   * When true, unhandled requests return a 404 instead of throwing. Defaults
   * to false — most tests want strict mode so missing routes fail loudly.
   */
  allowUnhandled?: boolean;
}

function isStructuredMockResponse(v: unknown): v is StructuredMockResponse {
  if (v === null || typeof v !== 'object') return false;
  if (v instanceof Response) return false;
  if (Array.isArray(v)) return false;
  // The structured shape is identified by the presence of `status` or
  // `headers`. Plain `{ body: ... }` would be ambiguous with a JSON body
  // that legitimately has a `body` field, so we don't trigger on that alone.
  return 'status' in v || 'headers' in v;
}

/**
 * Replaces globalThis.fetch with a route table. Returns a handle for the
 * test to register routes, inspect calls, and tear down.
 */
export function installFetchMock(options: InstallFetchMockOptions = {}): FetchMock {
  const { allowUnhandled = false } = options;
  const original = globalThis.fetch;
  let routes: Route[] = [];
  const recorded: Request[] = [];
  const unhandled: Request[] = [];

  function toResponse(out: MockResponseInit, req: Request): Response | Promise<Response> {
    if (typeof out === 'function') {
      const v = (out as (r: Request) => Response | Promise<Response> | object | number | StructuredMockResponse)(req);
      if (v instanceof Response) return v;
      if (v instanceof Promise) {
        return v.then(inner => {
          if (inner instanceof Response) return inner;
          return materialize(inner);
        });
      }
      return materialize(v);
    }
    if (out instanceof Response) return out;
    return materialize(out);
  }

  function materialize(value: number | object | StructuredMockResponse): Response {
    if (typeof value === 'number') {
      return new Response(JSON.stringify({}), {
        status: value,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (isStructuredMockResponse(value)) {
      const { status, body, headers } = value;
      const hasBody = body !== undefined;
      const serialized = hasBody
        ? (typeof body === 'string' ? body : JSON.stringify(body))
        : '';
      return new Response(hasBody ? serialized : null, {
        status,
        headers: {
          'Content-Type': 'application/json',
          ...(headers ?? {}),
        },
      });
    }
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function urlMatches(pattern: string | RegExp, actual: string): boolean {
    if (typeof pattern === 'string') {
      // Match either an exact URL or a path ending — tests register short
      // paths like '/api/publisher-status' and the actual fetch URL is
      // http://localhost:3000/api/publisher-status (jsdom default origin).
      return actual === pattern || actual.endsWith(pattern);
    }
    return pattern.test(actual);
  }

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // Normalize relative paths to absolute URLs so the Request constructor
    // doesn't throw under jsdom/undici. Production code passes either an
    // absolute API URL or a path-relative URL ('/api/...'); both work here.
    let req: Request;
    if (input instanceof Request) {
      req = input;
    } else {
      const raw = typeof input === 'string' ? input : (input as URL).toString();
      const absolute = /^https?:\/\//i.test(raw)
        ? raw
        : new URL(raw, globalThis.location?.origin ?? 'http://localhost').toString();
      req = new Request(absolute, init);
    }
    recorded.push(req.clone());
    const method = req.method.toUpperCase();
    const url = req.url;
    const route = routes.find(r => r.method.toUpperCase() === method && urlMatches(r.url, url));
    if (!route) {
      unhandled.push(req.clone());
      if (!allowUnhandled) {
        // Strict mode: throw so tests notice missing routes rather than
        // silently exercising error-handling paths.
        throw new Error(
          `[fetchMock] no route registered for ${method} ${url}. ` +
          `Register one with mock.on('${method}', '<path>', <response>) or pass ` +
          `installFetchMock({ allowUnhandled: true }) for permissive mode.`,
        );
      }
      // Permissive mode: still log so the unhandled call is visible.
      console.error(`[fetchMock] no route for ${method} ${url}`);
      return new Response(JSON.stringify({ error: 'no route' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return route.responder(req);
  }) as typeof fetch;

  return {
    on(method, url, response) {
      routes.push({
        method: method.toUpperCase(),
        url,
        responder: (req) => Promise.resolve(toResponse(response, req)),
      });
    },
    calls(url) {
      if (url === undefined) return recorded.slice();
      return recorded.filter(r => urlMatches(url, r.url));
    },
    unhandledCalls() {
      return unhandled.slice();
    },
    reset() {
      routes = [];
      recorded.length = 0;
      unhandled.length = 0;
    },
    uninstall() {
      globalThis.fetch = original;
      routes = [];
      recorded.length = 0;
      unhandled.length = 0;
    },
  };
}
