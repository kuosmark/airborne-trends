import { DAY_MS, type HistoryDay, type HistoryPoint } from './history-chart.ts';

export const SAMPLE_MS = 15 * 60_000;
export const HOUR_MS = 4 * SAMPLE_MS;
export interface HistorySummary {
  time: number;
  end: number;
  samples: number;
  expected: number;
  isPartial: boolean;
  isCovered: boolean;
  total: number;
  operators: Record<string, number>;
  aircraftTypes: Record<string, number>;
}

// Retain the latest observation for each scheduled collection slot.
export function uniqueHistoryIndexes(day: HistoryDay): number[] {
  const slots = new Map<number, number>();
  day.times.forEach((time, index) => slots.set(day.slots?.[index] ?? Math.floor(Date.parse(time) / SAMPLE_MS), index));
  return [...slots.values()];
}

export function summarizeHistoryDay(day: HistoryDay, interval: number, until: number): HistorySummary[] {
  const observedSlots = new Map<number, number>();
  for (const index of uniqueHistoryIndexes(day)) {
    observedSlots.set(Math.floor(Date.parse(day.times[index]) / SAMPLE_MS), index);
  }
  const indexes = [...observedSlots.values()];
  const start = Date.parse(day.date);
  const summaries: HistorySummary[] = [];
  for (let time = start; time < Math.min(start + DAY_MS, until); time += interval) {
    const end = Math.min(time + interval, until);
    const firstSlot = time / SAMPLE_MS;
    const expected = Math.ceil((end - time) / SAMPLE_MS);
    const selected = indexes.filter(index => {
      const slot = Math.floor(Date.parse(day.times[index]) / SAMPLE_MS);
      return slot >= firstSlot && slot < firstSlot + expected && Date.parse(day.times[index]) <= until;
    });
    const present = new Set(selected.map(index => Math.floor(Date.parse(day.times[index]) / SAMPLE_MS)));
    let longestMissing = 0;
    let missing = 0;
    for (let slot = firstSlot; slot < firstSlot + expected; slot++) {
      missing = present.has(slot) ? 0 : missing + 1;
      longestMissing = Math.max(longestMissing, missing);
    }
    const average = (values: number[]) => selected.reduce((sum, index) => sum + values[index], 0) / Math.max(1, selected.length);
    const groups = (dimension: 'operators' | 'aircraftTypes') => Object.fromEntries(
      Object.entries(day[dimension]).map(([id, values]) => [id, average(values ?? [])]));
    summaries.push({ time, end, samples: selected.length, expected,
      isPartial: end < time + interval,
      isCovered: selected.length / expected >= (interval === HOUR_MS ? 0.75 : 0.9) &&
        (interval === HOUR_MS || longestMissing <= 4),
      total: average(day.totals), operators: groups('operators'), aircraftTypes: groups('aircraftTypes') });
  }
  return summaries;
}

export interface SummaryPoint extends HistoryPoint {
  end?: number;
  samples?: number;
  expected?: number;
  isPartial?: boolean;
}
export function summaryPoints(summaries: HistorySummary[], dimension: 'total' | 'operators' | 'aircraftTypes', id: string): SummaryPoint[] {
  return summaries.filter(bucket => bucket.isCovered).map(bucket => ({
    time: bucket.time, end: bucket.end, count: dimension === 'total' ? bucket.total : (bucket[dimension][id] ?? 0),
    samples: bucket.samples, expected: bucket.expected, isPartial: bucket.isPartial,
  }));
}

export function isHistorySummaries(value: unknown, date: string): value is { hourly: HistorySummary[]; daily: HistorySummary[] } {
  if (!value || typeof value !== 'object') { return false; }
  const data = value as Record<string, unknown>;
  const isCount = (count: unknown): count is number => typeof count === 'number' && Number.isFinite(count) && count >= 0;
  const isGroups = (groups: unknown, pattern: RegExp) => groups !== null && typeof groups === 'object' && !Array.isArray(groups) &&
    Object.entries(groups).every(([id, count]) => pattern.test(id) && isCount(count));
  return ([['hourly', HOUR_MS], ['daily', DAY_MS]] as const).every(([key, interval]) => {
    const buckets = data[key];
    return Array.isArray(buckets) && buckets.length <= DAY_MS / interval && buckets.every((bucket: unknown, index) => {
      if (!bucket || typeof bucket !== 'object') { return false; }
      const b = bucket as HistorySummary;
      return b.time === Date.parse(date) + index * interval && Number.isFinite(b.end) && b.end > b.time && b.end <= b.time + interval &&
        Number.isInteger(b.samples) && b.samples >= 0 && Number.isInteger(b.expected) && b.expected > 0 &&
        b.expected === Math.ceil((b.end - b.time) / SAMPLE_MS) && b.samples <= b.expected &&
        typeof b.isCovered === 'boolean' && b.isPartial === (b.end < b.time + interval) &&
        (!b.isCovered || b.samples / b.expected >= (interval === HOUR_MS ? 0.75 : 0.9)) &&
        isCount(b.total) && isGroups(b.operators, /^[A-Z]{3}$/) && isGroups(b.aircraftTypes, /^[A-Z0-9]{2,4}$/);
    });
  });
}

export interface HistoryYear { schemaVersion: 1; generatedAt: string; daily: HistorySummary[] }
export function isHistoryYear(value: unknown): value is HistoryYear {
  if (!value || typeof value !== 'object') { return false; }
  const year = value as Record<string, unknown>;
  return year.schemaVersion === 1 && typeof year.generatedAt === 'string' && Number.isFinite(Date.parse(year.generatedAt)) &&
    Array.isArray(year.daily) && year.daily.length <= 365 && year.daily.every((entry: unknown, index: number, buckets: HistorySummary[]) => {
      if (!entry || typeof entry !== 'object') { return false; }
      const bucket = entry as HistorySummary;
      return Number.isFinite(bucket.time) && (index === 0 || buckets[index - 1].time < bucket.time) &&
        isHistorySummaries({ hourly: [], daily: [bucket] }, new Date(bucket.time).toISOString().slice(0, 10));
    });
}
