# Setting up broker sync

Broker sync lets Moon Journal pull your option trades straight from your broker. It goes through
**SnapTrade**, a service that connects to brokers like Schwab, Webull, Robinhood, E*Trade and
Fidelity. SnapTrade needs an API key, and that key must never ship inside the app, so it lives in
a tiny "relay" you run for free on **Cloudflare**. The app talks to the relay; the relay adds the
key and talks to SnapTrade.

```
Moon Journal  ──▶  your relay (Cloudflare, holds the key)  ──▶  SnapTrade  ──▶  your broker
```

You do this once. After that, you and your friend only ever click **Connect a broker** and sign
in to the broker.

The relay can only read trades. It always asks brokers for read-only access and has no way to
place, change or cancel orders.

## 1. Get a SnapTrade key

1. Sign up at <https://dashboard.snaptrade.com>.
2. In the dashboard, open **API Keys** and create a key. You get a **Client ID** and a
   **Consumer Key**. The Consumer Key is shown once, so keep the page open until step 2 is done.
3. Pick a plan that allows more than one person to connect (you and your friend). Check
   SnapTrade's pricing page for the current plans.

Don't paste these keys into chat, email, or any file. They only go into Cloudflare in step 2.

## 2. Create the relay on Cloudflare

1. Sign up (free) at <https://dash.cloudflare.com>.
2. Go to **Workers & Pages**, press **Create**, choose **Create Worker** (the "Hello World"
   starter), name it `moon-relay`, and press **Deploy**.
3. Press **Edit code**. Delete everything in the editor, paste the whole of
   [`worker/snaptrade-relay.js`](../worker/snaptrade-relay.js), and press **Deploy**.
4. Go back to the worker and open **Settings → Variables and Secrets**. Add two entries, each with
   type **Secret**:
   - `SNAPTRADE_CLIENT_ID`: your Client ID
   - `SNAPTRADE_CONSUMER_KEY`: your Consumer Key
5. Optional: add a plain variable `MAX_USERS` to change how many people may sign up (default 4).
   This stops a stranger who finds the address from using up your SnapTrade plan.
6. Copy the worker's address from its overview page. It looks like
   `https://moon-relay.<your-name>.workers.dev`.

The address is not a secret; it's fine to send it in chat.

## 3. Point Moon Journal at the relay

Either way works:

- **Built into the installer (best for your friend):** the address is set in
  `.github/workflows/build.yml` (currently `https://moon-relay.igoymusic.workers.dev`). A repository
  variable named `MOON_RELAY_URL` overrides it. Every installer built after that already knows it.
- **By hand:** in Moon Journal open **Settings → Brokers → Relay address**, paste it, and Save.

## 4. Connect

In Moon Journal, open **Settings → Connect a broker**, pick your broker, and sign in. When the
window closes, your trades come in. Add more brokers the same way with **Add another broker**.

From then on the app syncs the first time you open it each day, and **↻ Refresh** at the top
syncs right away. Trades you already imported from a thinkorswim CSV aren't counted twice.

## Good to know

- SnapTrade refreshes brokers about once a day, so today's trades may not show until tomorrow.
- Some brokers only report the date of a fill, not the time. Moon Journal uses the exact time from
  the broker's order list when it can (the last 90 days); otherwise the fill shows
  "time not reported" and has no underlying price.
- **Disconnect** in Settings removes your SnapTrade sign-in and all broker links, and frees your
  place on the relay. Trades already brought in stay in your journal.
