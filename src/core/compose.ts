import { FEEDBACK_TYPES, type FeedbackType, type Submitter } from "./types";

export function titlePrefixFor(type: FeedbackType): string {
  return FEEDBACK_TYPES.find((t) => t.value === type)?.titlePrefix ?? "Other";
}

/**
 * HTML-escape a value on its way into a Teamwork comment.
 *
 * Coerces with String() rather than trusting the type: hosts derive `submitter`
 * from JWT/session payloads, where a numeric userId arrives as a number and used
 * to blow up here with "s.replace is not a function" — taking down the whole
 * submission over a display detail (copydeck, 2026-08-04).
 */
export function escapeHtml(s: string): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** ~Characters per paragraph when reflowing a transcript. Tuned for skimming, not exact. */
const TRANSCRIPT_PARA_CHARS = 400;
/** Default transcript cap: ~25 minutes of speech. Feedback videos run 1–3 min. */
export const TRANSCRIPT_MAX_CHARS = 15_000;

export interface TranscriptHtmlOptions {
  /** Hard cap on transcript characters before truncation. Default 15,000. */
  maxChars?: number;
  /** Linked in the truncation note, so a cut transcript never looks silently lost. */
  videoUrl?: string;
}

/**
 * Render a raw transcript as Teamwork-comment HTML.
 *
 * Three jobs, all of which matter:
 *
 *  - **Escape it.** This is untrusted speech-to-text. An unescaped `<` corrupts the
 *    whole comment body, taking the AI summary down with it.
 *  - **Reflow it.** `vttToText` space-joins every cue into one unbroken string;
 *    15,000 characters of that is a wall nobody reads. Split on sentence
 *    boundaries into skimmable paragraphs — this changes presentation only, so the
 *    text an LLM reads is identical.
 *  - **Cap it.** Truncate on a word boundary and say so, naming the recording, per
 *    Dave's "truncate with a note rather than letting the task become unreadable".
 */
export function transcriptToHtml(text: string, opts: TranscriptHtmlOptions = {}): string {
  const maxChars = opts.maxChars ?? TRANSCRIPT_MAX_CHARS;
  const full = String(text ?? "").trim();
  if (!full) return "";

  let body = full;
  let truncated = false;
  if (full.length > maxChars) {
    truncated = true;
    const cut = full.slice(0, maxChars);
    // Back off to the last space so we never end mid-word.
    const lastSpace = cut.lastIndexOf(" ");
    body = (lastSpace > maxChars * 0.8 ? cut.slice(0, lastSpace) : cut).trimEnd();
  }

  // Group whole sentences into paragraphs. A sentence longer than the target
  // simply becomes its own paragraph rather than being broken mid-thought.
  const sentences = body.split(/(?<=[.!?])\s+/);
  const paras: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    current = current ? `${current} ${sentence}` : sentence;
    if (current.length >= TRANSCRIPT_PARA_CHARS) { paras.push(current); current = ""; }
  }
  if (current) paras.push(current);

  const html = paras.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  if (!truncated) return html;

  const link = opts.videoUrl
    ? ` Watch the full recording: <a href="${escapeHtml(opts.videoUrl)}">${escapeHtml(opts.videoUrl)}</a>`
    : "";
  return `${html}<p><em>Transcript truncated at ${maxChars.toLocaleString("en-US")} characters (of ${full.length.toLocaleString("en-US")}).${link}</em></p>`;
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
  ctx: { appName: string; pageUrl: string; pageTitle?: string; userAgent?: string; viewport?: string; topicLabel?: string },
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
  if (ctx.topicLabel?.trim()) lines.push(`<strong>Area:</strong> ${escapeHtml(ctx.topicLabel.trim())}`);
  if (ctx.pageUrl) lines.push(`<strong>Page:</strong> <a href="${escapeHtml(ctx.pageUrl)}">${escapeHtml(pageLabel)}</a>`);
  const browser = [ctx.userAgent, ctx.viewport].filter(Boolean).map((b) => escapeHtml(b!));
  if (browser.length) lines.push(`<strong>Browser:</strong> ${browser.join(" · ")}`);
  return `<hr/><p>${lines.join("<br/>")}</p>`;
}
