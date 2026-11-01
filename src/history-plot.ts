import type { HistoryPoint } from '../shared/history-chart';
export function plotHistory(points: HistoryPoint[], since: number, until: number, referenceMaximum = 0) {
  const maximum = Math.max(0, ...points.map(point => point.count));
  const scalePeak = Math.max(maximum, referenceMaximum);
  const roughStep = Math.max(1, scalePeak / 4);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step = Math.ceil(roughStep / magnitude) * magnitude;
  const scaleMaximum = Math.max(step, Math.ceil(scalePeak / step) * step);
  const x = (time: number) => (time - since) / (until - since) * 704;
  const y = (count: number) => 180 - count / scaleMaximum * 152;
  let path = '';
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const isGap = index === 0 || point.time - points[index - 1].time > 22.5 * 60_000;
    path += `${isGap ? 'M' : 'L'}${x(point.time).toFixed(2)},${y(point.count).toFixed(2)} `;
  }
  const gridlines = Array.from({ length: scaleMaximum / step + 1 }, (_, index) => {
    const value = index * step;
    return { value, y: y(value) };
  });
  return { path, maximum, gridlines, dots: points.map((point, index) => ({
    x: x(point.time), y: y(point.count),
    isIsolated: (index === 0 || point.time - points[index - 1].time > 22.5 * 60_000) &&
      (index === points.length - 1 || points[index + 1].time - point.time > 22.5 * 60_000),
  })) };
}

export function nearestHistoryPoint(points: HistoryPoint[], time: number): number | null {
  if (points.length === 0) { return null; }
  let nearest = 0;
  for (let index = 1; index < points.length; index++) {
    if (Math.abs(points[index].time - time) < Math.abs(points[nearest].time - time)) {
      nearest = index;
    }
  }
  return nearest;
}
