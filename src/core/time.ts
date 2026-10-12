// Converts between broker wall-clock times (e.g. thinkorswim exports in your computer's time zone)
// and UTC, which market data APIs use.

/** Minutes that `timeZone` is ahead of UTC at the given instant (New York in summer: -240). */
export function zoneOffsetMinutes(utcMillis: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMillis));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(utcMillis / 1000) * 1000) / 60000);
}

/** "2026-10-12T11:49:07" in America/New_York -> epoch milliseconds (15:49:07 UTC). */
export function zonedToUtcMillis(localIso: string, timeZone: string): number {
  const [date, time = '00:00:00'] = localIso.split('T');
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi, s] = time.split(':').map(Number);
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  let utc = wallAsUtc - zoneOffsetMinutes(wallAsUtc, timeZone) * 60000;
  // Re-check at the corrected instant so times near a daylight-saving switch land right.
  utc = wallAsUtc - zoneOffsetMinutes(utc, timeZone) * 60000;
  return utc;
}

/**
 * Lightweight Charts labels its time axis in UTC. Shifting each timestamp by the zone offset
 * makes the axis read in the trader's own time zone.
 */
export function chartTime(utcMillis: number, timeZone: string): number {
  return Math.floor(utcMillis / 1000) + zoneOffsetMinutes(utcMillis, timeZone) * 60;
}
