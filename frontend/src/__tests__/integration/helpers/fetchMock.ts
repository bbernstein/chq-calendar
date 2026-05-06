/**
 * fetchMock — small route-based fetch replacement for integration tests.
 *
 * Each test installs the mock, registers (method, url) → response handlers,
 * exercises the page, and asserts on `calls()`. Unhandled requests fall
 * through to a 404 plus a console.error so missing routes fail loudly rather
 * than silently in some success state.
 */

export type MockResponseInit = number | object | Response | ((req: Request) => Response | Promise<Response> | object | number);

interface Route {
  method: string;
  url: string | RegExp;
  responder: (req: Request) => Response | Promise<Response>;
}

export interface FetchMock {
  on: (method: string, url: string | RegExp, response: MockResponseInit) => void;
  calls: (url?: string | RegExp) => Request[];
  reset: () => void;
  uninstall: () => void;
}

/**
 * Replaces globalThis.fetch with a route table. Returns a handle for the
 * test to register routes, inspect calls, and tear down.
 */
export function installFetchMock(): FetchMock {
  const original = globalThis.fetch;
  let routes: Route[] = [];
  const recorded: Request[] = [];

  function toResponse(out: MockResponseInit, req: Request): Response | Promise<Response> {
    if (typeof out === 'function') {
      const v = (out as (r: Request) => Response | Promise<Response> | object | number)(req);
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

  function materialize(value: number | object): Response {
    if (typeof value === 'number') {
      return new Response(JSON.stringify({}), {
        status: value,
        headers: { 'Content-Type': 'application/json' },
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
      // Loud failure path: log and return 404 so tests notice missing routes.
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
    reset() {
      routes = [];
      recorded.length = 0;
    },
    uninstall() {
      globalThis.fetch = original;
      routes = [];
      recorded.length = 0;
    },
  };
}
