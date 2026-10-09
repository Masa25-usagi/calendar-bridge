import type { CalendarEventInstance, DailyAgenda } from "./types.ts";
import { detectConflicts, findFreeSlots } from "./merger.ts";

export function formatTimeJST(d: Date): string {
  // Convert UTC date to JST string (HH:mm)
  const jst = new Date(d.getTime() + 9 * 3600 * 1000);
  const h = jst.getUTCHours().toString().padStart(2, "0");
  const m = jst.getUTCMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

export function buildDailyAgenda(events: CalendarEventInstance[], dateStr: string): DailyAgenda {
  // Parse dateStr (YYYY-MM-DD)
  const [y, m, d] = dateStr.split("-").map(Number);
  // Start of day in JST: UTC (y, m-1, d, 0 - 9)
  const dayStart = new Date(Date.UTC(y, m - 1, d, 0 - 9, 0, 0));
  const nextDayStart = new Date(Date.UTC(y, m - 1, d + 1, 0 - 9, 0, 0));

  // Business hours for free slots: 09:00 to 21:00 JST
  const bizStart = new Date(Date.UTC(y, m - 1, d, 9 - 9, 0, 0));
  const bizEnd = new Date(Date.UTC(y, m - 1, d, 21 - 9, 0, 0));

  const todaysEvents = events.filter(e => {
    return (e.start.getTime() < nextDayStart.getTime() && e.end.getTime() > dayStart.getTime());
  }).sort((a, b) => a.start.getTime() - b.start.getTime());

  const conflicts = detectConflicts(todaysEvents);
  const freeSlots = findFreeSlots(todaysEvents, bizStart, bizEnd, 30);

  // Build summary text
  let summaryText = "";
  if (todaysEvents.length === 0) {
    summaryText = `本日（${dateStr}）の予定はありません。終日空いています。`;
  } else {
    const timedDesc = todaysEvents.map(e => {
      if (e.isAllDay) return `・[終日] ${e.summary} (${e.sourceName})`;
      return `・${formatTimeJST(e.start)}〜${formatTimeJST(e.end)} ${e.summary} (${e.sourceName})`;
    }).join("\n");
    summaryText = `本日（${dateStr}）の予定は ${todaysEvents.length} 件です。\n${timedDesc}`;
  }

  if (conflicts.length > 0) {
    summaryText += `\n⚠️ 【注意】${conflicts.length} 件の予定重複（コンフリクト）があります。`;
  }

  // Build markdown
  const mdLines = [
    `### 📅 今日の予定 (${dateStr})`,
    "",
    todaysEvents.length === 0
      ? "本日の予定はありません。"
      : "| 時間 | 予定名 | 区分 | 場所 |",
    todaysEvents.length === 0
      ? ""
      : "|---|---|---|---|"
  ];

  for (const ev of todaysEvents) {
    const timeStr = ev.isAllDay ? "終日" : `${formatTimeJST(ev.start)}〜${formatTimeJST(ev.end)}`;
    const loc = ev.location || "-";
    mdLines.push(`| ${timeStr} | ${ev.summary} | ${ev.sourceName} | ${loc} |`);
  }

  if (conflicts.length > 0) {
    mdLines.push("");
    mdLines.push("#### ⚠️ 重複している予定");
    for (const c of conflicts) {
      mdLines.push(`- **${c.eventA.summary}** と **${c.eventB.summary}** が ${c.overlapMinutes} 分間重複しています。`);
    }
  }

  if (freeSlots.length > 0) {
    mdLines.push("");
    mdLines.push("#### ☕ 主な空き時間帯 (09:00〜21:00)");
    for (const slot of freeSlots) {
      mdLines.push(`- ${formatTimeJST(slot.start)}〜${formatTimeJST(slot.end)} (${slot.durationMinutes}分)`);
    }
  }

  return {
    date: dateStr,
    events: todaysEvents,
    conflicts,
    freeSlots,
    summaryText,
    markdown: mdLines.join("\n")
  };
}
