import { FEEDBACK_TYPES, type FeedbackType, type Submitter } from "./types";

export function titlePrefixFor(type: FeedbackType): string {
  return FEEDBACK_TYPES.find((t) => t.value === type)?.titlePrefix ?? "Other";
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Eastern-time "Mon DD" task-title date prefix (America/Toronto), matching copydeck. */
export function easternDatePrefix(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", month: "short", day: "numeric" }).format(now);
}

export function buildTitle(type: FeedbackType, subject: string, now: Date = new Date()): string {
  return `(${easternDatePrefix(now)}) [${titlePrefixFor(type)}] ${subject}`;
}

export function buildContextHtml(
  submitter: Submitter,
  ctx: { appName: string; pageUrl: string; pageTitle?: string; userAgent?: string; viewport?: string },
): string {
  const who = submitter.name
    ? escapeHtml(submitter.name)
    : submitter.userId
      ? `user #${escapeHtml(submitter.userId)}`
      : "Unknown user";
  const email = submitter.email ? ` (${escapeHtml(submitter.email)})` : "";
  const pageLabel = ctx.pageTitle?.trim() || ctx.pageUrl;
  const lines: string[] = [
    `<strong>Submitted by:</strong> ${who}${email}`,
    `<strong>App:</strong> ${escapeHtml(ctx.appName)}`,
  ];
  if (ctx.pageUrl) lines.push(`<strong>Page:</strong> <a href="${escapeHtml(ctx.pageUrl)}">${escapeHtml(pageLabel)}</a>`);
  const browser = [ctx.userAgent, ctx.viewport].filter(Boolean).map((b) => escapeHtml(b!));
  if (browser.length) lines.push(`<strong>Browser:</strong> ${browser.join(" · ")}`);
  return `<hr/><p>${lines.join("<br/>")}</p>`;
}
