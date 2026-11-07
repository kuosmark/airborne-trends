import { mkdir, writeFile } from 'node:fs/promises';
import { countAircraft } from '../backend/skylink.ts';
import { compactSnapshot } from '../shared/snapshot-wire.ts';
import { DAY_MS, type HistoryDay } from '../shared/history-chart.ts';
import { SAMPLE_MS, summarizeHistoryDay, type HistorySummary } from '../shared/history-summary.ts';

const now = Date.now();
const generatedAt = new Date(now).toISOString();
const historyDir = '.cache/demo/api/history/v1';
await mkdir(historyDir, { recursive: true });

function sampleCounts(time: number) {
  const phase = (time % DAY_MS) / DAY_MS * 2 * Math.PI;
  return {
    jets: 8 + Math.round(4 * Math.sin(phase)),
    props: 5 + Math.round(2 * Math.cos(phase)),
  };
}

const lastSlot = Math.floor(now / SAMPLE_MS) * SAMPLE_MS;
const { jets, props } = sampleCounts(lastSlot);
const aircraft = Array.from({ length: jets + props }, (_, i) => ({
  icao24: (0xf00000 + i).toString(16), callsign: (i < jets ? 'DMJ' : 'DMR') + String(100 + i),
  aircraft_type: i < jets ? 'A320' : 'AT72', is_on_ground: false, last_seen: generatedAt,
  latitude: 43 + (i * 7 % 17), longitude: -10 + (i * 11 % 42), altitude: 15000 + 600 * i,
}));
const snapshot = countAircraft({ timestamp: generatedAt, total_count: aircraft.length, aircraft }, now);
for (const airline of snapshot.airlines) {
  airline.name = airline.id === 'DMJ' ? 'Demo Jet Airways' : 'Demo Regional';
}
await writeFile('.cache/demo/api/ranking-v2', JSON.stringify(compactSnapshot(snapshot)));

// Eight UTC dates provide a full rolling week, including today's partial day.
const dates: string[] = [];
const daily: HistorySummary[] = [];
const today = Math.floor(now / DAY_MS) * DAY_MS;
for (let start = today - 7 * DAY_MS; start <= today; start += DAY_MS) {
  const date = new Date(start).toISOString().slice(0, 10);
  const times: string[] = [];
  const totals: number[] = [];
  const jetCounts: number[] = [];
  const propCounts: number[] = [];
  for (let time = start; time < start + DAY_MS && time <= lastSlot; time += SAMPLE_MS) {
    const counts = sampleCounts(time);
    times.push(new Date(time).toISOString());
    totals.push(counts.jets + counts.props);
    jetCounts.push(counts.jets);
    propCounts.push(counts.props);
  }
  const day: HistoryDay = { schemaVersion: 1, date, times, totals,
    operators: { DMJ: jetCounts, DMR: propCounts }, aircraftTypes: { A320: jetCounts, AT72: propCounts } };
  await writeFile(historyDir + '/' + date + '.json', JSON.stringify(day));
  daily.push(...summarizeHistoryDay(day, DAY_MS, now));
  dates.push(date);
}
await writeFile(historyDir + '/year.json', JSON.stringify({ schemaVersion: 1, generatedAt, daily }));
await writeFile(historyDir + '/index.json', JSON.stringify({ schemaVersion: 1, generatedAt, days: dates }));
