import { DAY_MS, isHistoryDay, isHistoryIndex, type HistoryDay, type HistoryIndex } from '../shared/history-chart.ts';
async function readJson(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { signal });
  if (!response.ok) { throw new Error('History unavailable'); }
  return response.json() as Promise<unknown>;
}
export async function loadHistory(days: number, signal: AbortSignal, now = Date.now()): Promise<{ index: HistoryIndex; days: HistoryDay[] }> {
  const index = await readJson('/api/history/v1/index.json', signal);
  if (!isHistoryIndex(index)) { throw new Error('Invalid history index'); }
  const firstDate = new Date(now - days * DAY_MS).toISOString().slice(0, 10);
  const lastDate = new Date(now).toISOString().slice(0, 10);
  const dates = index.days.filter(date => date >= firstDate && date <= lastDate);
  const data = await Promise.all(dates.map(async date => {
    const day = await readJson(`/api/history/v1/${date}.json`, signal);
    if (!isHistoryDay(day) || day.date !== date) { throw new Error('Invalid history day'); }
    return day;
  }));
  return { index, days: data };
}
