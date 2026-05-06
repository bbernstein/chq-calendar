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

  it('returns 404 for unhandled requests and logs an error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await fetch('/api/missing');
    expect(r.status).toBe(404);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
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
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await fetch('/api/z');
    expect(r.status).toBe(404);
    spy.mockRestore();
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
});
