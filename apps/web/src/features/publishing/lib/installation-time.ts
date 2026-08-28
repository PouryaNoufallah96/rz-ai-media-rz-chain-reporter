export function validFutureLocalTime(value: string, timeZone: string) {
  const time = zonedLocalDate(value, timeZone)?.getTime();
  return time !== undefined && time > Date.now();
}

export function minimumLocalTime(timeZone: string) {
  return localInputValue(new Date(Date.now() + 60_000), timeZone);
}

export function zonedLocalDate(value: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const fields = match.slice(1).map(Number);
  const year = fields[0] ?? 0;
  const month = fields[1] ?? 0;
  const day = fields[2] ?? 0;
  const hour = fields[3] ?? 0;
  const minute = fields[4] ?? 0;
  const localEpoch = Date.UTC(year, month - 1, day, hour, minute);
  const normalized = new Date(localEpoch);
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() !== month - 1 ||
    normalized.getUTCDate() !== day ||
    normalized.getUTCHours() !== hour ||
    normalized.getUTCMinutes() !== minute
  ) {
    return null;
  }

  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const instant = new Date(localEpoch + hours * 60 * 60 * 1000);
    const represented = partsAt(instant, timeZone);
    offsets.add(
      Date.UTC(
        represented.year,
        represented.month - 1,
        represented.day,
        represented.hour,
        represented.minute,
      ) - instant.getTime(),
    );
  }

  const candidates: Date[] = [];
  for (const offset of offsets) {
    const candidate = new Date(localEpoch - offset);
    if (localInputValue(candidate, timeZone) === value) {
      candidates.push(candidate);
    }
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function localInputValue(date: Date, timeZone: string) {
  const parts = partsAt(date, timeZone);
  const two = (value: number) => value.toString().padStart(2, "0");
  return `${parts.year}-${two(parts.month)}-${two(parts.day)}T${two(parts.hour)}:${two(parts.minute)}`;
}

function partsAt(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
}
