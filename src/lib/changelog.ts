// User-facing release notes shown in Settings → What's new and after an update.
// Keep CHANGELOG.md in the repo root in sync when adding a release.

import { locale, t } from "../i18n";

export interface Release {
  version: string;
  date: string;
  highlights: { title: string; text: string }[];
}

/** "October 2026" in the interface language. */
function monthName(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString(locale(), { month: "long", year: "numeric" });
}

/** A highlight whose text is looked up in the current language when read. */
function note(key: string): { title: string; text: string } {
  return {
    get title() {
      return t(`changelog.${key}.title`);
    },
    get text() {
      return t(`changelog.${key}.text`);
    },
  };
}

export const CHANGELOG: Release[] = [
  {
    version: "1.0.2",
    get date() {
      return monthName(2026, 10);
    },
    highlights: [
      note("v1_0_2.languages"),
      note("v1_0_2.voice"),
      note("v1_0_2.screenshots"),
      note("v1_0_2.tools"),
      note("v1_0_2.projects"),
      note("v1_0_2.agents"),
      note("v1_0_2.settings"),
      note("v1_0_2.phones"),
    ],
  },
  {
    version: "1.0.1",
    get date() {
      return monthName(2026, 10);
    },
    highlights: [
      note("v1_0_1.pastDetails"),
    ],
  },
  {
    version: "1.0.0",
    get date() {
      return monthName(2026, 10);
    },
    highlights: [
      note("v1_0_0.madeForClaudeCode"),
      note("v1_0_0.approveAnywhere"),
      note("v1_0_0.usageLimits"),
      note("v1_0_0.agentsTab"),
      note("v1_0_0.usageAtAGlance"),
      note("v1_0_0.builtInBrowser"),
      note("v1_0_0.filesOpenInHelm"),
      note("v1_0_0.backgroundWork"),
      note("v1_0_0.saveUsage"),
      note("v1_0_0.promptImprover"),
      note("v1_0_0.tabStatus"),
      note("v1_0_0.historyAndPalette"),
      note("v1_0_0.reviewChanges"),
      note("v1_0_0.parallelTasks"),
      note("v1_0_0.keepConversations"),
      note("v1_0_0.statusBar"),
      note("v1_0_0.makeItYours"),
      note("v1_0_0.claudeCodeSettings"),
      note("v1_0_0.windowsDoneRight"),
      note("v1_0_0.private"),
    ],
  },
];
