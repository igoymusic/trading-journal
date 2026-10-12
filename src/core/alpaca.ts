// Alpaca Market Data (free plan): stock history back to 2016, every individual trade included.
// The free plan can't query the most recent 15 minutes of full-market (SIP) data; for those we
// fall back to the IEX feed.

export interface Bar {
  /** Epoch milliseconds (UTC) at the start of the bar. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradePrint {
  /** Epoch milliseconds (UTC). */
  time: number;
  price: number;
  /** Which data feed answered: "sip" (all US exchanges) or "iex". */
  feed: 'sip' | 'iex';
}

export interface AlpacaCredentials {
  keyId: string;
  secretKey: string;
}

type FetchFn = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;

export class AlpacaError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export class AlpacaClient {
  constructor(
    private creds: AlpacaCredentials,
    private fetchFn: FetchFn = fetch as unknown as FetchFn,
    private baseUrl = 'https://data.alpaca.markets',
  ) {}

  private async get(path: string, params: Record<string, string | number>): Promise<any> {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    const res = await this.fetchFn(`${this.baseUrl}${path}?${qs}`, {
      headers: { 'APCA-API-KEY-ID': this.creds.keyId, 'APCA-API-SECRET-KEY': this.creds.secretKey },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // 403 also means "your plan can't see this feed"; that one mentions the subscription.
      const keyProblem = res.status === 401 || (res.status === 403 && !/subscription/i.test(body));
      if (keyProblem) throw new AlpacaError('Alpaca rejected the API key. Check the key and secret in Settings.', res.status);
      throw new AlpacaError(`Alpaca request failed (${res.status}): ${body.slice(0, 200)}`, res.status);
    }
    return res.json();
  }

  /** Runs a request on the SIP feed, retrying on IEX when the plan doesn't allow SIP for that window. */
  private async withFeed<T>(run: (feed: 'sip' | 'iex') => Promise<T>): Promise<{ result: T; feed: 'sip' | 'iex' }> {
    try {
      return { result: await run('sip'), feed: 'sip' };
    } catch (err) {
      if (err instanceof AlpacaError && (err.status === 403 || err.status === 422) && !err.message.includes('rejected the API key')) {
        return { result: await run('iex'), feed: 'iex' };
      }
      throw err;
    }
  }

  /** Minute candles between two UTC instants, following pagination. */
  async minuteBars(symbol: string, startMillis: number, endMillis: number): Promise<{ bars: Bar[]; feed: 'sip' | 'iex' }> {
    const { result, feed } = await this.withFeed(async (feed) => {
      const bars: Bar[] = [];
      let pageToken: string | undefined;
      do {
        const body = await this.get(`/v2/stocks/${encodeURIComponent(symbol)}/bars`, {
          timeframe: '1Min',
          start: new Date(startMillis).toISOString(),
          end: new Date(endMillis).toISOString(),
          adjustment: 'raw',
          feed,
          limit: 10000,
          ...(pageToken ? { page_token: pageToken } : {}),
        });
        for (const b of body.bars ?? []) {
          bars.push({ time: Date.parse(b.t), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v });
        }
        pageToken = body.next_page_token ?? undefined;
      } while (pageToken);
      return bars;
    });
    return { bars: result, feed };
  }

  /**
   * The last trade printed at or before the end of the given second, which is the
   * underlying's price at the moment an option filled. Looks back up to an hour.
   */
  async lastTradeAtOrBefore(symbol: string, utcMillis: number): Promise<TradePrint | null> {
    const endOfSecond = Math.floor(utcMillis / 1000) * 1000 + 1000;
    const { result, feed } = await this.withFeed(async (feed) => {
      const body = await this.get(`/v2/stocks/${encodeURIComponent(symbol)}/trades`, {
        start: new Date(endOfSecond - 3600_000).toISOString(),
        end: new Date(endOfSecond).toISOString(),
        feed,
        sort: 'desc',
        limit: 1,
      });
      return (body.trades ?? [])[0] as { t: string; p: number } | undefined;
    });
    return result ? { time: Date.parse(result.t), price: result.p, feed } : null;
  }

  /**
   * Minute candles for one option contract (OCC symbol). History starts in February 2024; minutes
   * with no trades have no candle.
   */
  async optionMinuteBars(occSymbol: string, startMillis: number, endMillis: number): Promise<Bar[]> {
    const bars: Bar[] = [];
    let pageToken: string | undefined;
    do {
      const body = await this.get('/v1beta1/options/bars', {
        symbols: occSymbol,
        timeframe: '1Min',
        start: new Date(startMillis).toISOString(),
        end: new Date(endMillis).toISOString(),
        limit: 10000,
        ...(pageToken ? { page_token: pageToken } : {}),
      });
      for (const b of body.bars?.[occSymbol] ?? []) {
        bars.push({ time: Date.parse(b.t), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v });
      }
      pageToken = body.next_page_token ?? undefined;
    } while (pageToken);
    return bars;
  }
}

/** The standard (OCC) option symbol, e.g. SPY 776 call expiring 2026-09-15 -> "SPY260915C00776000". */
export function occSymbol(underlying: string, expiry: string, putCall: 'CALL' | 'PUT', strike: number): string {
  const date = expiry.slice(2, 4) + expiry.slice(5, 7) + expiry.slice(8, 10);
  return `${underlying}${date}${putCall === 'CALL' ? 'C' : 'P'}${String(Math.round(strike * 1000)).padStart(8, '0')}`;
}
