import type { CreateFeedbackResult, CreateTextFeedbackInput, FeedbackConfig, Secrets, Submitter } from "./types";
import { buildContextHtml, buildTitle } from "./compose";
import { addHtmlComment, createFeedbackTaskInTeamwork, moveTaskToStage, setSoleFollower, teamworkTaskUrl } from "./teamwork";
import { isFeedbackError, messageOf, type WarningSink } from "./errors";

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
export async function createTextFeedback(
  cfg: FeedbackConfig,
  secrets: Secrets,
  input: CreateTextFeedbackInput,
  submitter: Submitter,
): Promise<CreateFeedbackResult> {
  const subject = (input.subject ?? "").trim();
  if (!subject) return { ok: false, error: "Please add a one-line subject.", retryable: false };

  const tw = cfg.teamwork;
  const token = secrets.teamworkToken;
  const title = buildTitle(input.type, subject);
  const body = (input.bodyHtml ?? "").trim() || "<p><em>(No description provided.)</em></p>";
  const commentHtml = body + buildContextHtml(submitter, {
    appName: cfg.appName, pageUrl: input.pageUrl, pageTitle: input.pageTitle, userAgent: input.userAgent, viewport: input.viewport, topicLabel: input.topicLabel,
  });

  const warnings: WarningSink = [];

  let taskId: string;
  try {
    taskId = await createFeedbackTaskInTeamwork(tw, token, title);
  } catch (err) {
    return failure(err);
  }

  // Past this line the task exists. Nothing below may turn the result into ok:false.
  try {
    await addHtmlComment(tw, token, taskId, commentHtml);
  } catch (err) {
    warnings.push({
      step: "teamwork.addComment",
      message: `Task ${taskId} was created but its description could not be posted: ${messageOf(err)}`,
    });
  }
  await moveTaskToStage(tw, token, taskId, warnings);
  if (tw.soleFollowerId) await setSoleFollower(tw, token, taskId, tw.soleFollowerId, warnings);

  return {
    ok: true,
    taskId,
    url: teamworkTaskUrl(tw, taskId),
    ...(warnings.length ? { warnings: warnings.map((w) => w.message) } : {}),
  };
}

function failure(err: unknown): CreateFeedbackResult {
  if (isFeedbackError(err)) {
    return { ok: false, error: err.message, step: err.step, retryable: err.retryable };
  }
  return { ok: false, error: messageOf(err) || "Something went wrong filing your feedback." };
}
