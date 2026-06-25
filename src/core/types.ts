// @mavenmm/dev-library/core — shared types + per-app config.

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
  pageUrl: string;
  pageTitle?: string;
  userAgent?: string;
  viewport?: string;
}

export type CreateFeedbackResult =
  | { ok: true; taskId: string; url: string }
  | { ok: false; error: string };
