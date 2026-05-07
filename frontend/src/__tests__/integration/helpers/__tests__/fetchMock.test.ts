import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installFetchMock, type FetchMock } from '../fetchMock';

describe('fetchMock helper', () => {
  let mock: FetchMock;

  beforeEach(() => {
    mock = installFetchMock();
  });

  afterEach(() => {
    mock.uninstall();
  });

  it('routes a GET by exact path', async () => {
    mock.on('GET', '/api/foo', { hello: 'world' });
    const r = await fetch('/api/foo');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toEqual({ hello: 'world' });
  });

  it('routes by RegExp', async () => {
    mock.on('GET', /\/api\/users\/\d+/, { id: 1 });
    const r = await fetch('/api/users/42');
    expect(r.status).toBe(200);
    expect((await r.json()).id).toBe(1);
  });

  it('throws on unhandled requests by default and records them in unhandledCalls()', async () => {
    await expect(fetch('/api/missing')).rejects.toThrow(/no route registered for GET/);
    expect(mock.unhandledCalls()).toHaveLength(1);
    expect(mock.unhandledCalls()[0].url).toContain('/api/missing');
  });

  it('records calls() and filters by URL', async () => {
    mock.on('POST', '/api/x', { ok: true });
    mock.on('POST', '/api/y', { ok: true });
    await fetch('/api/x', { method: 'POST', body: 'a' });
    await fetch('/api/y', { method: 'POST', body: 'b' });
    expect(mock.calls()).toHaveLength(2);
    expect(mock.calls('/api/x')).toHaveLength(1);
    expect(mock.calls('/api/y')[0].url).toContain('/api/y');
  });

  it('reset() clears routes and calls', async () => {
    mock.on('GET', '/api/z', { ok: true });
    await fetch('/api/z');
    mock.reset();
    expect(mock.calls()).toHaveLength(0);
    expect(mock.unhandledCalls()).toHaveLength(0);
    // Strict mode: now that the route is gone, the next call throws.
    await expect(fetch('/api/z')).rejects.toThrow(/no route registered/);
  });

  it('uninstall() restores the original fetch', () => {
    const beforeUninstall = globalThis.fetch;
    mock.uninstall();
    expect(globalThis.fetch).not.toBe(beforeUninstall);
  });

  it('responder can be a function returning a status code', async () => {
    mock.on('GET', '/api/code', () => 429);
    const r = await fetch('/api/code');
    expect(r.status).toBe(429);
  });

  it('responder can return a Response', async () => {
    mock.on('GET', '/api/raw', () => new Response('plain', { status: 201 }));
    const r = await fetch('/api/raw');
    expect(r.status).toBe(201);
    expect(await r.text()).toBe('plain');
  });

  it('honors a structured { status, body } response shape', async () => {
    mock.on('POST', '/api/struct', { status: 400, body: { error: 'bad', field: 'email' } });
    const r = await fetch('/api/struct', { method: 'POST' });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'bad', field: 'email' });
  });

  it('honors a structured response with custom headers', async () => {
    mock.on('GET', '/api/headers', {
      status: 200,
      body: { ok: true },
      headers: { 'X-Custom': 'yes' },
    });
    const r = await fetch('/api/headers');
    expect(r.headers.get('X-Custom')).toBe('yes');
  });

  it('falls back to JSON-body-with-status-200 when an object lacks status/headers', async () => {
    mock.on('GET', '/api/plain', { hello: 'world' });
    const r = await fetch('/api/plain');
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ hello: 'world' });
  });
});

describe('fetchMock helper — permissive mode', () => {
  let mock: FetchMock;

  beforeEach(() => {
    mock = installFetchMock({ allowUnhandled: true });
  });

  afterEach(() => {
    mock.uninstall();
  });

  it('returns 404 for unhandled requests when allowUnhandled is true', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await fetch('/api/missing');
    expect(r.status).toBe(404);
    expect(spy).toHaveBeenCalled();
    expect(mock.unhandledCalls()).toHaveLength(1);
    spy.mockRestore();
  });
});
