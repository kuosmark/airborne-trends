import { mkdir, writeFile } from 'node:fs/promises';
import { countAircraft } from '../backend/skylink.ts';
import { compareRanks } from '../shared/ranking.ts';
import { compactSnapshot } from '../shared/snapshot-wire.ts';
import { DAY_MS, type HistoryDay } from '../shared/history-chart.ts';
import { SAMPLE_MS, summarizeHistoryDay, type HistorySummary } from '../shared/history-summary.ts';
import { fleets, sampleFleets } from './demo-fleets.ts';

const now = Date.now();
const lastSlot = Math.floor(now / SAMPLE_MS) * SAMPLE_MS;
const historyDir = '.cache/demo/api/history/v1';
await mkdir(historyDir, { recursive: true });

function snapshotAt(time: number) {
  const timestamp = new Date(time).toISOString();
  const aircraft = sampleFleets(time).flatMap(({ fleet, fleetIndex, type, typeIndex, count }) =>
    Array.from({ length: count }, (_, i) => {
      const number = typeIndex * 100 + i + 1;
      const destination = fleet.destinations[(number + typeIndex) % fleet.destinations.length];
      const progress = 0.08 + 0.84 * ((number * 37 + time / SAMPLE_MS) % 101) / 100;
      const [lat, lon] = fleet.base;
      const ceiling = ({ C172: 5500, EC45: 3000, AT72: 22000 } as Record<string, number>)[type] ?? 36000;
      return { icao24: (0xf00000 + fleetIndex * 1000 + number).toString(16), callsign: fleet.id + String(number),
        aircraft_type: type, last_seen: timestamp, is_on_ground: false,
        latitude: lat + (destination[0] - lat) * progress, longitude: lon + (destination[1] - lon) * progress,
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
