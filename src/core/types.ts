// @mavenmm/dev-library/core — shared types + per-app config.

import type { FeedbackStep } from "./errors";

export type FeedbackType = "bug" | "feature" | "working_well" | "other";

export interface FeedbackTypeOption { value: FeedbackType; label: string; titlePrefix: string; }
export const FEEDBACK_TYPES: FeedbackTypeOption[] = [
  { value: "bug", label: "Bug", titlePrefix: "Bug" },
  { value: "feature", label: "Feature request", titlePrefix: "Feature request" },
  { value: "working_well", label: "What's working well", titlePrefix: "What's working well" },
  { value: "other", label: "Other", titlePrefix: "Other" },
];

export interface TeamworkConfig {
  baseUrl: string;
  tasklistId: string;
  assigneeId: string;
  workflowId: string;
  stageId: string;
  /** When set, followers are reset to ONLY this id after posting (copydeck shared-token case). */
  soleFollowerId?: string;
}

/** Per-app Vimeo settings (the token is a secret, supplied separately). */
export interface VimeoConfig { folderId?: string; }

export interface FeedbackConfig {
  /** Human label shown in the task's context block, e.g. "Maven Home". */
  appName: string;
  teamwork: TeamworkConfig;
  /** Per-app Vimeo folder (video path; Phase 2b). */
  vimeo?: VimeoConfig;
  /** Per-app public base URL for hosted screenshots (e.g. an S3/R2 domain). */
  screenshotBaseUrl?: string;
  summary?: { model?: string; maxTokens?: number };
}

/** Server-side secrets — NEVER sent to the browser. */
export interface Secrets {
  teamworkToken: string;
  vimeoToken?: string;
  anthropicKey?: string;
}

export interface Submitter { name?: string; email?: string; userId?: string; }

export interface CreateTextFeedbackInput {
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
export type CreateFeedbackResult =
  | { ok: true; taskId: string; url: string; warnings?: string[] }
  | { ok: false; error: string; step?: FeedbackStep; retryable?: boolean };

// ─── Video path ──────────────────────────────────────────────────────────────
export interface VideoUploadTarget { videoId: string; videoUri: string; uploadLink: string; }

export interface SubmitVideoInput {
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
export interface PendingVideo { taskId: string; videoId: string; videoUri?: string; }

export interface SubmitVideoResult { result: CreateFeedbackResult; pending?: PendingVideo; }

export type SummaryOutcome =
  | { status: "summarized"; warnings?: string[] }
  | { status: "retry" }            // transcript not ready yet — try again later
  /**
   * `permanent: true` means retrying is pointless (dead token, deleted video, bad
   * request). A poller MUST stop and surface it rather than spending its attempt
   * budget — the alternative is what let an expired token look like a slow
   * transcript for six days.
   */
  | { status: "failed"; error: string; permanent?: boolean; step?: FeedbackStep };
