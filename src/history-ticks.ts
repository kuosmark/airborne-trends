export function historyTicks(since: number, until: number, days: number): number[] {
  const ticks: number[] = [];
  const date = new Date(since);
  date.setMinutes(0, 0, 0);
  if (days === 1) {
    date.setHours(Math.ceil(date.getHours() / 6) * 6);
  } else {
    date.setHours(0, 0, 0, 0);
  }
  while (date.getTime() <= until) {
    if (date.getTime() >= since) { ticks.push(date.getTime()); }
    if (days === 1) { date.setHours(date.getHours() + 6); }
    else { date.setDate(date.getDate() + (days === 7 ? 2 : 7)); }
  }
  return ticks;
}
