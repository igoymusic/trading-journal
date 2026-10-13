import { afterEach, describe, expect, it, vi } from 'vitest';
import relay, { canonicalJson, sign } from '../worker/snaptrade-relay.js';

const env = { SNAPTRADE_CLIENT_ID: 'TEST', SNAPTRADE_CONSUMER_KEY: 'secret-key', MAX_USERS: '2' };
const post = (path: string, body: unknown) => relay.fetch(new Request(`https://relay.example${path}`, { method: 'POST', body: JSON.stringify(body) }), env);

afterEach(() => vi.unstubAllGlobals());

/** Stands in for SnapTrade, recording each call. */
function fakeSnapTrade(reply: (url: URL) => unknown) {
  const calls: { url: URL; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
    const url = new URL(input);
    calls.push({ url, init });
    return new Response(JSON.stringify(reply(url)), { status: 200 });
  });
  return calls;
}

describe('SnapTrade relay', () => {
  it('signs requests exactly like SnapTrade\'s Python example', async () => {
    const payload = { content: { substring: 'AAPL', b: [1, { z: 1, a: null }] }, path: '/api/v1/symbols', query: 'clientId=TEST&timestamp=1700000000' };
    expect(canonicalJson(payload)).toBe('{"content":{"b":[1,{"a":null,"z":1}],"substring":"AAPL"},"path":"/api/v1/symbols","query":"clientId=TEST&timestamp=1700000000"}');
    // Computed with Python: base64(hmac.new(key, json.dumps(o, separators=(",", ":"), sort_keys=True), sha256))
    expect(await sign('secret-key', payload)).toBe('C2huNuCFXMetpKp610f7bU/Rtj7HulR8ZVXusEPe35k=');
  });

  it('sends a signed request with the client id and timestamp in the query', async () => {
    const calls = fakeSnapTrade(() => [{ id: 'a' }]);
    const res = await post('/accounts', { userId: 'u1', userSecret: 's1' });
    expect(await res.json()).toEqual([{ id: 'a' }]);
    const { url, init } = calls[0];
    expect(url.pathname).toBe('/api/v1/accounts');
    expect(url.searchParams.get('userId')).toBe('u1');
    expect(url.searchParams.get('clientId')).toBe('TEST');
    const expected = await sign('secret-key', { content: null, path: '/api/v1/accounts', query: url.search.slice(1) });
    expect((init.headers as Record<string, string>).Signature).toBe(expected);
  });

  it('only ever asks for read-only broker access', async () => {
    const calls = fakeSnapTrade(() => ({ redirectURI: 'https://portal' }));
    await post('/login', { userId: 'u1', userSecret: 's1', connectionType: 'trade' });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ connectionType: 'read' });
  });

  it('stops signing people up once it is full', async () => {
    fakeSnapTrade(() => ['moon-1', 'moon-2']);
    const res = await post('/register', {});
    expect(res.status).toBe(403);
  });

  it('only removes a sign-in for whoever holds its secret', async () => {
    const calls = fakeSnapTrade(() => []);
    expect((await post('/unregister', { userId: 'u1', userSecret: 's1' })).status).toBe(200);
    expect(calls.map((c) => `${c.init.method} ${c.url.pathname}`)).toEqual(['GET /api/v1/authorizations', 'DELETE /api/v1/snapTrade/deleteUser']);
    expect(calls[1].url.searchParams.get('userSecret')).toBeNull();

    const rejected: string[] = [];
    vi.stubGlobal('fetch', async (input: string) => {
      rejected.push(new URL(input).pathname);
      return new Response(JSON.stringify({ detail: 'Invalid userID or userSecret' }), { status: 401 });
    });
    expect((await post('/unregister', { userId: 'u1', userSecret: 'wrong' })).ok).toBe(false);
    expect(rejected).toEqual(['/api/v1/authorizations']);
  });

  it('refuses anything it does not know, like placing trades', async () => {
    const calls = fakeSnapTrade(() => ({}));
    expect((await post('/trade/place', { userId: 'u1', userSecret: 's1' })).status).toBe(404);
    expect((await post('/activities', { userId: 'u1', userSecret: 's1', accountId: '../../trade' })).status).toBe(502);
    expect(calls).toHaveLength(0);
  });
});
