import type { FeedbackConfig, Secrets, Submitter, SubmitVideoInput, SubmitVideoResult, VideoUploadTarget, PendingVideo, SummaryOutcome } from "./types";
import { buildContextHtml, buildTitle, escapeHtml } from "./compose";
import { addHtmlComment, createFeedbackTaskInTeamwork, moveTaskToStage, setSoleFollower, teamworkTaskUrl } from "./teamwork";
import { createVimeoUpload, moveVideoToFolder, vimeoWatchUrl, fetchTranscript } from "./vimeo";
import { summarizeTranscript } from "./summary";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 700;

/** Step 1 of the video path: mint a Vimeo resumable-upload target. */
export async function createVideoTarget(_cfg: FeedbackConfig, secrets: Secrets, sizeBytes: number, subject: string): Promise<VideoUploadTarget> {
  if (!secrets.vimeoToken) throw new Error("Vimeo is not configured for this app.");
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new Error("Recording looks empty — try again.");
  const name = `Feedback: ${(subject || "").trim() || "screen recording"}`;
  return createVimeoUpload(secrets.vimeoToken, name, Math.round(sizeBytes));
}

/** Step 2: after the browser tus-uploads, create the task immediately (link + "summary pending"); return a pending descriptor for the host to persist. */
export async function submitVideoFeedback(cfg: FeedbackConfig, secrets: Secrets, input: SubmitVideoInput, submitter: Submitter): Promise<SubmitVideoResult> {
  const subject = (input.subject ?? "").trim();
  if (!subject) return { result: { ok: false, error: "Please add a one-line subject." } };
  if (!input.videoId) return { result: { ok: false, error: "Missing video reference." } };

  const tw = cfg.teamwork;
  const token = secrets.teamworkToken;
  const watch = vimeoWatchUrl(input.videoId);
  const commentHtml =
    `<p>🎥 <strong>Screen recording:</strong> <a href="${escapeHtml(watch)}">${escapeHtml(watch)}</a></p>` +
    `<p>🤖 <em>AI summary pending — added automatically once the transcript is ready.</em></p>` +
    buildContextHtml(submitter, { appName: cfg.appName, pageUrl: input.pageUrl, pageTitle: input.pageTitle, userAgent: input.userAgent, viewport: input.viewport });

  try {
    const taskId = await createFeedbackTaskInTeamwork(tw, token, buildTitle(input.type, subject));
    await addHtmlComment(tw, token, taskId, commentHtml);
    await moveTaskToStage(tw, token, taskId);
    if (tw.soleFollowerId) await setSoleFollower(tw, token, taskId, tw.soleFollowerId);
    if (secrets.vimeoToken && cfg.vimeo?.folderId) await moveVideoToFolder(secrets.vimeoToken, input.videoId, cfg.vimeo.folderId);
    const pending: PendingVideo = { taskId, videoId: input.videoId, videoUri: input.videoUri };
    return { result: { ok: true, taskId, url: teamworkTaskUrl(tw, taskId) }, pending };
  } catch (err) {
    return { result: { ok: false, error: (err as Error).message || "Something went wrong filing your video feedback." } };
  }
}

/** Drain one pending video: fetch transcript → summarize → post the 2nd comment. Called by the poller/fallback. */
export async function summarizePendingVideo(cfg: FeedbackConfig, secrets: Secrets, pending: PendingVideo): Promise<SummaryOutcome> {
  if (!secrets.vimeoToken || !secrets.anthropicKey) return { status: "failed", error: "Vimeo/Anthropic not configured." };
  try {
    const transcript = await fetchTranscript(secrets.vimeoToken, pending.videoId);
    if (!transcript) return { status: "retry" };
    const summary = await summarizeTranscript(secrets.anthropicKey, cfg.summary?.model ?? DEFAULT_MODEL, cfg.summary?.maxTokens ?? DEFAULT_MAX_TOKENS, transcript);
    await addHtmlComment(cfg.teamwork, secrets.teamworkToken, pending.taskId, `<p>🤖 <strong>AI summary</strong></p>${summary}`);
    if (cfg.teamwork.soleFollowerId) await setSoleFollower(cfg.teamwork, secrets.teamworkToken, pending.taskId, cfg.teamwork.soleFollowerId);
    return { status: "summarized" };
  } catch (err) {
    return { status: "failed", error: (err as Error).message };
  }
}
