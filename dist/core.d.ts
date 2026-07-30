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
type CreateFeedbackResult = {
    ok: true;
    taskId: string;
    url: string;
} | {
    ok: false;
    error: string;
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
} | {
    status: "retry";
} | {
    status: "failed";
    error: string;
};

declare function titlePrefixFor(type: FeedbackType): string;
declare function escapeHtml(s: string): string;
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
/** Create the feedback task (title + assignee). Body goes in the first comment, not here. */
declare function createFeedbackTaskInTeamwork(cfg: TeamworkConfig, token: string, title: string): Promise<string>;
/** Post the rich body (text + inline <img>) as an HTML comment on the task. */
declare function addHtmlComment(cfg: TeamworkConfig, token: string, taskId: string, html: string): Promise<void>;
/** Best-effort: move the task into the configured board stage. Never throws. */
declare function moveTaskToStage(cfg: TeamworkConfig, token: string, taskId: string): Promise<boolean>;
/** Best-effort: reset followers to ONLY `followerId` (copydeck shared-token case). Never throws. */
declare function setSoleFollower(cfg: TeamworkConfig, token: string, taskId: string, followerId: string): Promise<boolean>;

/**
 * File a text+screenshot feedback task: create task → post body as first comment
 * → best-effort move to stage → (copydeck-only) reset followers. Mirrors the
 * copydeck flow exactly. Framework-neutral; the host calls this from its endpoint.
 */
declare function createTextFeedback(cfg: FeedbackConfig, secrets: Secrets, input: CreateTextFeedbackInput, submitter: Submitter): Promise<CreateFeedbackResult>;

declare function vimeoWatchUrl(videoId: string): string;
/** Create a Vimeo video + a resumable (tus) upload target of the given byte size. Unlisted privacy. */
declare function createVimeoUpload(token: string, name: string, sizeBytes: number): Promise<VideoUploadTarget>;
/** Best-effort: file the video into a folder BY ID (bug B2 fix — no name-match/pagination). Never throws. */
declare function moveVideoToFolder(token: string, videoId: string, folderId?: string): Promise<boolean>;
/** VTT → plain text: drop header/timestamps/tags + consecutive duplicate cues. */
declare function vttToText(vtt: string): string;
/** Fetch the auto-transcript as plain text, or null if not ready yet. */
declare function fetchTranscript(token: string, videoId: string): Promise<string | null>;

/** Summarize a transcript to HTML via the Anthropic Messages API. Throws on API error. */
declare function summarizeTranscript(anthropicKey: string, model: string, maxTokens: number, transcript: string): Promise<string>;

/** Step 1 of the video path: mint a Vimeo resumable-upload target. */
declare function createVideoTarget(_cfg: FeedbackConfig, secrets: Secrets, sizeBytes: number, subject: string): Promise<VideoUploadTarget>;
/** Step 2: after the browser tus-uploads, create the task immediately (link + "summary pending"); return a pending descriptor for the host to persist. */
declare function submitVideoFeedback(cfg: FeedbackConfig, secrets: Secrets, input: SubmitVideoInput, submitter: Submitter): Promise<SubmitVideoResult>;
/** Drain one pending video: fetch transcript → summarize → post the 2nd comment. Called by the poller/fallback. */
declare function summarizePendingVideo(cfg: FeedbackConfig, secrets: Secrets, pending: PendingVideo): Promise<SummaryOutcome>;

declare const CORE_VERSION = "0.2.1";

export { CORE_VERSION, type CreateFeedbackResult, type CreateTextFeedbackInput, FEEDBACK_TYPES, type FeedbackConfig, type FeedbackType, type FeedbackTypeOption, type PendingVideo, type Secrets, type SubmitVideoInput, type SubmitVideoResult, type Submitter, type SummaryOutcome, type TeamworkConfig, type VideoUploadTarget, type VimeoConfig, addHtmlComment, buildContextHtml, buildTitle, createFeedbackTaskInTeamwork, createTextFeedback, createVideoTarget, createVimeoUpload, easternDatePrefix, escapeHtml, fetchTranscript, moveTaskToStage, moveVideoToFolder, setSoleFollower, submitVideoFeedback, summarizePendingVideo, summarizeTranscript, teamworkTaskUrl, titlePrefixFor, vimeoWatchUrl, vttToText };
