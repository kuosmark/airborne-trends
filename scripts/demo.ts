import { mkdir, writeFile } from 'node:fs/promises';
import { countAircraft } from '../backend/skylink.ts';
import { compareRanks } from '../shared/ranking.ts';
import { compactSnapshot } from '../shared/snapshot-wire.ts';
import { DAY_MS, type HistoryDay } from '../shared/history-chart.ts';
import { SAMPLE_MS, summarizeHistoryDay, type HistorySummary } from '../shared/history-summary.ts';
import { fleets, sampleFleets, sampleFraction } from './demo-fleets.ts';

const now = Date.now();
const lastSlot = Math.floor(now / SAMPLE_MS) * SAMPLE_MS;
const historyDir = '.cache/demo/api/history/v1';
await mkdir(historyDir, { recursive: true });

function snapshotAt(time: number) {
  const timestamp = new Date(time).toISOString();
  const aircraft = sampleFleets(time).flatMap(({ fleet, fleetIndex, type, typeIndex, count }) =>
    Array.from({ length: count }, (_, i) => {
      const number = typeIndex * 100 + i + 1;
      const aircraftId = 0xf00000 + fleetIndex * 1000 + number;
      const stops = fleet.destinations;
      const route = Math.floor(sampleFraction(aircraftId, 751) * stops.length);
      const destination = stops[route];
      // Some aircraft fly between outstations. Most routes still touch the base.
      const leg = Math.floor(sampleFraction(aircraftId, 9187) * (stops.length - 1));
      const start = sampleFraction(aircraftId, 4223) < 0.2 ? stops[(route + leg + 1) % stops.length] : fleet.base;
      const phase = (sampleFraction(aircraftId, 3571) + time / SAMPLE_MS / 16) % 1;
      const progress = 0.04 + 0.92 * (1 - Math.abs(2 * phase - 1));
      const north = destination[0] - start[0];
      const east = destination[1] - start[1];
      const longitudeScale = Math.cos((start[0] + destination[0]) * Math.PI / 360);
      const bend = (sampleFraction(aircraftId, 6211) - 0.5) * 0.12 * Math.sin(Math.PI * progress);
      const ceiling = ({ C172: 5500, EC45: 3000, AT72: 22000 } as Record<string, number>)[type] ?? 36000;
      return { icao24: aircraftId.toString(16), callsign: fleet.id + String(number),
        aircraft_type: type, last_seen: timestamp, is_on_ground: false,
        latitude: start[0] + north * progress + east * longitudeScale * bend,
        longitude: start[1] + east * progress - north / longitudeScale * bend,
        altitude: 500 * Math.round(ceiling * Math.sin(Math.PI * progress) / 500) };
    }));
  const snapshot = countAircraft({ timestamp, total_count: aircraft.length, aircraft }, time);
  for (const airline of snapshot.airlines) {
    const fleet = fleets.find(entry => entry.id === airline.id);
    if (fleet) { Object.assign(airline, { name: fleet.name, country: fleet.country, countryIso: fleet.countryIso, icao: fleet.id }); }
  }
  return snapshot;
}
const ranking = compareRanks(snapshotAt(lastSlot), snapshotAt(lastSlot - SAMPLE_MS));
await writeFile('.cache/demo/api/ranking-v2', JSON.stringify(compactSnapshot(ranking)));

const dates: string[] = [];
const daily: HistorySummary[] = [];
const today = Math.floor(now / DAY_MS) * DAY_MS;
for (let start = today - 364 * DAY_MS; start <= today; start += DAY_MS) {
  const date = new Date(start).toISOString().slice(0, 10);
  const day: HistoryDay = { schemaVersion: 1, date, times: [], totals: [], operators: {}, aircraftTypes: {} };
  for (let time = start; time < start + DAY_MS && time <= lastSlot; time += SAMPLE_MS) {
    const index = day.times.length;
    day.times.push(new Date(time).toISOString());
    day.totals.push(0);
    for (const { fleet, type, count } of sampleFleets(time)) {
      const operators = day.operators[fleet.id] ??= [];
      const types = day.aircraftTypes[type] ??= [];
      operators[index] = (operators[index] ?? 0) + count;
      types[index] = (types[index] ?? 0) + count;
      day.totals[index] += count;
    }
  }
  daily.push(...summarizeHistoryDay(day, DAY_MS, now));
  if (start >= today - 30 * DAY_MS) {
    await writeFile(historyDir + '/' + date + '.json', JSON.stringify(day));
    dates.push(date);
  }
}
const generatedAt = new Date(now).toISOString();
await writeFile(historyDir + '/year.json', JSON.stringify({ schemaVersion: 1, generatedAt, daily }));
await writeFile(historyDir + '/index.json', JSON.stringify({ schemaVersion: 1, generatedAt, days: dates }));
