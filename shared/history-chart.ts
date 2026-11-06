import { isHistorySummaries, type HistorySummary } from './history-summary.ts';
export interface HistoryDay {
  schemaVersion: 1;
  date: string;
  times: string[];
  slots?: number[];
  summaries?: { hourly: HistorySummary[]; daily: HistorySummary[] };
  totals: number[];
  operators: Partial<Record<string, number[]>>;
  aircraftTypes: Partial<Record<string, number[]>>;
}
export interface HistoryIndex {
  schemaVersion: 1;
  generatedAt: string;
  days: string[];
}
export const DAY_MS = 86_400_000;
export function isHistoryDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isCounts(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length &&
    value.every((count: unknown) => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0);
}
function isSeries(value: unknown, length: number, pattern: RegExp): value is Partial<Record<string, number[]>> {
  return isObject(value) && Object.entries(value).every(([id, counts]) => pattern.test(id) && isCounts(counts, length));
}
export function isHistoryDay(value: unknown): value is HistoryDay {
  if (!isObject(value) || value['schemaVersion'] !== 1 || !isHistoryDate(value['date']) ||
      !Array.isArray(value['times']) || value['times'].length === 0 || value['times'].length > 200) { return false; }
  const times: unknown[] = value['times'];
  if (!times.every((time, index) => typeof time === 'string' && time.startsWith(String(value['date'])) &&
      Number.isFinite(Date.parse(time)) && new Date(time).toISOString() === time &&
      (index === 0 || String(times[index - 1]) < time))) { return false; }
  if (value['slots'] !== undefined && (!isCounts(value['slots'], times.length) ||
      !value['slots'].every((slot, index) =>
        Math.abs(slot * 900_000 - Date.parse(String(times[index]))) < 900_000))) { return false; }
  if (value['summaries'] !== undefined && !isHistorySummaries(value['summaries'], value['date'])) { return false; }
  return isCounts(value['totals'], times.length) &&
    isSeries(value['operators'], times.length, /^[A-Z]{3}$/) &&
    isSeries(value['aircraftTypes'], times.length, /^[A-Z0-9]{2,4}$/);
}
export function isHistoryIndex(value: unknown): value is HistoryIndex {
  return isObject(value) && value['schemaVersion'] === 1 && typeof value['generatedAt'] === 'string' &&
    Number.isFinite(Date.parse(value['generatedAt'])) && Array.isArray(value['days']) && value['days'].length <= 31 &&
    value['days'].every(isHistoryDate) && new Set(value['days']).size === value['days'].length;
}
export interface HistoryPoint { time: number; count: number }
export function historyPoints(days: HistoryDay[], dimension: 'total' | 'operators' | 'aircraftTypes', id: string,
  since: number, until: number): HistoryPoint[] {
  return days.flatMap(day => day.times.map((time, index) => ({
    time: Date.parse(time), count: dimension === 'total' ? day.totals[index] : (day[dimension][id]?.[index] ?? 0),
  }))).filter(point => point.time >= since && point.time <= until).sort((a, b) => a.time - b.time);
}
