#!/usr/bin/env node
import fs from "node:fs";
import { loadAndMergeSources } from "./merger.ts";
import { buildDailyAgenda } from "./agenda.ts";
import { handleHermesToolCall } from "./hermes_tool.ts";
import type { CalendarSource } from "./types.ts";

function printUsage() {
  console.log(`
calendar-bridge - School & Personal Calendar Bridge for Hermes / AI Agent

Usage:
  calendar-bridge agenda [--date YYYY-MM-DD] [--school school.ics] [--personal personal.ics] [--json]
  calendar-bridge hermes-query <toolName> <jsonArgs> [--school school.ics] [--personal personal.ics]
`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const command = args[0];

  let schoolIcsPath = "";
  let personalIcsPath = "";
  let targetDate = new Date(Date.now() + 9 * 3600 * 1000).toISOString().split("T")[0];
  let asJson = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--school" && args[i + 1]) schoolIcsPath = args[++i];
    else if (args[i] === "--personal" && args[i + 1]) personalIcsPath = args[++i];
    else if (args[i] === "--date" && args[i + 1]) targetDate = args[++i];
    else if (args[i] === "--json") asJson = true;
  }

  const sources: Array<{ source: CalendarSource; icsContent: string }> = [];

  if (schoolIcsPath && fs.existsSync(schoolIcsPath)) {
    sources.push({
      source: { id: "school", name: "学校カレンダー", type: "school", icsPathOrUrl: schoolIcsPath, isReadOnly: true, maskDetailsInPublic: true },
      icsContent: fs.readFileSync(schoolIcsPath, "utf-8")
    });
  }

  if (personalIcsPath && fs.existsSync(personalIcsPath)) {
    sources.push({
      source: { id: "personal", name: "個人カレンダー", type: "personal", icsPathOrUrl: personalIcsPath, isReadOnly: false },
      icsContent: fs.readFileSync(personalIcsPath, "utf-8")
    });
  }

  const [y, m, d] = targetDate.split("-").map(Number);
  const rangeStart = new Date(Date.UTC(y, m - 1, d, 0 - 9, 0, 0));
  const rangeEnd = new Date(Date.UTC(y, m - 1, d, 23 - 9, 59, 59));

  const events = loadAndMergeSources(sources, rangeStart, rangeEnd);

  if (command === "agenda") {
    const agenda = buildDailyAgenda(events, targetDate);
    if (asJson) {
      console.log(JSON.stringify(agenda, null, 2));
    } else {
      console.log(agenda.markdown);
      console.log("\n" + agenda.summaryText);
    }
    return;
  }

  if (command === "hermes-query") {
    const toolName = args[1] || "get_today_schedule";
    let toolArgs = {};
    try {
      if (args[2] && args[2].startsWith("{")) {
        toolArgs = JSON.parse(args[2]);
      }
    } catch {}
    const result = handleHermesToolCall(toolName, toolArgs, events);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
