import type { CreateFeedbackResult, CreateTextFeedbackInput, FeedbackConfig, Secrets, Submitter } from "./types";
import { buildContextHtml, buildTitle } from "./compose";
import { addHtmlComment, createFeedbackTaskInTeamwork, moveTaskToStage, setSoleFollower, teamworkTaskUrl } from "./teamwork";

/**
 * File a text+screenshot feedback task: create task → post body as first comment
 * → best-effort move to stage → (copydeck-only) reset followers. Mirrors the
 * copydeck flow exactly. Framework-neutral; the host calls this from its endpoint.
 */
export async function createTextFeedback(
  cfg: FeedbackConfig,
  secrets: Secrets,
  input: CreateTextFeedbackInput,
  submitter: Submitter,
): Promise<CreateFeedbackResult> {
  const subject = (input.subject ?? "").trim();
  if (!subject) return { ok: false, error: "Please add a one-line subject." };

  const tw = cfg.teamwork;
  const token = secrets.teamworkToken;
  const title = buildTitle(input.type, subject);
  const body = (input.bodyHtml ?? "").trim() || "<p><em>(No description provided.)</em></p>";
  const commentHtml = body + buildContextHtml(submitter, {
    appName: cfg.appName, pageUrl: input.pageUrl, pageTitle: input.pageTitle, userAgent: input.userAgent, viewport: input.viewport, topicLabel: input.topicLabel,
  });

  try {
    const taskId = await createFeedbackTaskInTeamwork(tw, token, title);
    await addHtmlComment(tw, token, taskId, commentHtml);
    await moveTaskToStage(tw, token, taskId);
    if (tw.soleFollowerId) await setSoleFollower(tw, token, taskId, tw.soleFollowerId);
    return { ok: true, taskId, url: teamworkTaskUrl(tw, taskId) };
  } catch (err) {
    return { ok: false, error: (err as Error).message || "Something went wrong filing your feedback." };
  }
}
