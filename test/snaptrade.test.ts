import { describe, expect, it } from 'vitest';
import { matchFills, newFills, sameFill } from '../src/core/fills';
import { buildTrades } from '../src/core/trades';
import { activitiesToFills, parseOcc, type StActivity, toWallClock } from '../src/core/snaptrade';
import type { Fill } from '../src/core/types';

const spy = { ticker: 'SPY   260915C00776000', option_type: 'CALL' as const, strike_price: 776, expiration_date: '2026-09-15', underlying_symbol: { symbol: 'SPY' } };
const act = (over: Partial<StActivity>): StActivity => ({ id: 'a1', type: 'BUY', option_type: 'BUY_TO_OPEN', option_symbol: spy, price: 1.36, units: 2, fee: 1.3, trade_date: '2026-09-15T17:20:12.000Z', ...over });
const opts = { accountId: 'acc', accountName: 'Schwab Individual', timeZone: 'America/New_York' };

describe('SnapTrade fills', () => {
  it('reads OCC option symbols with or without padding', () => {
    expect(parseOcc('SPY   260915C00776000')).toEqual({ underlying: 'SPY', expiry: '2026-09-15', putCall: 'CALL', strike: 776 });
    expect(parseOcc('TSLA260109P00402500')).toEqual({ underlying: 'TSLA', expiry: '2026-01-09', putCall: 'PUT', strike: 402.5 });
  });

  it('turns an option buy into a fill on New York time', () => {
    expect(toWallClock(Date.parse('2026-09-15T17:20:12Z'), 'America/New_York')).toBe('2026-09-15T13:20:12');
    const [f] = activitiesToFills([act({})], [], opts);
    expect(f).toEqual({
      id: 'snaptrade:acc:a1', broker: 'snaptrade', account: 'Schwab Individual', execTime: '2026-09-15T13:20:12', timeExact: true,
      underlying: 'SPY', expiry: '2026-09-15', strike: 776, putCall: 'CALL', side: 'BUY', quantity: 2,
      positionEffect: 'OPEN', price: 1.36, orderType: 'MARKET', spread: 'SINGLE', fees: 1.3,
    });
  });

  it('borrows the exact time from the matching order when the activity only has a date', () => {
    const dated = act({ type: 'SELL', option_type: 'SELL_TO_CLOSE', units: -2, price: 1.26, trade_date: '2026-09-15T00:00:00.000Z' });
    const order = { status: 'EXECUTED', action: 'SELL', option_symbol: spy, filled_quantity: '2', execution_price: '1.26', time_executed: '2026-09-15T17:22:15.000Z' };
    const [f] = activitiesToFills([dated], [order], opts);
    expect(f).toMatchObject({ side: 'SELL', quantity: 2, execTime: '2026-09-15T13:22:15', timeExact: true, positionEffect: 'CLOSE' });
    // Without a matching order the time is unknown.
    const [g] = activitiesToFills([dated], [], opts);
    expect(g).toMatchObject({ execTime: '2026-09-15T12:00:00', timeExact: false });
  });

  it('times partial fills from one order, even without its price', () => {
    const day = '2026-09-15T00:00:00.000Z';
    const a1 = act({ id: 'p1', units: 1, trade_date: day });
    const a2 = act({ id: 'p2', units: 1, trade_date: day });
    const order = { status: 'EXECUTED', action: 'BUY_OPEN', option_symbol: { ...spy, ticker: 'SPY260915C00776000' }, total_quantity: 2, execution_price: null, time_executed: null, time_updated: '2026-09-15T14:31:05Z' };
    const fills = activitiesToFills([a1, a2], [order], opts);
    expect(fills.map((f) => [f.execTime, f.timeExact])).toEqual([['2026-09-15T10:31:05', true], ['2026-09-15T10:31:05', true]]);
  });

  it('closes whatever was open when an option expires', () => {
    const buy = act({});
    const expired = act({ id: 'x', type: 'OPTIONEXPIRATION', option_type: null, units: 2, price: 0, fee: 0, trade_date: '2026-09-15T00:00:00Z' });
    const fills = activitiesToFills([expired, buy], [], opts);
    expect(fills.find((f) => f.id.endsWith(':x'))).toMatchObject({ side: 'SELL', quantity: 2, price: 0, orderType: 'EXPIRED', execTime: '2026-09-15T16:00:00' });
    // A short that expires is bought back.
    const sold = act({ type: 'SELL', option_type: 'SELL_TO_OPEN' });
    expect(activitiesToFills([expired, sold], [], opts).find((f) => f.id.endsWith(':x'))!.side).toBe('BUY');
  });

  it('skips stock trades, deposits and mini options', () => {
    expect(activitiesToFills([
      act({ option_symbol: null }), act({ type: 'DIVIDEND' }), act({ option_symbol: { ...spy, is_mini_option: true } }),
    ], [], opts)).toEqual([]);
  });
});

describe('the same fill from two sources', () => {
  const tos: Fill = {
    id: 'tos:1', broker: 'thinkorswim', execTime: '2026-09-15T13:20:12', underlying: 'SPY', expiry: '2026-09-15', strike: 776,
    putCall: 'CALL', side: 'BUY', quantity: 2, positionEffect: 'OPEN', price: 1.36, orderType: 'LMT', spread: 'SINGLE', fees: 1.3,
  };
  const synced = activitiesToFills([act({ trade_date: '2026-09-15T17:20:13Z' })], [], opts)[0];

  it('matches on contract, side, size, price and time', () => {
    expect(sameFill(tos, synced)).toBe(true);
    expect(sameFill(tos, { ...synced, price: 1.4 })).toBe(false);
    expect(sameFill(tos, { ...synced, execTime: '2026-09-15T13:30:00' })).toBe(false);
    expect(sameFill(tos, { ...synced, execTime: '2026-09-15T12:00:00', timeExact: false })).toBe(true);
  });

  it('keeps only fills the journal does not already have', () => {
    expect(newFills([synced], [tos])).toEqual([]);
    // Two identical trades that day: one matches the CSV fill, the other is new.
    const second = { ...synced, id: 'snaptrade:acc:a2', execTime: '2026-09-15T12:00:00', timeExact: false };
    const first = { ...synced, execTime: '2026-09-15T12:00:00', timeExact: false };
    expect(newFills([first, second], [tos]).map((f) => f.id)).toEqual(['snaptrade:acc:a2']);
    expect(newFills([tos], [tos])).toEqual([]);
  });

  it('matches a date-only synced fill to the CSV fill that has its time', () => {
    const dateOnly = { ...synced, execTime: '2026-09-15T12:00:00', timeExact: false };
    expect(matchFills([tos], [dateOnly]).matched).toEqual([{ existing: dateOnly, incoming: tos }]);
  });

  it('says which CSV fill a synced fill matched, so the trade learns its account', () => {
    const { fresh, matched } = matchFills([synced], [tos]);
    expect(fresh).toEqual([]);
    expect(matched).toEqual([{ existing: tos, incoming: synced }]);
    expect(buildTrades([synced])[0].account).toBe('Schwab Individual');
    expect(buildTrades([tos])[0].account).toBeUndefined();
  });
});

describe('index prices from the ETF', async () => {
  const { indexProxy, parseFredCsv, ratioDay } = await import('../src/core/indexProxy');
  it('reads FRED closes, skipping missing days', () => {
    const closes = parseFredCsv('observation_date,SP500\n2026-10-08,6790.10\n2026-10-09,6781.25\n2026-10-12,.\n');
    expect([...closes]).toEqual([['2026-10-08', 6790.1], ['2026-10-09', 6781.25]]);
    // Today's close isn't published yet, so the last one sets the ratio.
    expect(ratioDay('2026-10-12', closes)).toBe('2026-10-09');
    expect(ratioDay('2026-10-08', closes)).toBe('2026-10-08');
    expect(ratioDay('2026-10-01', closes)).toBeUndefined();
  });
  it('charts SPXW and XSP from SPY', () => {
    expect(indexProxy('spxw')).toMatchObject({ etf: 'SPY', scale: 1 });
    expect(indexProxy('XSP')?.scale).toBe(0.1);
    expect(indexProxy('SPY')).toBeUndefined();
  });
});

describe('Schwab transactions', async () => {
  const { transactionsToFills } = await import('../src/core/schwab');
  const { JournalDb } = await import('../src/main/db');
  const leg = (amount: number, price: number, effect: string) => ({
    instrument: { assetType: 'OPTION', symbol: 'SPXW  261009C06750000', underlyingSymbol: '$SPX', putCall: 'CALL', strikePrice: 6750 },
    amount, price, cost: -amount * price * 100, positionEffect: effect,
  });
  const fee = { instrument: { assetType: 'CURRENCY', symbol: 'CURRENCY_USD' }, amount: 0, cost: -0.65, feeType: 'COMMISSION' };
  const txs = [
    { activityId: 1, type: 'TRADE', status: 'VALID', time: '2026-10-09T14:31:05+0000', orderId: 10, transferItems: [fee, leg(2, 4.1, 'OPENING')] },
    { activityId: 2, type: 'TRADE', status: 'VALID', time: '2026-10-09T00:00:00+0000', orderId: 11, transferItems: [leg(-2, 5.3, 'CLOSING')] },
  ];
  const orders = [{ orderId: 11, orderActivityCollection: [{ executionLegs: [{ time: '2026-10-09T15:02:40+0000', price: 5.3, quantity: 2 }] }] }];

  it('turns trades into fills at their exact time, borrowing it from the order when needed', () => {
    const fills = transactionsToFills(txs, orders, { account: 'Schwab · Trading', timeZone: 'America/New_York' });
    expect(fills).toMatchObject([
      { id: 'schwab:1:0', underlying: 'SPXW', expiry: '2026-10-09', strike: 6750, putCall: 'CALL', side: 'BUY', quantity: 2, price: 4.1, execTime: '2026-10-09T10:31:05', fees: 0.65, positionEffect: 'OPEN' },
      { id: 'schwab:2:0', side: 'SELL', price: 5.3, execTime: '2026-10-09T11:02:40', positionEffect: 'CLOSE' },
    ]);
    expect(fills[0].timeExact).toBeUndefined();
  });

  it('only fills in times for trades SnapTrade already brought in', () => {
    const db = new JournalDb(':memory:');
    const base = { broker: 'snaptrade' as const, account: 'Schwab · Trading', underlying: 'SPXW', expiry: '2026-10-09', strike: 6750, putCall: 'CALL' as const,
      quantity: 2, orderType: 'MARKET', spread: 'SINGLE', fees: 0.65, execTime: '2026-10-09T12:00:00', timeExact: false };
    db.addFills([{ ...base, id: 'snaptrade:a:1', side: 'BUY', positionEffect: 'OPEN', price: 4.1 }]);
    const fills = transactionsToFills(txs, orders, { account: 'Schwab · Trading', timeZone: 'America/New_York' });
    expect(db.addFills(fills, { addNew: false })).toBe(0);
    expect(db.lastRetimed).toBe(1);
    expect(db.allFills().map((f) => [f.id, f.execTime])).toEqual([['snaptrade:a:1', '2026-10-09T10:31:05']]);
  });
});
