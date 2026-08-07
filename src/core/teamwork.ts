import type { TeamworkConfig } from "./types";
import { FeedbackError, messageOf, pushWarning, readBodyText, safeBodyText, snip, type WarningSink } from "./errors";

function authHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${token}`, ...extra };
}

export function teamworkTaskUrl(cfg: TeamworkConfig, taskId: string): string {
  return `${cfg.baseUrl}/app/tasks/${taskId}`;
}

/**
 * Board placement, and why it looks like this.
 *
 * Teamwork only honours a stage when `workflowId` and `stageId` arrive TOGETHER on
 * the v1 task endpoint. Send `stageId` alone and the API answers 200 and silently
 * ignores it. That is the entire bug behind "feedback tasks aren't landing in
 * To Do (ASAP)" (Teamwork 41039784) — verified 2026-08-07 against all six app
 * projects, every one of which left the task at stageId 0.
 *
 * The old approach, `POST /projects/api/v3/workflows/{wf}/stages/{stage}/tasks.json`,
 * answers **403 forbidden** — even for a full-access user token. It never worked.
 */
function stageFields(cfg: TeamworkConfig): Record<string, number> {
  const workflowId = Number(cfg.workflowId);
  const stageId = Number(cfg.stageId);
  if (!Number.isFinite(workflowId) || !Number.isFinite(stageId) || workflowId <= 0 || stageId <= 0) return {};
  return { workflowId, stageId };
}

/**
 * Create the feedback task (title + assignee + board stage). Body goes in the
 * first comment, not here.
 *
 * The stage is set HERE rather than by a follow-up call, so the task is never
 * briefly stageless and there is no second request to fail silently.
 */
export async function createFeedbackTaskInTeamwork(cfg: TeamworkConfig, token: string, title: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/tasklists/${cfg.tasklistId}/tasks.json`, {
      method: "POST",
      headers: authHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        "todo-item": { content: title, "responsible-party-id": cfg.assigneeId, notify: false, ...stageFields(cfg) },
      }),
    });
  } catch (err) {
    // Network/DNS/abort — no status, so retryable defaults to true.
    throw new FeedbackError({ step: "teamwork.createTask", message: `Teamwork task create could not reach the API: ${messageOf(err)}`, cause: err });
  }

  // FULL body — it gets parsed below. Truncate only when quoting it in a message.
  const text = await readBodyText(res);
  if (!res.ok) {
    throw new FeedbackError({
      step: "teamwork.createTask",
      message: `Teamwork task create failed: HTTP ${res.status} — ${snip(text)}`,
      httpStatus: res.status,
      responseBody: snip(text),
    });
  }

  let taskId = "";
  try {
    const j = JSON.parse(text) as { id?: string | number; taskId?: string | number };
    taskId = String(j.id ?? j.taskId ?? "");
  } catch (err) {
    throw new FeedbackError({
      step: "teamwork.createTask",
      message: `Teamwork task create returned unparseable JSON — ${snip(text)}`,
      httpStatus: res.status,
      responseBody: snip(text),
      cause: err,
      // A 200 with a broken body is a contract break, not a blip. Retrying would
      // create a SECOND task, so this must never be retried.
      retryable: false,
    });
  }
  if (!taskId) {
    throw new FeedbackError({
      step: "teamwork.createTask",
      message: `Teamwork task create returned no id — ${snip(text)}`,
      httpStatus: res.status,
      responseBody: snip(text),
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

/** Read a task's current stage id, or null if it can't be determined. */
async function readStageId(cfg: TeamworkConfig, token: string, taskId: string): Promise<number | null> {
  try {
    const res = await fetch(`${cfg.baseUrl}/projects/api/v3/tasks/${taskId}.json`, { headers: authHeaders(token) });
    if (!res.ok) return null;
    const j = (await res.json()) as { task?: { workflowStages?: Array<{ stageId?: number }> } };
    // No `task` at all means the response wasn't what we expected — unverifiable,
    // NOT "stage 0". Reporting the wrong stage on a shape we don't understand would
    // cry wolf on every submission.
    if (!j || typeof j.task !== "object" || j.task === null) return null;
    const stages = j.task.workflowStages ?? [];
    return stages.length ? Number(stages[0]?.stageId ?? 0) : 0;
  } catch {
    return null;
  }
}

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
export async function moveTaskToStage(cfg: TeamworkConfig, token: string, taskId: string, warnings?: WarningSink): Promise<boolean> {
  const fields = stageFields(cfg);
  if (!("stageId" in fields)) return false; // no stage configured — nothing to assert
  try {
    const res = await fetch(`${cfg.baseUrl}/tasks/${taskId}.json`, {
      method: "PUT",
      headers: authHeaders(token, { "Content-Type": "application/json" }),
      // BOTH ids or Teamwork ignores the stage. See stageFields() above.
      body: JSON.stringify({ "todo-item": fields }),
    });
    if (!res.ok) {
      pushWarning(warnings, {
        step: "teamwork.moveStage",
        message: `Task ${taskId} was filed but not moved to stage ${cfg.stageId}: HTTP ${res.status} — ${await safeBodyText(res, 200)}`,
        httpStatus: res.status,
      });
      return false;
    }

    // Silence is not success — confirm it actually took.
    const actual = await readStageId(cfg, token, taskId);
    if (actual === null) return true; // couldn't verify; don't cry wolf over a read blip
    if (actual !== fields.stageId) {
      pushWarning(warnings, {
        step: "teamwork.moveStage",
        message: `Task ${taskId} reported success but is in stage ${actual}, not the configured ${cfg.stageId}. Check that project's workflow includes stage ${cfg.stageId}.`,
      });
      return false;
    }
    return true;
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
