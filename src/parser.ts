import type { CalendarEventInstance, CalendarSourceType } from "./types.ts";

export interface RawIcsEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  dtstart: string;
  dtend?: string;
  isAllDay: boolean;
  rrule?: string;
}

export function parseIcsContent(icsText: string): RawIcsEvent[] {
  // Unfold lines: RFC 5545 Section 3.1
  const unfolded = icsText.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);

  const events: RawIcsEvent[] = [];
  let inEvent = false;
  let current: Partial<RawIcsEvent> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "BEGIN:VEVENT") {
      inEvent = true;
      current = {};
      continue;
    }
    if (trimmed === "END:VEVENT") {
      inEvent = false;
      if (current.uid && current.dtstart) {
        events.push({
          uid: current.uid,
          summary: unescapeIcs(current.summary || "(無題)"),
          description: current.description ? unescapeIcs(current.description) : undefined,
          location: current.location ? unescapeIcs(current.location) : undefined,
          dtstart: current.dtstart,
          dtend: current.dtend,
          isAllDay: Boolean(current.isAllDay),
          rrule: current.rrule
        });
      }
      current = {};
      continue;
    }

    if (!inEvent) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const propPart = line.substring(0, colonIdx);
    const value = line.substring(colonIdx + 1);
    const propName = propPart.split(";")[0].toUpperCase();

    switch (propName) {
      case "UID":
        current.uid = value.trim();
        break;
      case "SUMMARY":
        current.summary = value.trim();
        break;
      case "DESCRIPTION":
        current.description = value.trim();
        break;
      case "LOCATION":
        current.location = value.trim();
        break;
      case "DTSTART":
        current.dtstart = value.trim();
        if (propPart.includes("VALUE=DATE")) {
          current.isAllDay = true;
        }
        break;
      case "DTEND":
        current.dtend = value.trim();
        break;
      case "RRULE":
        current.rrule = value.trim();
        break;
    }
  }

  return events;
}

export function parseIcsDate(dateStr: string, isAllDay = false): Date {
  const clean = dateStr.trim();
  if (isAllDay || /^[0-9]{8}$/.test(clean)) {
    const year = parseInt(clean.substring(0, 4), 10);
    const month = parseInt(clean.substring(4, 6), 10) - 1;
    const day = parseInt(clean.substring(6, 8), 10);
    // Treat as JST midnight
    return new Date(Date.UTC(year, month, day, 0, 0, 0) - 9 * 3600 * 1000);
  }

  if (clean.endsWith("Z")) {
    const year = parseInt(clean.substring(0, 4), 10);
    const month = parseInt(clean.substring(4, 6), 10) - 1;
    const day = parseInt(clean.substring(6, 8), 10);
    const hour = parseInt(clean.substring(9, 11), 10);
    const min = parseInt(clean.substring(11, 13), 10);
    const sec = parseInt(clean.substring(13, 15) || "0", 10);
    return new Date(Date.UTC(year, month, day, hour, min, sec));
  }

  // Local time (assuming Asia/Tokyo)
  const match = clean.match(/^([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    const hour = parseInt(match[4], 10);
    const min = parseInt(match[5], 10);
    const sec = parseInt(match[6], 10);
    // JST is UTC+9
    return new Date(Date.UTC(year, month, day, hour - 9, min, sec));
  }

  return new Date(clean);
}

/**
 * Expands raw events into concrete instances within a given window
 */
export function expandEventsForRange(
  rawEvents: RawIcsEvent[],
  rangeStart: Date,
  rangeEnd: Date,
  sourceType: CalendarSourceType,
  sourceName: string
): CalendarEventInstance[] {
  const instances: CalendarEventInstance[] = [];

  for (const raw of rawEvents) {
    const baseStart = parseIcsDate(raw.dtstart, raw.isAllDay);
    let baseDurationMs = 3600 * 1000;
    if (raw.dtend) {
      const baseEnd = parseIcsDate(raw.dtend, raw.isAllDay);
      baseDurationMs = baseEnd.getTime() - baseStart.getTime();
    } else if (raw.isAllDay) {
      baseDurationMs = 24 * 3600 * 1000;
    }

    if (!raw.rrule) {
      if (baseStart >= rangeStart && baseStart <= rangeEnd) {
        instances.push({
          uid: raw.uid,
          summary: raw.summary,
          originalSummary: raw.summary,
          description: raw.description,
          location: raw.location,
          start: baseStart,
          end: new Date(baseStart.getTime() + baseDurationMs),
          isAllDay: raw.isAllDay,
          sourceType,
          sourceName
        });
      }
      continue;
    }

    // Recurrence expansion (FREQ=WEEKLY or FREQ=DAILY)
    const rrule = raw.rrule;
    if (rrule.includes("FREQ=WEEKLY") || rrule.includes("FREQ=DAILY")) {
      const isDaily = rrule.includes("FREQ=DAILY");
      const dayMap: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

      const baseJst = new Date(baseStart.getTime() + 9 * 3600 * 1000);
      const bHour = baseJst.getUTCHours();
      const bMin = baseJst.getUTCMinutes();
      const bSec = baseJst.getUTCSeconds();

      let byDays: number[] = [baseJst.getUTCDay()]; // default to start day in JST
      const byDayMatch = rrule.match(/BYDAY=([A-Z,]+)/);
      if (byDayMatch) {
        byDays = byDayMatch[1].split(",").map(d => dayMap[d]).filter(d => d !== undefined);
      }

      let until = rangeEnd;
      const untilMatch = rrule.match(/UNTIL=([0-9TZ]+)/);
      if (untilMatch) {
        const uDate = parseIcsDate(untilMatch[1]);
        if (uDate < until) until = uDate;
      }

      const rStartJst = new Date(rangeStart.getTime() + 9 * 3600 * 1000);
      const rEndJst = new Date(Math.min(rangeEnd.getTime(), until.getTime()) + 9 * 3600 * 1000);

      // Start stepping by calendar day in JST
      let curYear = baseJst.getUTCFullYear();
      let curMonth = baseJst.getUTCMonth();
      let curDate = baseJst.getUTCDate();

      // Advance to rangeStart if later
      const baseJstMidnight = Date.UTC(curYear, curMonth, curDate);
      const rStartJstMidnight = Date.UTC(rStartJst.getUTCFullYear(), rStartJst.getUTCMonth(), rStartJst.getUTCDate());
      if (rStartJstMidnight > baseJstMidnight) {
        curYear = rStartJst.getUTCFullYear();
        curMonth = rStartJst.getUTCMonth();
        curDate = rStartJst.getUTCDate();
      }

      const endJstMidnight = Date.UTC(rEndJst.getUTCFullYear(), rEndJst.getUTCMonth(), rEndJst.getUTCDate());

      let currentCursor = new Date(Date.UTC(curYear, curMonth, curDate));
      while (currentCursor.getTime() <= endJstMidnight) {
        const curDayOfWeek = currentCursor.getUTCDay();
        if (isDaily || byDays.includes(curDayOfWeek)) {
          const cY = currentCursor.getUTCFullYear();
          const cM = currentCursor.getUTCMonth();
          const cD = currentCursor.getUTCDate();
          const instanceStart = new Date(Date.UTC(cY, cM, cD, bHour - 9, bMin, bSec));

          if (instanceStart >= baseStart && instanceStart >= rangeStart && instanceStart <= rangeEnd && instanceStart <= until) {
            instances.push({
              uid: `${raw.uid}-${instanceStart.toISOString()}`,
              summary: raw.summary,
              originalSummary: raw.summary,
              description: raw.description,
              location: raw.location,
              start: instanceStart,
              end: new Date(instanceStart.getTime() + baseDurationMs),
              isAllDay: raw.isAllDay,
              sourceType,
              sourceName
            });
          }
        }
        currentCursor.setUTCDate(currentCursor.getUTCDate() + 1);
      }
    }
  }

  return instances;
}

function unescapeIcs(str: string): string {
  return str.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}
