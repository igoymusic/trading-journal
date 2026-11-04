import { describe, expect, it } from 'vitest';
import { futureEtf, futureLabel, parseContract, thirdFriday, toTick } from '../src/core/futures';
import { futuresRiskReward, priceLevels } from '../src/core/optionLevels';
import { levelsFromExits } from '../src/core/rr';
import { isTradovateCsv, parseTradovateCsv, parseTradovateTime, toNumber } from '../src/core/tradovateCsv';
import { buildTrades } from '../src/core/trades';
import { parseTosStatement } from '../src/core/tosCsv';
import { SAMPLE_STATEMENT } from './fixture';

const TZ = 'America/New_York';

const FILLS_CSV = [
  '_id,_orderId,_contractId,_timestamp,_tradeDate,_action,_qty,_price,_active,_finallyPaired,Fill ID,Order ID,Timestamp,Date,B/S,Quantity,Price,_priceFormat,_priceFormatType,_tickSize,Contract,Product,Product Description,commission',
  '111,901,3570918,2026-10-28T13:31:05.120Z,2026-10-28,0,2,5843.25,true,2,111,901,10/28/2026 09:31:05,10/28/2026, Buy,2,5843.25,-2,0,0.25,MESZ6,MES,Micro E-mini S&P 500,$1.24',
  '112,902,3570918,2026-10-28T13:40:12.500Z,2026-10-28,1,1,5850.50,true,1,112,902,10/28/2026 09:40:12,10/28/2026, Sell,1,5850.50,-2,0,0.25,MESZ6,MES,Micro E-mini S&P 500,$0.62',
  '113,903,3570918,2026-10-28T13:45:00.000Z,2026-10-28,1,1,5838.00,true,1,113,903,10/28/2026 09:45:00,10/28/2026, Sell,1,5838.00,-2,0,0.25,MESZ6,MES,Micro E-mini S&P 500,$0.62',
  '114,904,1111,2026-10-29T14:00:00.000Z,2026-10-29,1,1,5860.00,true,1,114,904,10/29/2026 10:00:00,10/29/2026, Sell,1,5860.00,-2,0,0.25,ESZ6,ES,E-mini S&P 500,$2.10',
  '115,905,1111,2026-10-29T14:05:00.000Z,2026-10-29,0,1,5855.00,true,1,115,905,10/29/2026 10:05:00,10/29/2026, Buy,1,5855.00,-2,0,0.25,ESZ6,ES,E-mini S&P 500,$2.10',
].join('\n');

const ORDERS_CSV = [
  'orderId,Account,Order ID,B/S,Contract,Product,Product Description,avgPrice,filledQty,Fill Time,lastCommandId,Status,_priceFormat,_priceFormatType,_tickSize,spreadDefinitionId,Version ID,Timestamp,Date,Quantity,Text,Type,Limit Price,Stop Price,decimalLimit,decimalStop,Filled Qty,Avg Fill Price,decimalFillAvg',
  '901,DEMO123,901, Buy,MESZ6,MES,Micro E-mini S&P 500,5843.25,2,10/28/2026 09:31:05,1,Filled,-2,0,0.25,,1,10/28/2026 09:31:04,10/28/2026,2,,Market,,,,,2,5843.25,5843.25',
  '902,DEMO123,902, Sell,MESZ6,MES,Micro E-mini S&P 500,,0,,1,Canceled,-2,0,0.25,,1,10/28/2026 09:35:00,10/28/2026,2,,Limit,5860,,5860,,0,,',
  '903,DEMO123,903, Sell,MESZ6,MES,Micro E-mini S&P 500,5850.50,2,10/28/2026 09:40:12,1,Filled,-2,0,0.25,,1,10/28/2026 09:40:00,10/28/2026,2,,Limit,5850.5,,5850.5,,2,5850.50,5850.5',
].join('\n');

const PERFORMANCE_CSV = [
  'symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration',
  'MESZ6,-2,0,0.25,111,112,1,5843.25,5850.50,$36.25,10/28/2026 09:31:05,10/28/2026 09:40:12,9min 7sec',
  'MESZ6,-2,0,0.25,111,113,1,5843.25,5838.00,$(26.25),10/28/2026 09:31:05,10/28/2026 09:45:00,13min 55sec',
].join('\n');

describe('futures contracts', () => {
  it('reads contract codes and their expirations', () => {
    expect(parseContract('MESZ6', '2026-10-28')).toEqual({ root: 'MES', month: '2026-12' });
    expect(parseContract('ESH7', '2026-12-20')).toEqual({ root: 'ES', month: '2027-03' });
    expect(parseContract('MNQZ6', '2026-10-28')).toEqual({ root: 'MNQ', month: '2026-12' });
    expect(parseContract('6EZ6', '2026-10-28')).toEqual({ root: '6E', month: '2026-12' });
    expect(parseContract('ESZ0', '2029-12-01')).toEqual({ root: 'ES', month: '2030-12' });
    expect(parseContract('SPY', '2026-10-28')).toBeNull();
    expect(thirdFriday('2026-12')).toBe('2026-12-18');
    expect(thirdFriday('2027-03')).toBe('2027-03-19');
    expect(futureLabel('MES', '2026-12-18')).toBe('/MES Dec 26');
  });

  it('charts S&P futures on SPY', () => {
    expect(futureEtf('ES')).toBe('SPY');
    expect(futureEtf('MES')).toBe('SPY');
    expect(futureEtf('MNQ')).toBe('QQQ');
    expect(futureEtf('CL')).toBeUndefined();
  });
});

describe('Tradovate import', () => {
  it('tells Tradovate exports from thinkorswim statements', () => {
    expect(isTradovateCsv(FILLS_CSV)).toBe(true);
    expect(isTradovateCsv(ORDERS_CSV)).toBe(true);
    expect(isTradovateCsv(PERFORMANCE_CSV)).toBe(true);
    expect(isTradovateCsv(SAMPLE_STATEMENT)).toBe(false);
  });

  it('reads times in either format', () => {
    expect(parseTradovateTime('10/28/2026 09:31:05', TZ)).toBe('2026-10-28T09:31:05');
    expect(parseTradovateTime('10/28/2026 1:05:09 PM', TZ)).toBe('2026-10-28T13:05:09');
    expect(parseTradovateTime('2026-10-28 09:31:05.123', TZ)).toBe('2026-10-28T09:31:05');
    expect(parseTradovateTime('2026-10-28T13:31:05.120Z', TZ)).toBe('2026-10-28T09:31:05');
    expect(toNumber('$(26.25)')).toBe(-26.25);
    expect(toNumber('$1,234.50')).toBe(1234.5);
  });

  it('reads the Fills report with commissions', () => {
    const { fills, skipped, kind } = parseTradovateCsv(FILLS_CSV, TZ);
    expect(kind).toBe('fills');
    expect(skipped).toEqual([]);
    expect(fills).toHaveLength(5);
    expect(fills[0]).toMatchObject({
      id: 'tv:f:111', broker: 'tradovate', execTime: '2026-10-28T09:31:05', underlying: 'MES', contract: 'MESZ6',
      multiplier: 5, expiry: '2026-12-18', strike: 0, putCall: 'CALL', side: 'BUY', quantity: 2, price: 5843.25, fees: 1.24,
    });
  });

  it('builds futures trades with dollars per point', () => {
    const trades = buildTrades(parseTradovateCsv(FILLS_CSV, TZ).fills);
    const mes = trades.find((t) => t.underlying === 'MES')!;
    expect(mes).toMatchObject({ status: 'CLOSED', direction: 'LONG', maxContracts: 2, contract: 'MESZ6', multiplier: 5 });
    // (5850.50 - 5843.25) * 5 + (5838 - 5843.25) * 5 = 36.25 - 26.25
    expect(mes.grossPnl).toBe(10);
    expect(mes.fees).toBe(2.48);
    expect(mes.netPnl).toBe(7.52);
    expect(mes.avgEntry).toBe(29216.25);
    const es = trades.find((t) => t.underlying === 'ES')!;
    expect(es).toMatchObject({ direction: 'SHORT', grossPnl: 250, netPnl: 245.8 });
  });

  it('reads only filled orders from the Orders report', () => {
    const { fills, skipped, kind } = parseTradovateCsv(ORDERS_CSV, TZ);
    expect(kind).toBe('orders');
    expect(fills).toHaveLength(2);
    expect(skipped).toHaveLength(1);
    expect(fills[0]).toMatchObject({ id: 'tv:o:901', account: 'Tradovate · DEMO123', quantity: 2, price: 5843.25, orderType: 'MARKET' });
    expect(buildTrades(fills)[0].grossPnl).toBe(72.5);
  });

  it('turns the Performance report back into fills', () => {
    const { fills, kind } = parseTradovateCsv(PERFORMANCE_CSV, TZ);
    expect(kind).toBe('performance');
    expect(fills).toHaveLength(4);
    const [trade] = buildTrades(fills);
    expect(trade).toMatchObject({ status: 'CLOSED', maxContracts: 2, grossPnl: 10, fees: 0 });
  });

  it('still reads thinkorswim statements the same way', () => {
    expect(parseTosStatement(SAMPLE_STATEMENT).fills.every((f) => !f.contract)).toBe(true);
  });

  it('reads stops and targets from futures exits at the ETF price', () => {
    const [trade] = buildTrades(parseTradovateCsv(FILLS_CSV, TZ).fills).filter((t) => t.underlying === 'MES');
    const spy = new Map([['tv:f:111', 584], ['tv:f:112', 584.7], ['tv:f:113', 583.5]]);
    expect(levelsFromExits(trade, spy)).toEqual({ stops: [{ price: 583.5, contracts: 1 }], targets: [{ price: 584.7, contracts: 1 }] });
  });

  it('prices lines on the SPY chart in futures points', () => {
    const [trade] = buildTrades(parseTradovateCsv(FILLS_CSV, TZ).fills).filter((t) => t.underlying === 'MES');
    const bars = [{ time: 0, open: 584, high: 586, low: 583, close: 585, volume: 1 }];
    const [p] = priceLevels({
      trade, levels: [{ price: 585, contracts: 1 }], bars,
      entry: { time: 0, underlying: 584, optionPrice: 5843.25 }, exitTime: 60_000, expiryTime: 0,
    });
    expect(p).toMatchObject({ source: 'estimate', reached: true });
    expect(p!.optionPrice).toBe(5853.25);
  });
});

describe('flipping from long to short in one order', () => {
  it('closes the long trade and opens a short one', () => {
    const csv = [
      FILLS_CSV.split('\n')[0],
      '201,1,1,,,0,1,5800.00,,,201,1,10/30/2026 09:31:00,10/30/2026, Buy,1,5800.00,-2,0,0.25,MESZ6,MES,Micro,$0.62',
      '202,2,1,,,1,3,5810.00,,,202,2,10/30/2026 09:40:00,10/30/2026, Sell,3,5810.00,-2,0,0.25,MESZ6,MES,Micro,$1.86',
      '203,3,1,,,0,2,5805.00,,,203,3,10/30/2026 09:50:00,10/30/2026, Buy,2,5805.00,-2,0,0.25,MESZ6,MES,Micro,$1.24',
    ].join('\n');
    const trades = buildTrades(parseTradovateCsv(csv, TZ).fills);
    expect(trades).toHaveLength(2);
    const long = trades.find((t) => t.direction === 'LONG')!;
    const short = trades.find((t) => t.direction === 'SHORT')!;
    expect(long).toMatchObject({ status: 'CLOSED', grossPnl: 50, fees: 1.24, maxContracts: 1 });
    expect(short).toMatchObject({ status: 'CLOSED', grossPnl: 50, fees: 2.48, maxContracts: 2, id: 'tv:f:202~rest' });
  });
});

describe('a real Tradovate Orders export', () => {
  // Two rows from a prop-firm account's Orders report (values start with a space, extra columns at the end).
  const csv = [
    'orderId,Account,Order ID,B/S,Contract,Product,Product Description,avgPrice,filledQty,Fill Time,lastCommandId,Status,_priceFormat,_priceFormatType,_tickSize,spreadDefinitionId,Version ID,Timestamp,Date,Quantity,Text,Type,Limit Price,Stop Price,decimalLimit,decimalStop,Filled Qty,Avg Fill Price,decimalFillAvg,Venue,Notional Value,Currency',
    '727681720004,TAKEPROFIT290110956,727681720004, Buy,MESZ6,MES,Micro E-mini S&P 500,7728.0,1,11/04/2026 11:45:55,727681720004, Filled,-2,0,0.25,,727681720004,11/04/2026 11:45:55,11/4/26,1,Chart, Market,,,,,1,7728.00,7728.0,,"38,640.00",USD',
    '727681720011,TAKEPROFIT290110956,727681720011, Sell,MESZ6,MES,Micro E-mini S&P 500,7729.0,1,11/04/2026 11:46:10,727681720011, Filled,-2,0,0.25,,727681720011,11/04/2026 11:46:10,11/4/26,1,Chart, Market,,,,,1,7729.00,7729.0,,"38,645.00",USD',
    '',
  ].join('\n');

  it('reads both fills as one /MES trade', () => {
    const { fills, skipped, kind } = parseTradovateCsv(csv, TZ);
    expect(kind).toBe('orders');
    expect(skipped).toEqual([]);
    expect(fills[0]).toMatchObject({
      execTime: '2026-11-04T11:45:55', side: 'BUY', quantity: 1, price: 7728, contract: 'MESZ6',
      account: 'Tradovate · TAKEPROFIT290110956', orderType: 'MARKET',
    });
    const [trade] = buildTrades(fills);
    expect(trade).toMatchObject({ status: 'CLOSED', direction: 'LONG', grossPnl: 5, closeTime: '2026-11-04T11:46:10' });
  });
});

describe('futures risk in ticks', () => {
  const [trade] = buildTrades(parseTradovateCsv(FILLS_CSV, TZ).fills).filter((t) => t.underlying === 'MES');
  const at = (price: number) => ({ optionPrice: price, source: 'fill' as const, time: 0, reached: true });

  it('counts ticks from the average entry and prices them at $1.25 a tick for /MES', () => {
    const r = futuresRiskReward(trade, [{ price: 583.5, contracts: 1 }], [at(5838)], [{ price: 584.7, contracts: 1 }], [at(5850.5)])!;
    expect(r.tickValue).toBe(1.25);
    expect(r.risk).toEqual({ ticks: 21, dollars: 26.25 });
    expect(r.reward).toEqual({ ticks: 29, dollars: 36.25 });
    expect(r.ratio).toBeCloseTo(36.25 / 26.25, 6);
  });

  it('weights ticks by contracts at each line', () => {
    const r = futuresRiskReward(trade, [{ price: 583.5, contracts: 2 }], [at(5841.25)], [], [])!;
    expect(r.risk).toEqual({ ticks: 8, dollars: 20 });
    expect(r.reward).toBeUndefined();
  });

  it('has no risk when the stop is on the winning side', () => {
    expect(futuresRiskReward(trade, [{ price: 585, contracts: 1 }], [at(5845)], [], [])!.risk).toBeUndefined();
  });

  it('rounds estimated prices to the tick', () => {
    expect(toTick(5853.31, 'ES')).toBe(5853.25);
    expect(toTick(5853.38, 'MES')).toBe(5853.5);
    expect(toTick(71.234, 'CL')).toBe(71.23);
  });
});
