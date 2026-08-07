// Error vocabulary for @mavenmm/dev-library.
//
// The library does NOT report errors anywhere — no Sentry client, no telemetry,
// no console noise. Observability is the host app's decision (Rondie, 2026-08-06).
// What the library owes its host is errors it can actually act on WITHOUT parsing
// a message string: which step failed, what the upstream said, and whether trying
// again could ever work.
//
// Two shapes, and the difference matters:
//   - THROWN  (FeedbackError) — the operation failed and the caller must handle it.
//   - WARNED  (FeedbackWarning) — a best-effort side step failed; the main operation
//     still succeeded. Never thrown, collected into `warnings` on the result so the
//     host can log it. Previously these were `catch { return false }` and the reason
//     was destroyed at the point of capture.

/** Which library operation produced the error. Stable strings — safe to switch on. */
export type FeedbackStep =
  | "teamwork.createTask"
  | "teamwork.addComment"
  | "teamwork.moveStage"
  | "teamwork.setFollower"
  | "vimeo.createUpload"
  | "vimeo.moveToFolder"
  | "vimeo.fetchTranscript"
  | "anthropic.summarize";

/**
 * HTTP statuses where retrying the identical request can never succeed: bad
 * credentials, missing resource, malformed request. Everything else (5xx, 408,
 * 429, network failure) is treated as transient.
 *
 * This single predicate is what stops a poller from spending 80 minutes
 * re-sending a request that a dead token will reject 40 more times.
 */
export function isPermanentHttpStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 410 || status === 422;
}

interface FeedbackErrorInit {
  step: FeedbackStep;
  message: string;
  httpStatus?: number;
  responseBody?: string;
  cause?: unknown;
  /** Override the status-derived default (e.g. a malformed success payload). */
  retryable?: boolean;
}

/**
 * Every error thrown by this library. Carries `step`, the upstream HTTP status and
 * body snippet, the original `cause`, and `retryable`.
 *
 * `cause` is an own property rather than the ES2022 `Error(msg, { cause })` option
 * because this package targets ES2021 and runs in Cloudflare Workers.
 */
export class FeedbackError extends Error {
  readonly name = "FeedbackError";
  readonly step: FeedbackStep;
  readonly httpStatus?: number;
  readonly responseBody?: string;
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(init: FeedbackErrorInit) {
    super(init.message);
    this.step = init.step;
    this.httpStatus = init.httpStatus;
    this.responseBody = init.responseBody;
    this.cause = init.cause;
    this.retryable =
      init.retryable ?? (init.httpStatus === undefined ? true : !isPermanentHttpStatus(init.httpStatus));
    // Required when a class extends a built-in and the output is transpiled down.
    Object.setPrototypeOf(this, FeedbackError.prototype);
  }

  /** Flat, loggable shape — safe to JSON.stringify into a host's logger. */
  toDetail(): { step: FeedbackStep; message: string; httpStatus?: number; retryable: boolean; responseBody?: string } {
    return {
      step: this.step,
      message: this.message,
      httpStatus: this.httpStatus,
      retryable: this.retryable,
      responseBody: this.responseBody,
    };
  }
}

export function isFeedbackError(err: unknown): err is FeedbackError {
  return err instanceof FeedbackError;
}

/** A best-effort step that failed without failing the submission. Never thrown. */
export interface FeedbackWarning {
  step: FeedbackStep;
  message: string;
  httpStatus?: number;
}

/** Sink passed into best-effort helpers so the reason survives instead of being swallowed. */
export type WarningSink = FeedbackWarning[];

export function pushWarning(sink: WarningSink | undefined, warning: FeedbackWarning): void {
  sink?.push(warning);
}

/** Normalise an unknown thrown value to a message, without losing non-Error throws. */
export function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

/**
 * Read a response body IN FULL without letting the read itself throw.
 *
 * Use this whenever the body will be parsed. A response body can only be read
 * once, so the same string has to serve both `JSON.parse` and any error message —
 * truncate at the message, never at the read.
 */
export async function readBodyText(res: { text(): Promise<string> }): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<unreadable response body>";
  }
}

/** Clip a body to a sensible length for an error message. */
export function snip(text: string, limit = 300): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * Read a body purely to quote it in an error message — truncated at the source.
 *
 * DANGER: never JSON.parse the result. Doing exactly that broke Vimeo uploads in
 * v0.6.0: this clipped the response to 300 chars and the caller parsed the clipped
 * string, so every large-but-valid payload came back as "unparseable JSON".
 * Teamwork's create response is short enough to survive, which is why only the
 * video path failed. Parse with {@link readBodyText}, quote with {@link snip}.
 */
export async function safeBodyText(res: { text(): Promise<string> }, limit = 300): Promise<string> {
  return snip(await readBodyText(res), limit);
}
