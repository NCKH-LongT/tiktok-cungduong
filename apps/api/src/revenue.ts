const DAY_MS = 86400000;
const VIETNAM_OFFSET_MS = 7 * 3600000;

function vietnamDay(date: Date): string {
  return new Date(date.getTime() + VIETNAM_OFFSET_MS).toISOString().slice(0, 10);
}

export function revenueWindow(fromInput?: string, toInput?: string, now = new Date()) {
  const from = fromInput ?? vietnamDay(new Date(now.getTime() - 29 * DAY_MS));
  const to = toInput ?? vietnamDay(now);
  const start = new Date(`${from}T00:00:00+07:00`);
  const lastDay = new Date(`${to}T00:00:00+07:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
      Number.isNaN(start.getTime()) || Number.isNaN(lastDay.getTime()) ||
      vietnamDay(start) !== from || vietnamDay(lastDay) !== to ||
      start > lastDay || lastDay.getTime() - start.getTime() > 365 * DAY_MS) {
    throw new Error('Invalid revenue date range');
  }
  return { from, to, start, end: new Date(lastDay.getTime() + DAY_MS) };
}
