import test from "node:test";
import assert from "node:assert/strict";
import { handleHermesToolCall, HERMES_CALENDAR_TOOLS } from "../src/hermes_tool.ts";
import { loadAndMergeSources } from "../src/merger.ts";
import type { CalendarSource } from "../src/types.ts";

const sampleIcs = `
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:sample-mtg-1
SUMMARY:政策提言レビュー
DTSTART;TZID=Asia/Tokyo:20261005T150000
DTEND;TZID=Asia/Tokyo:20261005T163000
END:VEVENT
END:VCALENDAR
`;

test("HERMES_CALENDAR_TOOLS defines valid schema", () => {
  assert.equal(HERMES_CALENDAR_TOOLS.length, 2);
  assert.equal(HERMES_CALENDAR_TOOLS[0].name, "get_today_schedule");
  assert.equal(HERMES_CALENDAR_TOOLS[1].name, "check_availability");
});

test("handleHermesToolCall get_today_schedule returns structured agenda", () => {
  const sources = [
    {
      source: { id: "p1", name: "個人", type: "personal", icsPathOrUrl: "", isReadOnly: false } as CalendarSource,
      icsContent: sampleIcs
    }
  ];
  const rangeStart = new Date(Date.UTC(2026, 9, 5, 0 - 9, 0, 0));
  const rangeEnd = new Date(Date.UTC(2026, 9, 5, 23 - 9, 59, 59));
  const events = loadAndMergeSources(sources, rangeStart, rangeEnd);

  const res = handleHermesToolCall("get_today_schedule", { date: "2026-10-05" }, events) as any;
  assert.equal(res.success, true);
  assert.equal(res.date, "2026-10-05");
  assert.equal(res.totalEvents, 1);
  assert.equal(res.events[0].summary, "政策提言レビュー");
  assert.equal(res.events[0].startTime, "15:00");
  assert.equal(res.events[0].endTime, "16:30");
});

test("handleHermesToolCall check_availability returns true when free, false when busy", () => {
  const sources = [
    {
      source: { id: "p1", name: "個人", type: "personal", icsPathOrUrl: "", isReadOnly: false } as CalendarSource,
      icsContent: sampleIcs
    }
  ];
  const rangeStart = new Date(Date.UTC(2026, 9, 5, 0 - 9, 0, 0));
  const rangeEnd = new Date(Date.UTC(2026, 9, 5, 23 - 9, 59, 59));
  const events = loadAndMergeSources(sources, rangeStart, rangeEnd);

  // 10:00 - 11:00 is free
  const freeRes = handleHermesToolCall("check_availability", { date: "2026-10-05", startTime: "10:00", endTime: "11:00" }, events) as any;
  assert.equal(freeRes.isAvailable, true);
  assert.equal(freeRes.conflicts.length, 0);

  // 15:30 - 16:00 is busy
  const busyRes = handleHermesToolCall("check_availability", { date: "2026-10-05", startTime: "15:30", endTime: "16:00" }, events) as any;
  assert.equal(busyRes.isAvailable, false);
  assert.equal(busyRes.conflicts.length, 1);
  assert.equal(busyRes.conflicts[0].summary, "政策提言レビュー");
});

test("handleHermesToolCall honors maskSchoolDetails for school events", () => {
  const schoolIcs = `
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:school-private-1
SUMMARY:生徒面談・秘密特訓
LOCATION:校長室
DTSTART;TZID=Asia/Tokyo:20261005T100000
DTEND;TZID=Asia/Tokyo:20261005T110000
END:VEVENT
END:VCALENDAR
`;
  const sources = [
    {
      source: { id: "s1", name: "学校カレンダー", type: "school", icsPathOrUrl: "", isReadOnly: true, maskDetailsInPublic: true } as CalendarSource,
      icsContent: schoolIcs
    }
  ];
  const rangeStart = new Date(Date.UTC(2026, 9, 5, 0 - 9, 0, 0));
  const rangeEnd = new Date(Date.UTC(2026, 9, 5, 23 - 9, 59, 59));
  const events = loadAndMergeSources(sources, rangeStart, rangeEnd);

  // When masked:
  const maskedRes = handleHermesToolCall("get_today_schedule", { date: "2026-10-05", maskSchoolDetails: true }, events) as any;
  assert.equal(maskedRes.success, true);
  assert.equal(maskedRes.events[0].summary, "【学校の予定】");
  assert.equal(maskedRes.events[0].location, undefined);

  // When unmasked:
  const unmaskedRes = handleHermesToolCall("get_today_schedule", { date: "2026-10-05", maskSchoolDetails: false }, events) as any;
  assert.equal(unmaskedRes.events[0].summary, "生徒面談・秘密特訓");

  // Availability conflict masking
  const availRes = handleHermesToolCall("check_availability", { date: "2026-10-05", startTime: "10:15", endTime: "10:45", maskSchoolDetails: true }, events) as any;
  assert.equal(availRes.isAvailable, false);
  assert.equal(availRes.conflicts[0].summary, "【学校の予定】");
});

test("handleHermesToolCall validates arguments and returns structured error", () => {
  const events: any[] = [];

  // 1. Invalid date (leap year / non-existent date)
  const errDate1 = handleHermesToolCall("get_today_schedule", { date: "2026-02-30" }, events);
  assert.equal(errDate1.success, false);
  assert.equal(errDate1.errorDetail?.code, "INVALID_DATE");

  // 2. Inverted time range (startTime >= endTime)
  const errRange = handleHermesToolCall("check_availability", { date: "2026-10-05", startTime: "15:00", endTime: "14:00" }, events);
  assert.equal(errRange.success, false);
  assert.equal(errRange.errorDetail?.code, "INVALID_RANGE");

  // 3. parseBool correctly handles string "false" from LLMs without converting to true
  const sampleSchoolEvent: any = {
    summary: "数学特講",
    start: new Date(Date.UTC(2026, 9, 5, 1, 0)),
    end: new Date(Date.UTC(2026, 9, 5, 2, 0)),
    sourceType: "school",
    sourceName: "学校"
  };
  const stringFalseRes = handleHermesToolCall("get_today_schedule", { date: "2026-10-05", maskSchoolDetails: "false" }, [sampleSchoolEvent]) as any;
  assert.equal(stringFalseRes.success, true);
  assert.equal(stringFalseRes.events[0].summary, "数学特講", "maskSchoolDetails='false' must NOT mask events");

  // 4. Unknown tool returns UNKNOWN_TOOL error
  const unknownRes = handleHermesToolCall("non_existent_tool", {}, events);
  assert.equal(unknownRes.success, false);
  assert.equal(unknownRes.errorDetail?.code, "UNKNOWN_TOOL");
});

test("all-day events ending at midnight do not leak into the next day agenda or availability", () => {
  const yesterdayAllDay: any = {
    summary: "昨日の終日イベント",
    sourceType: "personal",
    sourceName: "Personal",
    isAllDay: true,
    start: new Date("2026-10-02T15:00:00Z"), // 2026-10-03 00:00:00 JST
    end: new Date("2026-10-03T15:00:00Z"),   // 2026-10-04 00:00:00 JST (exclusive end date)
  };

  // Availability check for 2026-10-04
  const res = handleHermesToolCall("check_availability", {
    date: "2026-10-04",
    startTime: "10:00",
    endTime: "11:00"
  }, [yesterdayAllDay]) as any;

  assert.equal(res.success, true);
  assert.equal(res.allDayEvents.length, 0, "Yesterday all-day event must not leak into today allDayEvents");

  // Today agenda check for 2026-10-04
  const agendaRes = handleHermesToolCall("get_today_schedule", {
    date: "2026-10-04"
  }, [yesterdayAllDay]) as any;

  assert.equal(agendaRes.success, true);
  assert.equal(agendaRes.events.length, 0, "Yesterday all-day event must not appear in today agenda events");
});

