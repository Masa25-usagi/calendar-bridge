import type { CalendarEventInstance, HermesToolDef } from "./types.ts";
import { buildDailyAgenda, formatTimeJST } from "./agenda.ts";

export const HERMES_CALENDAR_TOOLS: HermesToolDef[] = [
  {
    name: "get_today_schedule",
    description: "学校カレンダー（授業・提出物等）と個人カレンダーを統合した本日の予定一覧と空き時間を取得します。",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "対象日付 (YYYY-MM-DD形式、指定なしの場合は今日JST)"
        },
        maskSchoolDetails: {
          type: "boolean",
          description: "学校の個別授業名をマスキングしてプライバシーを保護するかどうか（デフォルト: false）"
        }
      }
    }
  },
  {
    name: "check_availability",
    description: "指定した日時・時間帯に予定が入っているか空き時間かを判定します。",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "対象日付 (YYYY-MM-DD形式)"
        },
        startTime: {
          type: "string",
          description: "開始時刻 (HH:mm形式、例: '14:00')"
        },
        endTime: {
          type: "string",
          description: "終了時刻 (HH:mm形式、例: '15:30')"
        },
        maskSchoolDetails: {
          type: "boolean",
          description: "学校の個別授業名をマスキングしてプライバシーを保護するかどうか"
        }
      },
      required: ["date", "startTime", "endTime"]
    }
  }
];

export interface HermesToolError {
  code: string;
  message: string;
  retryable: boolean;
}

export type HermesToolResponse =
  | { success: true; [key: string]: unknown }
  | { success: false; error: string; errorDetail?: HermesToolError };

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidDate(s: string): boolean {
  if (!DATE_REGEX.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function parseBool(v: unknown, defaultValue = false): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === 1 || v === "1") return true;
  if (v === "false" || v === 0 || v === "0") return false;
  return defaultValue;
}

function fail(code: string, message: string, retryable = true): HermesToolResponse {
  return {
    success: false,
    error: `[${code}] ${message}`,
    errorDetail: { code, message, retryable }
  };
}

export function handleHermesToolCall(
  toolName: string,
  args: Record<string, unknown>,
  events: CalendarEventInstance[]
): HermesToolResponse {
  try {
    const shouldMaskSchool = parseBool(args.maskSchoolDetails, false);
    const effectiveEvents = shouldMaskSchool
      ? events.map(e => e.sourceType === "school" ? {
          ...e,
          summary: "【学校の予定】",
          description: undefined,
          location: undefined,
          isMasked: true
        } : e)
      : events;

    if (toolName === "get_today_schedule") {
      const todayJst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().split("T")[0];
      let targetDate = todayJst;

      if (args.date !== undefined && args.date !== null && args.date !== "") {
        if (typeof args.date !== "string" || !isValidDate(args.date)) {
          return fail("INVALID_DATE", `date は実在する YYYY-MM-DD 形式で指定してください: ${String(args.date)}`);
        }
        targetDate = args.date;
      }

      const agenda = buildDailyAgenda(effectiveEvents, targetDate);

      return {
        success: true,
        date: targetDate,
        totalEvents: agenda.events.length,
        summary: agenda.summaryText,
        markdown: agenda.markdown,
        events: agenda.events.map(e => ({
          summary: e.summary,
          startTime: e.isAllDay ? "all-day" : formatTimeJST(e.start),
          endTime: e.isAllDay ? "all-day" : formatTimeJST(e.end),
          source: e.sourceName,
          location: e.location
        })),
        conflictsCount: agenda.conflicts.length,
        freeSlots: agenda.freeSlots.map(s => ({
          start: formatTimeJST(s.start),
          end: formatTimeJST(s.end),
          durationMinutes: s.durationMinutes
        }))
      };
    }

    if (toolName === "check_availability") {
      if (typeof args.date !== "string" || !isValidDate(args.date)) {
        return fail("INVALID_DATE", `date は実在する YYYY-MM-DD 形式で指定してください: ${String(args.date)}`);
      }
      if (typeof args.startTime !== "string" || !TIME_REGEX.test(args.startTime)) {
        return fail("INVALID_TIME", `startTime は HH:mm 形式 (00:00〜23:59) で指定してください: ${String(args.startTime)}`);
      }
      if (typeof args.endTime !== "string" || !TIME_REGEX.test(args.endTime)) {
        return fail("INVALID_TIME", `endTime は HH:mm 形式 (00:00〜23:59) で指定してください: ${String(args.endTime)}`);
      }

      const dateStr = args.date;
      const startStr = args.startTime;
      const endStr = args.endTime;

      if (startStr >= endStr) {
        return fail("INVALID_RANGE", `終了時刻(${endStr})は開始時刻(${startStr})より後にしてください`);
      }

      const [y, m, d] = dateStr.split("-").map(Number);
      const [sH, sM] = startStr.split(":").map(Number);
      const [eH, eM] = endStr.split(":").map(Number);

      const reqStart = new Date(Date.UTC(y, m - 1, d, sH - 9, sM, 0));
      const reqEnd = new Date(Date.UTC(y, m - 1, d, eH - 9, eM, 0));

      const overlapping = effectiveEvents.filter(e => {
        if (e.isAllDay) return false;
        return (e.start.getTime() < reqEnd.getTime() && e.end.getTime() > reqStart.getTime());
      });

      const dayStart = new Date(Date.UTC(y, m - 1, d, 0 - 9, 0, 0));
      const nextDayStart = new Date(Date.UTC(y, m - 1, d + 1, 0 - 9, 0, 0));
      const allDayEvents = effectiveEvents.filter(e => {
        if (!e.isAllDay) return false;
        return (e.start.getTime() < nextDayStart.getTime() && e.end.getTime() > dayStart.getTime());
      });

      const isAvailable = overlapping.length === 0;

      return {
        success: true,
        date: dateStr,
        requestedRange: `${startStr}〜${endStr}`,
        isAvailable,
        allDayEvents: allDayEvents.map(e => ({
          summary: e.summary,
          source: e.sourceName
        })),
        conflicts: overlapping.map(e => ({
          summary: e.summary,
          time: `${formatTimeJST(e.start)}〜${formatTimeJST(e.end)}`,
          source: e.sourceName
        }))
      };
    }

    return fail("UNKNOWN_TOOL", `未対応のツール名です: ${toolName}`, false);
  } catch (error) {
    return fail("INTERNAL_ERROR", error instanceof Error ? error.message : String(error), false);
  }
}
