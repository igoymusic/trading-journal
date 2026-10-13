// Moon Journal's SnapTrade relay: a tiny Cloudflare Worker that holds the SnapTrade API key so
// the app's installer doesn't have to. It can only do the handful of read-only things the app
// needs (create a sign-in for a person, get their broker sign-in link, list their accounts, read
// their fills). It can't place trades, and it stores nothing: every request carries the person's
// own SnapTrade user id and secret, which live only on their computer.
//
// Set up in Cloudflare (see docs/broker-sync-setup.md):
//   SNAPTRADE_CLIENT_ID     (secret) your SnapTrade client id
//   SNAPTRADE_CONSUMER_KEY  (secret) your SnapTrade consumer key
//   MAX_USERS               (optional) how many people may sign up, default 4

const API = 'https://api.snaptrade.com';

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return json({ error: 'Moon Journal relay. Nothing to see here.' }, 404);
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Expected a JSON body.' }, 400);
    }
    const route = ROUTES[new URL(request.url).pathname];
    if (!route) return json({ error: 'Unknown request.' }, 404);
    if (!env.SNAPTRADE_CLIENT_ID || !env.SNAPTRADE_CONSUMER_KEY) return json({ error: 'The relay is missing its SnapTrade keys.' }, 500);
    try {
      return await route(body ?? {}, env);
    } catch (err) {
      return json({ error: err.message || 'Something went wrong.' }, 502);
    }
  },
};

const ROUTES = {
  // A new SnapTrade user for one person, if there's room.
  async '/register'(_body, env) {
    const users = await snaptrade(env, 'GET', '/api/v1/snapTrade/listUsers');
    if (users.status !== 200) return pass(users);
    const max = Number(env.MAX_USERS || 4);
    if (Array.isArray(users.data) && users.data.length >= max) {
      return json({ error: `This relay already has its ${max} people signed up.` }, 403);
    }
    const userId = `moon-${crypto.randomUUID()}`;
    return pass(await snaptrade(env, 'POST', '/api/v1/snapTrade/registerUser', {}, { userId }));
  },

  // The broker sign-in page. Read-only access, always.
  async '/login'(body, env) {
    const user = credentials(body);
    const options = { connectionType: 'read' };
    if (typeof body.customRedirect === 'string') options.customRedirect = body.customRedirect;
    if (typeof body.reconnect === 'string') options.reconnect = body.reconnect;
    return pass(await snaptrade(env, 'POST', '/api/v1/snapTrade/login', user, options));
  },

  // Removes this person's SnapTrade user (and their broker links), freeing their place.
  async '/unregister'(body, env) {
    const user = credentials(body);
    // Only the person holding the secret may do this: check it works before deleting.
    const check = await snaptrade(env, 'GET', '/api/v1/authorizations', user);
    if (check.status !== 200) return pass(check);
    return pass(await snaptrade(env, 'DELETE', '/api/v1/snapTrade/deleteUser', { userId: user.userId }));
  },

  async '/accounts'(body, env) {
    return pass(await snaptrade(env, 'GET', '/api/v1/accounts', credentials(body)));
  },

  async '/connections'(body, env) {
    return pass(await snaptrade(env, 'GET', '/api/v1/authorizations', credentials(body)));
  },

  async '/activities'(body, env) {
    const query = { ...credentials(body) };
    for (const key of ['startDate', 'endDate']) if (/^\d{4}-\d{2}-\d{2}$/.test(body[key] ?? '')) query[key] = body[key];
    if (Number.isInteger(body.offset)) query.offset = String(body.offset);
    query.limit = '1000';
    return pass(await snaptrade(env, 'GET', `/api/v1/accounts/${accountId(body)}/activities`, query));
  },

  async '/orders'(body, env) {
    const query = { ...credentials(body), state: 'executed', days: String(Math.min(90, Math.max(1, Number(body.days) || 90))) };
    return pass(await snaptrade(env, 'GET', `/api/v1/accounts/${accountId(body)}/orders`, query));
  },
};

function credentials(body) {
  if (typeof body.userId !== 'string' || typeof body.userSecret !== 'string') throw new Error('Missing userId or userSecret.');
  return { userId: body.userId, userSecret: body.userSecret };
}

function accountId(body) {
  if (!/^[0-9a-fA-F-]{36}$/.test(body.accountId ?? '')) throw new Error('Bad accountId.');
  return body.accountId;
}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const pass = (r) => json(r.data, r.status);

/** Calls SnapTrade with a signed request and returns its status and parsed body. */
async function snaptrade(env, method, path, query = {}, body) {
  const params = new URLSearchParams({ ...query, clientId: env.SNAPTRADE_CLIENT_ID, timestamp: String(Math.floor(Date.now() / 1000)) });
  const queryString = params.toString();
  const content = body === undefined || Object.keys(body).length === 0 ? null : body;
  const signature = await sign(env.SNAPTRADE_CONSUMER_KEY, { content, path, query: queryString });
  const res = await fetch(`${API}${path}?${queryString}`, {
    method,
    headers: { 'content-type': 'application/json', Signature: signature },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  return { status: res.status, data };
}

/** SnapTrade's request signature: HMAC-SHA256 of the sorted, compact JSON, base64-encoded. */
export async function sign(consumerKey, payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(consumerKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(canonicalJson(payload)));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

/** JSON with keys sorted at every level and no spaces, like Python's json.dumps(sort_keys=True, separators=(",", ":")). */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
