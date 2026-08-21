/** Which library operation produced the error. Stable strings — safe to switch on. */
type FeedbackStep = "teamwork.createTask" | "teamwork.addComment" | "teamwork.moveStage" | "teamwork.setFollower" | "vimeo.createUpload" | "vimeo.moveToFolder" | "vimeo.frames" | "vimeo.fetchTranscript" | "anthropic.summarize";
/**
 * HTTP statuses where retrying the identical request can never succeed: bad
 * credentials, missing resource, malformed request. Everything else (5xx, 408,
 * 429, network failure) is treated as transient.
 *
 * This single predicate is what stops a poller from spending 80 minutes
 * re-sending a request that a dead token will reject 40 more times.
 */
declare function isPermanentHttpStatus(status: number): boolean;
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
declare class FeedbackError extends Error {
    readonly name = "FeedbackError";
    readonly step: FeedbackStep;
    readonly httpStatus?: number;
    readonly responseBody?: string;
    readonly retryable: boolean;
    readonly cause?: unknown;
    constructor(init: FeedbackErrorInit);
    /** Flat, loggable shape — safe to JSON.stringify into a host's logger. */
    toDetail(): {
        step: FeedbackStep;
        message: string;
        httpStatus?: number;
        retryable: boolean;
        responseBody?: string;
    };
}
declare function isFeedbackError(err: unknown): err is FeedbackError;
/** A best-effort step that failed without failing the submission. Never thrown. */
interface FeedbackWarning {
    step: FeedbackStep;
    message: string;
    httpStatus?: number;
}
/** Sink passed into best-effort helpers so the reason survives instead of being swallowed. */
type WarningSink = FeedbackWarning[];
declare function pushWarning(sink: WarningSink | undefined, warning: FeedbackWarning): void;
/** Normalise an unknown thrown value to a message, without losing non-Error throws. */
declare function messageOf(err: unknown): string;
/**
 * Read a response body IN FULL without letting the read itself throw.
 *
 * Use this whenever the body will be parsed. A response body can only be read
 * once, so the same string has to serve both `JSON.parse` and any error message —
 * truncate at the message, never at the read.
 */
declare function readBodyText(res: {
    text(): Promise<string>;
}): Promise<string>;
/** Clip a body to a sensible length for an error message. */
declare function snip(text: string, limit?: number): string;
/**
 * Read a body purely to quote it in an error message — truncated at the source.
 *
 * DANGER: never JSON.parse the result. Doing exactly that broke Vimeo uploads in
 * v0.6.0: this clipped the response to 300 chars and the caller parsed the clipped
 * string, so every large-but-valid payload came back as "unparseable JSON".
 * Teamwork's create response is short enough to survive, which is why only the
 * video path failed. Parse with {@link readBodyText}, quote with {@link snip}.
 */
declare function safeBodyText(res: {
    text(): Promise<string>;
}, limit?: number): Promise<string>;

type FeedbackType = "bug" | "feature" | "working_well" | "other";
interface FeedbackTypeOption {
    value: FeedbackType;
    label: string;
    titlePrefix: string;
}
declare const FEEDBACK_TYPES: FeedbackTypeOption[];
interface TeamworkConfig {
    baseUrl: string;
    tasklistId: string;
    assigneeId: string;
    workflowId: string;
    stageId: string;
    /** When set, followers are reset to ONLY this id after posting (copydeck shared-token case). */
    soleFollowerId?: string;
}
/** Per-app Vimeo settings (the token is a secret, supplied separately). */
interface VimeoConfig {
    folderId?: string;
}
interface FeedbackConfig {
    /** Human label shown in the task's context block, e.g. "Maven Home". */
    appName: string;
    teamwork: TeamworkConfig;
    /** Per-app Vimeo folder (video path; Phase 2b). */
    vimeo?: VimeoConfig;
    /** Per-app public base URL for hosted screenshots (e.g. an S3/R2 domain). */
    screenshotBaseUrl?: string;
    summary?: {
        model?: string;
        maxTokens?: number;
    };
    /**
     * What accompanies the AI summary in the async comment (Teamwork 41044223).
     *
     * The defaults deliberately switch this on for every app without touching
     * per-app config — six entries would be six chances to miss one.
     */
    videoComment?: {
        /** Append the raw transcript below the summary. Default true. */
        includeTranscript?: boolean;
        /** Cap before truncation-with-a-note. Default 15,000. */
        transcriptMaxChars?: number;
        /** Still frames to attach. Default 2; 0 disables. */
        frameCount?: number;
    };
}
/** Server-side secrets — NEVER sent to the browser. */
interface Secrets {
    teamworkToken: string;
    vimeoToken?: string;
    anthropicKey?: string;
}
interface Submitter {
    name?: string;
    email?: string;
    userId?: string;
}
interface CreateTextFeedbackInput {
    type: FeedbackType;
    subject: string;
    bodyHtml?: string;
    /** Optional human-readable area/category (shown in the task), e.g. "Agentic feature". */
    topicLabel?: string;
    pageUrl: string;
    pageTitle?: string;
    userAgent?: string;
    viewport?: string;
}
/**
 * `warnings` lists best-effort steps that failed while the submission itself
 * succeeded (stage move, follower reset, Vimeo folder filing). The task exists and
 * the user should be told it worked — but the host has something worth logging.
 * Absent or empty means everything landed.
 *
 * On failure, `step` and `retryable` come straight off the FeedbackError so a host
 * can branch without parsing `error`.
 */
type CreateFeedbackResult = {
    ok: true;
    taskId: string;
    url: string;
    warnings?: string[];
} | {
    ok: false;
    error: string;
    step?: FeedbackStep;
    retryable?: boolean;
};
interface VideoUploadTarget {
    videoId: string;
    videoUri: string;
    uploadLink: string;
}
interface SubmitVideoInput {
    type: FeedbackType;
    subject: string;
    videoId: string;
    videoUri: string;
    /**
     * Whether the recording carried any sound (the widget measures it live).
     * `false` means no narration was captured, so Vimeo can never produce
     * auto-captions — the video is NOT queued for summarisation at all. Omitted by
     * older clients, which keeps today's optimistic behaviour of queueing anyway.
     */
    hasAudio?: boolean;
    /** Optional human-readable area/category (shown in the task), e.g. "Agentic feature". */
    topicLabel?: string;
    pageUrl: string;
    pageTitle?: string;
    userAgent?: string;
    viewport?: string;
}
/** Descriptor the host/poller persists so the transcript can be summarized later. */
interface PendingVideo {
    taskId: string;
    videoId: string;
    videoUri?: string;
}
interface SubmitVideoResult {
    result: CreateFeedbackResult;
    pending?: PendingVideo;
}
type SummaryOutcome = {
    status: "summarized";
    warnings?: string[];
} | {
    status: "retry";
}
/**
 * `permanent: true` means retrying is pointless (dead token, deleted video, bad
 * request). A poller MUST stop and surface it rather than spending its attempt
 * budget — the alternative is what let an expired token look like a slow
 * transcript for six days.
 */
 | {
    status: "failed";
    error: string;
    permanent?: boolean;
    step?: FeedbackStep;
};

declare function titlePrefixFor(type: FeedbackType): string;
/**
 * HTML-escape a value on its way into a Teamwork comment.
 *
 * Coerces with String() rather than trusting the type: hosts derive `submitter`
 * from JWT/session payloads, where a numeric userId arrives as a number and used
 * to blow up here with "s.replace is not a function" — taking down the whole
 * submission over a display detail (copydeck, 2026-08-04).
 */
declare function escapeHtml(s: string): string;
/** Default transcript cap: ~25 minutes of speech. Feedback videos run 1–3 min. */
declare const TRANSCRIPT_MAX_CHARS = 15000;
interface TranscriptHtmlOptions {
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
declare function transcriptToHtml(text: string, opts?: TranscriptHtmlOptions): string;
/** Eastern-time "Mon DD" task-title date prefix (America/Toronto), matching copydeck. */
declare function easternDatePrefix(now?: Date): string;
declare function buildTitle(type: FeedbackType, subject: string, now?: Date): string;
declare function buildContextHtml(submitter: Submitter, ctx: {
    appName: string;
    pageUrl: string;
    pageTitle?: string;
    userAgent?: string;
    viewport?: string;
    topicLabel?: string;
}): string;

declare function teamworkTaskUrl(cfg: TeamworkConfig, taskId: string): string;
/**
 * Create the feedback task (title + assignee + board stage). Body goes in the
 * first comment, not here.
 *
 * The stage is set HERE rather than by a follow-up call, so the task is never
 * briefly stageless and there is no second request to fail silently.
 */
declare function createFeedbackTaskInTeamwork(cfg: TeamworkConfig, token: string, title: string): Promise<string>;
/** Post the rich body (text + inline <img>) as an HTML comment on the task. */
declare function addHtmlComment(cfg: TeamworkConfig, token: string, taskId: string, html: string): Promise<void>;
/**
 * Best-effort: assert the task sits in the configured board stage. Never throws.
 *
 * Runs after creation as a safety net — creation already sets the stage, but this
 * also repairs tasks made by an older client, and is the only path that can tell
 * you it FAILED. A 200 here is not proof: Teamwork returns 200 while ignoring a
 * stage it doesn't like, so the result is read back and verified.
 *
 * Pass `warnings` to find out why it returned false. Without a sink the reason is
 * gone — which is how tasks quietly piled up outside To Do (ASAP) for weeks.
 */
declare function moveTaskToStage(cfg: TeamworkConfig, token: string, taskId: string, warnings?: WarningSink): Promise<boolean>;
/** Best-effort: reset followers to ONLY `followerId` (shared-token case). Never throws. */
declare function setSoleFollower(cfg: TeamworkConfig, token: string, taskId: string, followerId: string, warnings?: WarningSink): Promise<boolean>;

/**
 * File a text+screenshot feedback task: create task → post body as first comment
 * → best-effort move to stage → (shared-token apps) reset followers.
 * Framework-neutral; the host calls this from its endpoint.
 *
 * Failure semantics, and the reason they are not symmetrical:
 *
 *   Before the task exists → { ok: false }. Nothing was created, so the user
 *   retrying is exactly right.
 *
 *   After the task exists → { ok: true, warnings }. It used to report ok:false
 *   here, which told the user their feedback vanished when in fact a task had
 *   been created. They resubmitted, and Teamwork ended up with two tasks — one of
 *   them a title with no body, since the failing step WAS the body. Losing the
 *   description is bad; silently doubling the backlog is worse.
 */
declare function createTextFeedback(cfg: FeedbackConfig, secrets: Secrets, input: CreateTextFeedbackInput, submitter: Submitter): Promise<CreateFeedbackResult>;

declare function vimeoWatchUrl(videoId: string): string;
/** Create a Vimeo video + a resumable (tus) upload target of the given byte size. Unlisted privacy. */
declare function createVimeoUpload(token: string, name: string, sizeBytes: number): Promise<VideoUploadTarget>;
/** Best-effort: file the video into a folder BY ID. Never throws; pass `warnings` for the reason. */
declare function moveVideoToFolder(token: string, videoId: string, folderId?: string, warnings?: WarningSink): Promise<boolean>;
/**
 * Public image URLs for still frames from the recording.
 *
 * Why this exists: the videos are unlisted and private to our Vimeo account, so
 * nothing outside it can see them — but Vimeo's thumbnail CDN serves these frame
 * URLs with **no auth at all** (verified 2026-08-11: HTTP 200, image/jpeg). So an
 * `<img>` in a Teamwork comment just works, for a human or for an LLM reading the
 * task, which is exactly what Dave asked for.
 *
 * Frames are generated with `active: false` so we never overwrite the video's own
 * poster image as a side effect. Note the API returns an EMPTY `link` for inactive
 * pictures — the usable URLs are in `sizes[]`.
 *
 * Best-effort: never throws. A missing frame is a warning, not a failed comment.
 */
declare function fetchVideoFrames(token: string, videoId: string, count: number, warnings?: WarningSink): Promise<string[]>;
/** VTT → plain text: drop header/timestamps/tags + consecutive duplicate cues. */
declare function vttToText(vtt: string): string;
/**
 * Outcome of asking Vimeo for a video's auto-transcript.
 *
 * The three cases used to collapse into `string | null`, and that single missing
 * distinction is what hid a six-day outage: an expired token answered 401 on every
 * poll, `null` said "not ready yet", and the poller patiently retried a request
 * that could never succeed until it ran out of attempts ~80 minutes later. A
 * "pending" that can never resolve must not look like a "pending" that will.
 */
type TranscriptResult = {
    status: "ready";
    text: string;
} | {
    status: "pending";
} | {
    status: "error";
    error: FeedbackError;
};
/** Fetch the auto-transcript, distinguishing "not ready yet" from "will never work". */
declare function fetchTranscriptResult(token: string, videoId: string): Promise<TranscriptResult>;
/**
 * @deprecated Collapses "not ready" and "permanently broken" into the same `null`.
 * Use {@link fetchTranscriptResult}. Kept so existing hosts keep compiling.
 */
declare function fetchTranscript(token: string, videoId: string): Promise<string | null>;

/**
 * Summarize a transcript to HTML via the Anthropic Messages API.
 *
 * Throws {@link FeedbackError}. A 401 (bad key) or 400 (bad model name) is marked
 * non-retryable so a poller gives up at once; 429 and 5xx stay retryable, which is
 * the whole point of separating them.
 */
declare function summarizeTranscript(anthropicKey: string, model: string, maxTokens: number, transcript: string): Promise<string>;

/** Step 1 of the video path: mint a Vimeo resumable-upload target. */
declare function createVideoTarget(_cfg: FeedbackConfig, secrets: Secrets, sizeBytes: number, subject: string): Promise<VideoUploadTarget>;
/**
 * Step 2: after the browser tus-uploads, create the task immediately (link +
 * "summary pending") and return a pending descriptor for the host to persist.
 *
 * Same asymmetry as the text path: once the task exists the result stays ok:true,
 * because the video is already in Vimeo and a resubmit would upload it twice.
 */
declare function submitVideoFeedback(cfg: FeedbackConfig, secrets: Secrets, input: SubmitVideoInput, submitter: Submitter): Promise<SubmitVideoResult>;
/**
 * Drain one pending video: fetch transcript → summarize → post the 2nd comment.
 * Called by the poller/fallback.
 *
 * Returns `retry` ONLY when waiting could actually help. A dead Vimeo token, a
 * deleted video or a malformed request come back as `failed` with
 * `permanent: true` on the first attempt, so the poller stops immediately instead
 * of re-sending a doomed request until its budget runs out.
 */
declare function summarizePendingVideo(cfg: FeedbackConfig, secrets: Secrets, pending: PendingVideo): Promise<SummaryOutcome>;

declare const CORE_VERSION = "0.3.0";

export { CORE_VERSION, type CreateFeedbackResult, type CreateTextFeedbackInput, FEEDBACK_TYPES, type FeedbackConfig, FeedbackError, type FeedbackStep, type FeedbackType, type FeedbackTypeOption, type FeedbackWarning, type PendingVideo, type Secrets, type SubmitVideoInput, type SubmitVideoResult, type Submitter, type SummaryOutcome, TRANSCRIPT_MAX_CHARS, type TeamworkConfig, type TranscriptHtmlOptions, type TranscriptResult, type VideoUploadTarget, type VimeoConfig, type WarningSink, addHtmlComment, buildContextHtml, buildTitle, createFeedbackTaskInTeamwork, createTextFeedback, createVideoTarget, createVimeoUpload, easternDatePrefix, escapeHtml, fetchTranscript, fetchTranscriptResult, fetchVideoFrames, isFeedbackError, isPermanentHttpStatus, messageOf, moveTaskToStage, moveVideoToFolder, pushWarning, readBodyText, safeBodyText, setSoleFollower, snip, submitVideoFeedback, summarizePendingVideo, summarizeTranscript, teamworkTaskUrl, titlePrefixFor, transcriptToHtml, vimeoWatchUrl, vttToText };
