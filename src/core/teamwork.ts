import type { TeamworkConfig } from "./types";

function authHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${token}`, ...extra };
}

export function teamworkTaskUrl(cfg: TeamworkConfig, taskId: string): string {
  return `${cfg.baseUrl}/app/tasks/${taskId}`;
}

/** Create the feedback task (title + assignee). Body goes in the first comment, not here. */
export async function createFeedbackTaskInTeamwork(cfg: TeamworkConfig, token: string, title: string): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/tasklists/${cfg.tasklistId}/tasks.json`, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ "todo-item": { content: title, "responsible-party-id": cfg.assigneeId, notify: false } }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Teamwork task create failed: HTTP ${res.status} — ${text.slice(0, 300)}`);
  let taskId = "";
  try { const j = JSON.parse(text) as { id?: string | number; taskId?: string | number }; taskId = String(j.id ?? j.taskId ?? ""); } catch { /* handled below */ }
  if (!taskId) throw new Error(`Teamwork task create returned no id — ${text.slice(0, 300)}`);
  return taskId;
}

/** Post the rich body (text + inline <img>) as an HTML comment on the task. */
export async function addHtmlComment(cfg: TeamworkConfig, token: string, taskId: string, html: string): Promise<void> {
  const res = await fetch(`${cfg.baseUrl}/tasks/${taskId}/comments.json`, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ comment: { body: html, "content-type": "HTML", notify: false } }),
  });
  if (!res.ok) throw new Error(`Teamwork comment failed: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`);
}

/** Best-effort: move the task into the configured board stage. Never throws. */
export async function moveTaskToStage(cfg: TeamworkConfig, token: string, taskId: string): Promise<boolean> {
  try {
    const res = await fetch(`${cfg.baseUrl}/projects/api/v3/workflows/${cfg.workflowId}/stages/${cfg.stageId}/tasks.json`, {
      method: "POST",
      headers: authHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ taskIds: [Number(taskId)] }),
    });
    return res.ok;
  } catch { return false; }
}

/** Best-effort: reset followers to ONLY `followerId` (copydeck shared-token case). Never throws. */
export async function setSoleFollower(cfg: TeamworkConfig, token: string, taskId: string, followerId: string): Promise<boolean> {
  try {
    const res = await fetch(`${cfg.baseUrl}/projects/api/v3/tasks/${taskId}.json`, {
      method: "PATCH",
      headers: authHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ task: { changeFollowers: { userIds: [Number(followerId)] }, commentFollowers: { userIds: [Number(followerId)] } } }),
    });
    return res.ok;
  } catch { return false; }
}
