export function historyTicks(since: number, until: number, days: number): number[] {
  const ticks: number[] = [];
  if (days === 365) {
    const date = new Date(since);
    let tick = Date.UTC(date.getUTCFullYear(), Math.ceil(date.getUTCMonth() / 3) * 3, 1);
    while (tick <= until) {
      if (tick >= since) { ticks.push(tick); }
      const current = new Date(tick);
      tick = Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 3, 1);
    }
    return ticks;
  }
  if (days === 30) {
    for (let time = Math.ceil(since / 86_400_000) * 86_400_000; time <= until; time += 7 * 86_400_000) { ticks.push(time); }
    return ticks;
  }
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
