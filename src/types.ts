export type CalendarSourceType = "school" | "personal" | "external";

export interface CalendarSource {
  id: string;
  name: string;
  type: CalendarSourceType;
  icsPathOrUrl: string;
  isReadOnly: boolean;
  maskDetailsInPublic?: boolean;
}

export interface CalendarEventInstance {
  uid: string;
  summary: string;
  originalSummary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  sourceType: CalendarSourceType;
  sourceName: string;
  isMasked?: boolean;
}

export interface TimeSlot {
  start: Date;
  end: Date;
  durationMinutes: number;
}

export interface DailyAgenda {
  date: string; // YYYY-MM-DD
  events: CalendarEventInstance[];
  conflicts: Array<{
    eventA: CalendarEventInstance;
    eventB: CalendarEventInstance;
    overlapMinutes: number;
  }>;
  freeSlots: TimeSlot[];
  summaryText: string;
  markdown: string;
}

export interface HermesToolDef {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}
