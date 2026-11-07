// Illustrative fleet sizes and route endpoints. All activity is generated locally.
type Coordinates = [latitude: number, longitude: number];
interface Fleet {
  id: string;
  name: string;
  country: string;
  countryIso: string;
  base: Coordinates;
  destinations: Coordinates[];
  types: Record<string, number>;
  utilization: (hour: number, isWeekend: boolean, summer: number) => number;
}

// Smooth peaks wrap across midnight for overnight operations.
function peak(hour: number, center: number, width: number): number {
  const distance = Math.min(Math.abs(hour - center), 24 - Math.abs(hour - center));
  return Math.exp(-0.5 * (distance / width) ** 2);
}

export const fleets: Fleet[] = [
  { id: 'NVR', name: 'Northvale Regional', country: 'Sweden', countryIso: 'SE',
    base: [59.65, 17.92], destinations: [[57.66, 12.28], [63.79, 20.28], [60.32, 24.96], [55.62, 12.66]],
    types: { AT72: 36, A320: 14 },
    utilization: (hour, weekend) => 0.16 + (weekend ? 0.35 : 0.68) * (peak(hour, 7, 2.1) + peak(hour, 16, 2.5)) },
  { id: 'EMF', name: 'Ember Freight', country: 'Germany', countryIso: 'DE',
    base: [51.42, 12.24], destinations: [[52.45, -1.33], [40.49, -3.57], [41.28, 28.75], [60.19, 11.1]],
    types: { B763: 27, B738: 19 },
    utilization: (hour, weekend) => 0.15 + (weekend ? 0.53 : 0.72) * peak(hour, 1, 4) },
  { id: 'SLC', name: 'Solace Holiday Air', country: 'Netherlands', countryIso: 'NL',
    base: [52.31, 4.76], destinations: [[39.55, 2.74], [37.01, -7.97], [35.34, 25.18], [28.05, -16.57]],
    types: { A320: 30, B738: 24 },
    utilization: (hour, weekend, summer) => (0.26 + 0.48 * peak(hour, 12, 5) + (weekend ? 0.16 : 0)) * (0.76 + 0.24 * summer) },
  { id: 'TLI', name: 'Tideline Island Air', country: 'United Kingdom', countryIso: 'GB',
    base: [58.96, -2.90], destinations: [[59.25, -2.58], [59.35, -2.95], [58.46, -3.09], [59.19, -2.77]],
    types: { C172: 12, EC45: 8, AT72: 3 },
    utilization: (hour, _weekend, summer) => 0.06 + (0.50 + 0.30 * summer) * peak(hour, 12, 3.4) },
];

// Stable variation means a timestamp has the same fleet in the ranking and every chart.
function variation(position: number, seed: number): number {
  function sample(bucket: number): number {
    let bits = Math.imul(bucket, 0x45d9f3b) ^ seed;
    bits = Math.imul(bits ^ (bits >>> 16), 0x45d9f3b);
    return ((bits ^ (bits >>> 16)) >>> 0) / 0x80000000 - 1;
  }
  const bucket = Math.floor(position);
  const fraction = position - bucket;
  return sample(bucket) + (sample(bucket + 1) - sample(bucket)) * fraction;
}

export function sampleFleets(time: number) {
  const date = new Date(time);
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60;
  const isWeekend = [0, 6].includes(date.getUTCDay());
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const day = (time - yearStart) / 86_400_000;
  const summer = (1 + Math.cos((day - 196) * 2 * Math.PI / 365.25)) / 2;
  const hours = time / 3_600_000;
  return fleets.flatMap((fleet, fleetIndex) => {
    const seed = Math.imul(fleetIndex + 1, 0x9e3779b1);
    const scheduleShift = 1.25 * variation(hours / 13, seed);
    const dailyDemand = 1 + 0.28 * variation(hours / 29, seed);
    return Object.entries(fleet.types).map(([type, size], typeIndex) => {
      const scheduleHour = (hour + scheduleShift + typeIndex * 0.45 + 24) % 24;
      const usualActivity = fleet.utilization(scheduleHour, isWeekend, summer);
      const localFluctuation = variation(hours / 1.25, seed + (typeIndex + 1) * 7919);
      const active = size * usualActivity * dailyDemand + Math.sqrt(size * usualActivity) * localFluctuation;
      const count = Math.min(size, Math.max(0, Math.round(active)));
      return { fleet, fleetIndex, type, typeIndex, count };
    });
  });
}
