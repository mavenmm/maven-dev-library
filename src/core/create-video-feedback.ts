import type { FeedbackConfig, Secrets, Submitter, SubmitVideoInput, SubmitVideoResult, VideoUploadTarget, PendingVideo, SummaryOutcome, CreateFeedbackResult } from "./types";
import { buildContextHtml, buildTitle, escapeHtml } from "./compose";
import { addHtmlComment, createFeedbackTaskInTeamwork, moveTaskToStage, setSoleFollower, teamworkTaskUrl } from "./teamwork";
import { createVimeoUpload, moveVideoToFolder, vimeoWatchUrl, fetchTranscriptResult } from "./vimeo";
import { summarizeTranscript } from "./summary";
import { FeedbackError, isFeedbackError, messageOf, type WarningSink } from "./errors";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 700;

/** Step 1 of the video path: mint a Vimeo resumable-upload target. */
export async function createVideoTarget(_cfg: FeedbackConfig, secrets: Secrets, sizeBytes: number, subject: string): Promise<VideoUploadTarget> {
  if (!secrets.vimeoToken) {
    throw new FeedbackError({ step: "vimeo.createUpload", message: "Vimeo is not configured for this app.", retryable: false });
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new FeedbackError({ step: "vimeo.createUpload", message: "Recording looks empty — try again.", retryable: false });
  }
  const name = `Feedback: ${(subject || "").trim() || "screen recording"}`;
  return createVimeoUpload(secrets.vimeoToken, name, Math.round(sizeBytes));
}

/**
 * Step 2: after the browser tus-uploads, create the task immediately (link +
 * "summary pending") and return a pending descriptor for the host to persist.
 *
 * Same asymmetry as the text path: once the task exists the result stays ok:true,
 * because the video is already in Vimeo and a resubmit would upload it twice.
 */
export async function submitVideoFeedback(cfg: FeedbackConfig, secrets: Secrets, input: SubmitVideoInput, submitter: Submitter): Promise<SubmitVideoResult> {
  const subject = (input.subject ?? "").trim();
  if (!subject) return { result: { ok: false, error: "Please add a one-line subject.", retryable: false } };
  if (!input.videoId) return { result: { ok: false, error: "Missing video reference.", retryable: false } };

  const tw = cfg.teamwork;
  const token = secrets.teamworkToken;
  const watch = vimeoWatchUrl(input.videoId);
  const commentHtml =
    `<p>🎥 <strong>Screen recording:</strong> <a href="${escapeHtml(watch)}">${escapeHtml(watch)}</a></p>` +
    `<p>🤖 <em>AI summary pending — added automatically once the transcript is ready.</em></p>` +
    buildContextHtml(submitter, { appName: cfg.appName, pageUrl: input.pageUrl, pageTitle: input.pageTitle, userAgent: input.userAgent, viewport: input.viewport, topicLabel: input.topicLabel });

  const warnings: WarningSink = [];

  let taskId: string;
  try {
    taskId = await createFeedbackTaskInTeamwork(tw, token, buildTitle(input.type, subject));
  } catch (err) {
    return { result: failure(err, "Something went wrong filing your video feedback.") };
  }

  // Past this line the task exists AND the video is uploaded. Never ok:false.
  try {
    await addHtmlComment(tw, token, taskId, commentHtml);
  } catch (err) {
    warnings.push({
      step: "teamwork.addComment",
      // Worth shouting about: this comment carries the only link to the recording,
      // so without it the video is uploaded but unreachable from the task.
      message: `Task ${taskId} was created but the comment holding the video link (${watch}) could not be posted: ${messageOf(err)}`,
    });
  }
  await moveTaskToStage(tw, token, taskId, warnings);
  if (tw.soleFollowerId) await setSoleFollower(tw, token, taskId, tw.soleFollowerId, warnings);
  if (secrets.vimeoToken && cfg.vimeo?.folderId) await moveVideoToFolder(secrets.vimeoToken, input.videoId, cfg.vimeo.folderId, warnings);

  const pending: PendingVideo = { taskId, videoId: input.videoId, videoUri: input.videoUri };
  return {
    result: {
      ok: true,
      taskId,
      url: teamworkTaskUrl(tw, taskId),
      ...(warnings.length ? { warnings: warnings.map((w) => w.message) } : {}),
    },
    pending,
  };
}

/**
 * Drain one pending video: fetch transcript → summarize → post the 2nd comment.
 * Called by the poller/fallback.
 *
 * Returns `retry` ONLY when waiting could actually help. A dead Vimeo token, a
 * deleted video or a malformed request come back as `failed` with
 * `permanent: true` on the first attempt, so the poller stops immediately instead
 * of re-sending a doomed request until its budget runs out.
 */
export async function summarizePendingVideo(cfg: FeedbackConfig, secrets: Secrets, pending: PendingVideo): Promise<SummaryOutcome> {
  if (!secrets.vimeoToken || !secrets.anthropicKey) {
    return { status: "failed", error: "Vimeo/Anthropic not configured.", permanent: true };
  }

  const transcript = await fetchTranscriptResult(secrets.vimeoToken, pending.videoId);
  if (transcript.status === "error") {
    const e = transcript.error;
    // A blip (5xx, 429, network) keeps the old forgiving behaviour — burn an
    // attempt and come back. Only a permanently doomed request stops the poller,
    // which is the single distinction the previous `string | null` could not make.
    if (e.retryable) return { status: "retry" };
    return { status: "failed", error: e.message, permanent: true, step: e.step };
  }
  if (transcript.status === "pending") return { status: "retry" };

  let summary: string;
  try {
    summary = await summarizeTranscript(secrets.anthropicKey, cfg.summary?.model ?? DEFAULT_MODEL, cfg.summary?.maxTokens ?? DEFAULT_MAX_TOKENS, transcript.text);
  } catch (err) {
    return summaryFailure(err);
  }

  const warnings: WarningSink = [];
  try {
    await addHtmlComment(cfg.teamwork, secrets.teamworkToken, pending.taskId, `<p>🤖 <strong>AI summary</strong></p>${summary}`);
  } catch (err) {
    return summaryFailure(err);
  }
  if (cfg.teamwork.soleFollowerId) {
    await setSoleFollower(cfg.teamwork, secrets.teamworkToken, pending.taskId, cfg.teamwork.soleFollowerId, warnings);
  }

  return warnings.length ? { status: "summarized", warnings: warnings.map((w) => w.message) } : { status: "summarized" };
}

function summaryFailure(err: unknown): SummaryOutcome {
  if (isFeedbackError(err)) {
    return { status: "failed", error: err.message, permanent: !err.retryable, step: err.step };
  }
  return { status: "failed", error: messageOf(err) };
}

function failure(err: unknown, fallback: string): CreateFeedbackResult {
  if (isFeedbackError(err)) {
    return { ok: false, error: err.message, step: err.step, retryable: err.retryable };
  }
  return { ok: false, error: messageOf(err) || fallback };
}
