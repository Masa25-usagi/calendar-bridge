import type { CalendarEventInstance, CalendarSource, DailyAgenda, TimeSlot } from "./types.ts";
import { parseIcsContent, expandEventsForRange } from "./parser.ts";

export interface MergeOptions {
  maskSchoolDetails?: boolean;
}

export function loadAndMergeSources(
  sources: Array<{ source: CalendarSource; icsContent: string }>,
  rangeStart: Date,
  rangeEnd: Date,
  options: MergeOptions = {}
): CalendarEventInstance[] {
  let allInstances: CalendarEventInstance[] = [];

  for (const { source, icsContent } of sources) {
    const rawEvents = parseIcsContent(icsContent);
    const instances = expandEventsForRange(rawEvents, rangeStart, rangeEnd, source.type, source.name);

    for (const inst of instances) {
      if (options.maskSchoolDetails && source.maskDetailsInPublic) {
        inst.summary = "【学校の予定】";
        inst.description = undefined;
        inst.location = undefined;
        inst.isMasked = true;
      }
      allInstances.push(inst);
    }
  }

  // Sort by start time ascending
  allInstances.sort((a, b) => a.start.getTime() - b.start.getTime());
  return allInstances;
}

export function detectConflicts(events: CalendarEventInstance[]) {
  const conflicts: DailyAgenda["conflicts"] = [];
  const timedEvents = events.filter(e => !e.isAllDay);

  for (let i = 0; i < timedEvents.length; i++) {
    for (let j = i + 1; j < timedEvents.length; j++) {
      const a = timedEvents[i];
      const b = timedEvents[j];

      const overlapStart = Math.max(a.start.getTime(), b.start.getTime());
      const overlapEnd = Math.min(a.end.getTime(), b.end.getTime());

      if (overlapEnd > overlapStart) {
        const overlapMinutes = Math.round((overlapEnd - overlapStart) / 60000);
        conflicts.push({ eventA: a, eventB: b, overlapMinutes });
      }
    }
  }

  return conflicts;
}

export function findFreeSlots(
  events: CalendarEventInstance[],
  dayStart: Date,
  dayEnd: Date,
  minDurationMinutes = 30
): TimeSlot[] {
  const timed = events.filter(e => !e.isAllDay).sort((a, b) => a.start.getTime() - b.start.getTime());
  const freeSlots: TimeSlot[] = [];

  let cursor = dayStart.getTime();
  for (const ev of timed) {
    const evStart = Math.min(Math.max(ev.start.getTime(), dayStart.getTime()), dayEnd.getTime());
    const evEnd = Math.min(Math.max(ev.end.getTime(), dayStart.getTime()), dayEnd.getTime());

    if (evStart > cursor) {
      const durationMin = Math.round((evStart - cursor) / 60000);
      if (durationMin >= minDurationMinutes) {
        freeSlots.push({
          start: new Date(cursor),
          end: new Date(evStart),
          durationMinutes: durationMin
        });
      }
    }
    if (evEnd > cursor) {
      cursor = evEnd;
    }
  }

  if (dayEnd.getTime() > cursor) {
    const durationMin = Math.round((dayEnd.getTime() - cursor) / 60000);
    if (durationMin >= minDurationMinutes) {
      freeSlots.push({
        start: new Date(cursor),
        end: new Date(dayEnd),
        durationMinutes: durationMin
      });
    }
  }

  return freeSlots;
}
