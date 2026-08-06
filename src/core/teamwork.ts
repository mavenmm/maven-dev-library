import type { TeamworkConfig } from "./types";
import { FeedbackError, messageOf, pushWarning, safeBodyText, type WarningSink } from "./errors";

function authHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${token}`, ...extra };
}

export function teamworkTaskUrl(cfg: TeamworkConfig, taskId: string): string {
  return `${cfg.baseUrl}/app/tasks/${taskId}`;
}

/** Create the feedback task (title + assignee). Body goes in the first comment, not here. */
export async function createFeedbackTaskInTeamwork(cfg: TeamworkConfig, token: string, title: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/tasklists/${cfg.tasklistId}/tasks.json`, {
      method: "POST",
      headers: authHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ "todo-item": { content: title, "responsible-party-id": cfg.assigneeId, notify: false } }),
    });
  } catch (err) {
    // Network/DNS/abort — no status, so retryable defaults to true.
    throw new FeedbackError({ step: "teamwork.createTask", message: `Teamwork task create could not reach the API: ${messageOf(err)}`, cause: err });
  }

  const text = await safeBodyText(res);
  if (!res.ok) {
    throw new FeedbackError({
      step: "teamwork.createTask",
      message: `Teamwork task create failed: HTTP ${res.status} — ${text}`,
      httpStatus: res.status,
      responseBody: text,
    });
  }

  let taskId = "";
  try {
    const j = JSON.parse(text) as { id?: string | number; taskId?: string | number };
    taskId = String(j.id ?? j.taskId ?? "");
  } catch (err) {
    throw new FeedbackError({
      step: "teamwork.createTask",
      message: `Teamwork task create returned unparseable JSON — ${text}`,
      httpStatus: res.status,
      responseBody: text,
      cause: err,
      // A 200 with a broken body is a contract break, not a blip. Retrying would
      // create a SECOND task, so this must never be retried.
      retryable: false,
    });
  }
  if (!taskId) {
    throw new FeedbackError({
      step: "teamwork.createTask",
      message: `Teamwork task create returned no id — ${text}`,
      httpStatus: res.status,
      responseBody: text,
      retryable: false,
    });
  }
  return taskId;
}

/** Post the rich body (text + inline <img>) as an HTML comment on the task. */
export async function addHtmlComment(cfg: TeamworkConfig, token: string, taskId: string, html: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/tasks/${taskId}/comments.json`, {
      method: "POST",
      headers: authHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ comment: { body: html, "content-type": "HTML", notify: false } }),
    });
  } catch (err) {
    throw new FeedbackError({ step: "teamwork.addComment", message: `Teamwork comment could not reach the API: ${messageOf(err)}`, cause: err });
  }
  if (!res.ok) {
    const body = await safeBodyText(res);
    throw new FeedbackError({
      step: "teamwork.addComment",
      message: `Teamwork comment failed: HTTP ${res.status} — ${body}`,
      httpStatus: res.status,
      responseBody: body,
    });
  }
}

/**
 * Best-effort: move the task into the configured board stage. Never throws.
 *
 * Pass `warnings` to find out WHY it returned false — without a sink the reason is
 * gone, which is how failed stage-moves stayed invisible (tasks quietly landing in
 * the wrong column with nothing recorded anywhere).
 */
export async function moveTaskToStage(cfg: TeamworkConfig, token: string, taskId: string, warnings?: WarningSink): Promise<boolean> {
  try {
    const res = await fetch(`${cfg.baseUrl}/projects/api/v3/workflows/${cfg.workflowId}/stages/${cfg.stageId}/tasks.json`, {
      method: "POST",
      headers: authHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ taskIds: [Number(taskId)] }),
    });
    if (!res.ok) {
      pushWarning(warnings, {
        step: "teamwork.moveStage",
        message: `Task ${taskId} was filed but not moved to stage ${cfg.stageId}: HTTP ${res.status} — ${await safeBodyText(res, 200)}`,
        httpStatus: res.status,
      });
    }
    return res.ok;
  } catch (err) {
    pushWarning(warnings, { step: "teamwork.moveStage", message: `Task ${taskId} was filed but the stage move could not reach the API: ${messageOf(err)}` });
    return false;
  }
}

/** Best-effort: reset followers to ONLY `followerId` (shared-token case). Never throws. */
export async function setSoleFollower(cfg: TeamworkConfig, token: string, taskId: string, followerId: string, warnings?: WarningSink): Promise<boolean> {
  try {
    const res = await fetch(`${cfg.baseUrl}/projects/api/v3/tasks/${taskId}.json`, {
      method: "PATCH",
      headers: authHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ task: { changeFollowers: { userIds: [Number(followerId)] }, commentFollowers: { userIds: [Number(followerId)] } } }),
    });
    if (!res.ok) {
      pushWarning(warnings, {
        step: "teamwork.setFollower",
        // Worth surfacing: on a shared bot token, a failure here means the whole
        // team gets notified about one person's feedback.
        message: `Task ${taskId} followers were not reset to ${followerId}: HTTP ${res.status} — ${await safeBodyText(res, 200)}`,
        httpStatus: res.status,
      });
    }
    return res.ok;
  } catch (err) {
    pushWarning(warnings, { step: "teamwork.setFollower", message: `Task ${taskId} follower reset could not reach the API: ${messageOf(err)}` });
    return false;
  }
}
