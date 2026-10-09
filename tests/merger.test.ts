import test from "node:test";
import assert from "node:assert/strict";
import { loadAndMergeSources, detectConflicts, findFreeSlots } from "../src/merger.ts";
import { buildDailyAgenda } from "../src/agenda.ts";
import type { CalendarSource } from "../src/types.ts";

const schoolIcs = `
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:class-algo@school
SUMMARY:アルゴリズム基礎
DTSTART;TZID=Asia/Tokyo:20261005T130000
DTEND;TZID=Asia/Tokyo:20261005T143000
END:VEVENT
END:VCALENDAR
`;

const personalIcs = `
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:mtg-team@personal
SUMMARY:政治部ミーティング
DTSTART;TZID=Asia/Tokyo:20261005T140000
DTEND;TZID=Asia/Tokyo:20261005T150000
END:VEVENT
BEGIN:VEVENT
UID:cram-school@personal
SUMMARY:通塾・個別指導
DTSTART;TZID=Asia/Tokyo:20261005T170000
DTEND;TZID=Asia/Tokyo:20261005T183000
END:VEVENT
END:VCALENDAR
`;

test("loadAndMergeSources combines sources and detects 30min conflict", () => {
  const sources = [
    {
      source: { id: "s1", name: "学校", type: "school", icsPathOrUrl: "", isReadOnly: true } as CalendarSource,
      icsContent: schoolIcs
    },
    {
      source: { id: "p1", name: "個人", type: "personal", icsPathOrUrl: "", isReadOnly: false } as CalendarSource,
      icsContent: personalIcs
    }
  ];

  const rangeStart = new Date(Date.UTC(2026, 9, 5, 0 - 9, 0, 0));
  const rangeEnd = new Date(Date.UTC(2026, 9, 5, 23 - 9, 59, 59));

  const events = loadAndMergeSources(sources, rangeStart, rangeEnd);
  assert.equal(events.length, 3);

  const conflicts = detectConflicts(events);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].overlapMinutes, 30);
  assert.equal(conflicts[0].eventA.summary, "アルゴリズム基礎");
  assert.equal(conflicts[0].eventB.summary, "政治部ミーティング");
});

test("loadAndMergeSources supports privacy masking for school events", () => {
  const sources = [
    {
      source: { id: "s1", name: "学校", type: "school", icsPathOrUrl: "", isReadOnly: true, maskDetailsInPublic: true } as CalendarSource,
      icsContent: schoolIcs
    }
  ];
  const rangeStart = new Date(Date.UTC(2026, 9, 5, 0 - 9, 0, 0));
  const rangeEnd = new Date(Date.UTC(2026, 9, 5, 23 - 9, 59, 59));

  const events = loadAndMergeSources(sources, rangeStart, rangeEnd, { maskSchoolDetails: true });
  assert.equal(events[0].summary, "【学校の予定】");
  assert.equal(events[0].isMasked, true);
});

test("buildDailyAgenda calculates free slots between 09:00 and 21:00", () => {
  const sources = [
    {
      source: { id: "p1", name: "個人", type: "personal", icsPathOrUrl: "", isReadOnly: false } as CalendarSource,
      icsContent: personalIcs
    }
  ];
  const rangeStart = new Date(Date.UTC(2026, 9, 5, 0 - 9, 0, 0));
  const rangeEnd = new Date(Date.UTC(2026, 9, 5, 23 - 9, 59, 59));
  const events = loadAndMergeSources(sources, rangeStart, rangeEnd);

  const agenda = buildDailyAgenda(events, "2026-10-05");
  assert.equal(agenda.events.length, 2);
  assert.equal(agenda.freeSlots.length >= 2, true);
  // Free slot from 09:00 to 14:00 (300 min)
  assert.equal(agenda.freeSlots[0].durationMinutes, 300);
});

test("findFreeSlots clamps correctly and does not extend free slots past dayEnd for late night events", () => {
  const dayStart = new Date("2026-10-05T00:00:00Z"); // 09:00 JST
  const dayEnd = new Date("2026-10-05T12:00:00Z");   // 21:00 JST
  // Late event at 22:00 JST (13:00 UTC)
  const lateEvent: any = {
    summary: "Late Night Code",
    sourceType: "personal",
    sourceName: "Personal",
    isAllDay: false,
    start: new Date("2026-10-05T13:00:00Z"),
    end: new Date("2026-10-05T14:00:00Z")
  };

  const slots = findFreeSlots([lateEvent], dayStart, dayEnd, 30);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].start.getTime(), dayStart.getTime());
  assert.equal(slots[0].end.getTime(), dayEnd.getTime(), "Free slot end must be strictly clamped to dayEnd");
  assert.equal(slots[0].durationMinutes, 720); // 12 hours between 09:00 and 21:00
});

