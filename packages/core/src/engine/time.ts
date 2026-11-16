/**
 * Scheduler days, as Anki counts them: whole local calendar days since the collection's creation day, where a
 * day starts at the rollover hour (default 4:00) in local time.
 */
export interface Clock {
  /** Current time, unix ms. */
  now(): number;
  /** Local UTC offset in minutes at a given instant (east positive: UTC+8 → 480). */
  utcOffsetMinutes(atMs: number): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  utcOffsetMinutes: (at) => -new Date(at).getTimezoneOffset(),
};

/** A clock with a fixed UTC offset whose time can be set (tests, benchmarks). */
export class ManualClock implements Clock {
  constructor(
    public ms: number,
    public offsetMinutes = 0,
  ) {}
  now(): number {
    return this.ms;
  }
  utcOffsetMinutes(): number {
    return this.offsetMinutes;
  }
  advance(ms: number): void {
    this.ms += ms;
  }
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Local calendar-day index (days since 1970-01-01 local) of an instant, after moving the day start to the rollover hour. */
function localDayIndex(ms: number, rolloverHour: number, clock: Clock): number {
  return Math.floor((ms + clock.utcOffsetMinutes(ms) * 60_000 - rolloverHour * HOUR_MS) / DAY_MS);
}

/** UTC instant at which local day `dayIndex` starts (its rollover hour). */
function dayIndexStart(dayIndex: number, rolloverHour: number, clock: Clock): number {
  const localStart = dayIndex * DAY_MS + rolloverHour * HOUR_MS;
  // Offset at the target instant (two passes handle DST changes between now and then).
  let at = localStart - clock.utcOffsetMinutes(localStart) * 60_000;
  at = localStart - clock.utcOffsetMinutes(at) * 60_000;
  return at;
}

export interface DayTiming {
  nowMs: number;
  /** Scheduler day number of now. */
  today: number;
  /** Start of today (ms). */
  dayStartMs: number;
  /** Start of tomorrow (ms). */
  nextDayAtMs: number;
}

export class SchedulerDays {
  private readonly createdIndex: number;
  constructor(
    readonly crtSecs: number,
    readonly rolloverHour: number,
    readonly clock: Clock,
  ) {
    this.createdIndex = localDayIndex(crtSecs * 1000, rolloverHour, clock);
  }

  dayOf(ms: number): number {
    return localDayIndex(ms, this.rolloverHour, this.clock) - this.createdIndex;
  }

  /** Start (ms) of scheduler day `day`. */
  dayStart(day: number): number {
    return dayIndexStart(this.createdIndex + day, this.rolloverHour, this.clock);
  }

  timing(nowMs = this.clock.now()): DayTiming {
    const today = this.dayOf(nowMs);
    return { nowMs, today, dayStartMs: this.dayStart(today), nextDayAtMs: this.dayStart(today + 1) };
  }
}

/** Start of the local day (at the rollover hour) containing `ms`, in unix seconds — a suitable `crt` for a new collection. */
export function dayStartSecs(ms: number, rolloverHour: number, clock: Clock): number {
  return Math.floor(dayIndexStart(localDayIndex(ms, rolloverHour, clock), rolloverHour, clock) / 1000);
}
