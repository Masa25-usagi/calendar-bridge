import test from "node:test";
import assert from "node:assert/strict";
import { parseIcsContent, parseIcsDate, expandEventsForRange } from "../src/parser.ts";

const sampleIcs = `
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//School Calendar//EN
BEGIN:VEVENT
UID:user-1f0a885@example.com
SUMMARY:解析幾何学 II
DESCRIPTION:第3講義室 担当：山田教授
LOCATION:第3講義室
DTSTART;TZID=Asia/Tokyo:20261005T090000
DTEND;TZID=Asia/Tokyo:20261005T103000
RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261225T150000Z
END:VEVENT
BEGIN:VEVENT
UID:user-5fe6fd5@example.com
SUMMARY:レポート提出締切
DTSTART;VALUE=DATE:20261005
DTEND;VALUE=DATE:20261005
END:VEVENT
END:VCALENDAR
`;

test("parseIcsContent parses UID, summary, and RRULE correctly", () => {
  const raw = parseIcsContent(sampleIcs);
  assert.equal(raw.length, 2);
  assert.equal(raw[0].summary, "解析幾何学 II");
  assert.equal(raw[0].rrule?.includes("FREQ=WEEKLY"), true);
  assert.equal(raw[1].isAllDay, true);
});

test("parseIcsDate converts JST and UTC dates into Date objects", () => {
  const dJst = parseIcsDate("20261005T090000"); // 09:00 JST -> 00:00 UTC
  assert.equal(dJst.getUTCHours(), 0);
  assert.equal(dJst.getUTCDate(), 5);

  const dUtc = parseIcsDate("20261005T090000Z"); // 09:00 UTC
  assert.equal(dUtc.getUTCHours(), 9);
});

test("expandEventsForRange expands weekly recurring event to target date", () => {
  const raw = parseIcsContent(sampleIcs);
  // Target window: 2026-10-12 (a Monday)
  const rangeStart = new Date(Date.UTC(2026, 9, 12, 0 - 9, 0, 0));
  const rangeEnd = new Date(Date.UTC(2026, 9, 12, 23 - 9, 59, 59));

  const instances = expandEventsForRange(raw, rangeStart, rangeEnd, "school", "学校カレンダー");
  assert.equal(instances.length, 1);
  assert.equal(instances[0].summary, "解析幾何学 II");
  assert.equal(instances[0].sourceName, "学校カレンダー");
});

test("expandEventsForRange correctly expands morning recurring event (08:30 JST) without shifting day", () => {
  const morningIcs = `
BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:morning-mtg@example.com
SUMMARY:朝礼ミーティング
DTSTART;TZID=Asia/Tokyo:20261005T083000
DTEND;TZID=Asia/Tokyo:20261005T090000
RRULE:FREQ=WEEKLY;BYDAY=MO
END:VEVENT
END:VCALENDAR
`;
  const raw = parseIcsContent(morningIcs);
  // Target: Monday Oct 12, 2026
  const rangeStart = new Date(Date.UTC(2026, 9, 12, 0 - 9, 0, 0));
  const rangeEnd = new Date(Date.UTC(2026, 9, 12, 23 - 9, 59, 59));

  const instances = expandEventsForRange(raw, rangeStart, rangeEnd, "personal", "個人");
  assert.equal(instances.length, 1);
  assert.equal(instances[0].summary, "朝礼ミーティング");
  // In JST, it must be on 2026-10-12 (Monday), NOT 2026-10-13 (Tuesday)
  const instJst = new Date(instances[0].start.getTime() + 9 * 3600 * 1000);
  assert.equal(instJst.getUTCFullYear(), 2026);
  assert.equal(instJst.getUTCMonth(), 9); // Oct
  assert.equal(instJst.getUTCDate(), 12);
  assert.equal(instJst.getUTCHours(), 8);
  assert.equal(instJst.getUTCMinutes(), 30);
});
