// Typed client for maven-teamwork-worker — the single holder of Maven's Teamwork
// service credential. Apps call the worker instead of Teamwork directly, so no app
// ever stores a Teamwork token in its own env.
//
// Auth contract: every call sends the CURRENT USER's Maven SSO JWT (the
// `maven_refresh_token` cookie value) as `Authorization: Bearer`, plus an
// `x-maven-app-id` registered in the worker's policy map. The worker verifies the JWT,
// runs the action with the user's own Teamwork token first, and falls back to the bot
// token only where its per-app policy allows (typically: the user isn't a member of
// the target project). Every response reports which token ran the action.
//
// This module is framework-neutral: the caller supplies `getJwt` (e.g. a Next.js
// server action reads the cookie; a Netlify function reads the header). No secrets
// live here — the worker URL is not a secret, and all security rests on the JWT
// signature.

export type TeamworkTokenUsed = "user" | "service";

export interface TeamworkWorkerClientOptions {
  /**
   * The worker origin (e.g. from a TEAMWORK_WORKER_URL env var). Not a secret — the
   * worker rejects anything without a valid Maven SSO JWT — but deliberately not
   * hardcoded here either: this library is public, and keeping infrastructure
   * addresses in each app's own config means a URL change never needs a library
   * release.
   */
  workerUrl?: string;
  /** App id registered in the worker's src/policy.ts (e.g. "copydeck"). */
  appId: string;
  /**
   * USER-caller auth: returns the current user's Maven SSO JWT (the raw
   * `maven_refresh_token` cookie value), or null when there is no session — in which
   * case calls throw TeamworkWorkerError(401) without hitting the network.
   * Exactly one of `getJwt` / `serviceSecret` must be provided.
   */
  getJwt?: () => string | null | Promise<string | null>;
  /**
   * SERVICE-caller auth (crons/webhooks — no user session): the app's per-app secret,
   * matching the worker's APP_SECRET_<APPID>. All actions run as the worker's service
   * token, and only apps registered `headless: true` in the worker's policy are
   * accepted. A random value, never a Teamwork token.
   */
  serviceSecret?: string;
  /**
   * INTERNAL-caller auth (Cloudflare worker-to-worker): the fetch function of a service
   * binding to the teamwork-worker's `InternalTeamwork` named entrypoint, e.g.
   * `(u, i) => env.TEAMWORK.fetch(u, i)`. A named entrypoint is unreachable from public
   * HTTP, so the binding itself is the authentication — no secret, no JWT. Only apps
   * registered `internal: true` in the worker's policy are accepted; all actions run as
   * the worker's service token. When set, `workerUrl` may be omitted (the binding
   * ignores the hostname).
   */
  bindingFetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Per-request timeout. Default 10s (the worker itself allows 8s per Teamwork call). */
  timeoutMs?: number;
}

export interface WorkerTasklistInfo {
  id: string;
  name: string;
}

export interface WorkerMilestoneInfo {
  name: string;
  /** ISO completion date when the milestone is completed; null otherwise. */
  completedOn: string | null;
}

export interface WorkerCreateTaskInput {
  name: string;
  /** Teamwork renders a description URL as a real link; a task NAME never is. */
  description?: string;
  /** Teamwork user id (in Maven apps, User.id IS the Teamwork user id). */
  assigneeId?: string;
  /** "top" reorders the new task to the top of its tasklist (best-effort). */
  position?: "top";
}

export class TeamworkWorkerError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "TeamworkWorkerError";
  }
}

/** Allowlisted v3 task-list filters (unknown params are dropped by the worker, never forwarded). */
export interface WorkerListTasksParams {
  tagIds?: string;
  projectIds?: string;
  /** Filter by assignee (comma-separated Teamwork user ids). The v3 param really is
   * responsiblePartyIds — assignedToUserIds is silently ignored and returns the whole
   * account's tasks (verified live 2026-08-05). */
  responsiblePartyIds?: string;
  pageSize?: number;
  page?: number;
  include?: string;
  /** e.g. "duedate". Unknown values are silently ignored by Teamwork (HTTP 200). */
  orderBy?: string;
  orderMode?: "asc" | "desc";
  includeCompletedTasks?: boolean;
  /** Include tasks from archived/completed projects — excluded by default, and most
   * historical work lives there (live check: one job-type tag went 27 → 87 tasks). */
  includeArchivedProjects?: boolean;
}

/** Allowlisted v3 time-log filters (GET /timelogs on the worker → Teamwork time.json).
 * userIds filters by the user the time is logged against (the worker maps it to
 * Teamwork's assignedToUserIds — the plainly-named userIds param is silently ignored
 * by Teamwork). History-wide sweeps should pair taskIds batching with
 * includeArchivedProjects and a generous client timeoutMs (bulk pages can take >10s). */
export interface WorkerListTimelogsParams {
  taskIds?: string;
  projectIds?: string;
  userIds?: string;
  /** ISO dates (YYYY-MM-DD), inclusive. */
  startDate?: string;
  endDate?: string;
  pageSize?: number;
  page?: number;
  /** Sideloads, e.g. "users" (resolves who logged the time). */
  include?: string;
  /** e.g. "date". */
  orderBy?: string;
  orderMode?: "asc" | "desc";
  includeArchivedProjects?: boolean;
}

/** v3 PATCH field subset. At least one field required. */
export interface WorkerUpdateTaskInput {
  /** Rename the task. */
  name?: string;
  startAt?: string;
  dueAt?: string;
  tagIds?: number[];
  /** Replaces the assignee list (Teamwork user ids). */
  assigneeIds?: number[];
  /** "" clears the priority. */
  priority?: "" | "low" | "medium" | "high";
  estimatedMinutes?: number;
  /** Replace the task's follower lists — on a shared/bot token this is what stops the
   * whole team being notified about one person's item. */
  changeFollowerIds?: number[];
  commentFollowerIds?: number[];
  /** v3 board-stage move — workflowId and stageId must travel TOGETHER (a lone stageId
   * gets a 200 and is silently ignored by Teamwork; the worker enforces both-or-neither). */
  workflowId?: number;
  stageId?: number;
}

/** v1 PUT field subset — clearing a date goes through v1 ("" clears; v3's null
 * handling is unverified). */
export interface WorkerUpdateTaskLegacyInput {
  startDate?: string;
  dueDate?: string;
  tagIds?: string[];
  /** v1 board-stage move — workflowId and stageId must travel TOGETHER (a lone stageId
   * gets a 200 and is silently ignored by Teamwork). */
  workflowId?: number;
  stageId?: number;
}

export interface WorkerListCommentsParams {
  pageSize?: number;
  /** The only verified sort is "date" — unusually for Teamwork, unknown values 400
   * loudly here ("unknown comment sort") instead of being silently ignored. */
  orderBy?: string;
  orderMode?: "asc" | "desc";
  /** Sideloads, e.g. "users" — v3 comments carry only postedByUserId; the users
   * sideload is how authors resolve to names/avatars. */
  include?: string;
}

/** Filters for the dedicated v3 subtasks endpoint (tasks.json?parentTaskIds= is NOT a
 * v3 param — silently ignored, returns the whole account's tasks). */
export interface WorkerListSubtasksParams {
  includeCompletedTasks?: boolean;
  include?: string;
  pageSize?: number;
}

/** v1 subtask create under a parent task (no v3 equivalent). Dates are ISO YYYY-MM-DD;
 * the worker converts to v1's YYYYMMDD wire format. */
export interface WorkerCreateSubtaskInput {
  name: string;
  /** Full assignee list (Teamwork user ids). */
  assigneeIds?: number[];
  startDate?: string;
  dueDate?: string;
}

/** Allowlisted v3 proof-list filters. proofs.json has NO task/project filter — fetch
 * recent and filter by entity.id yourself. Page-size param is `limit`, not pageSize. */
export interface WorkerListProofsParams {
  orderBy?: string;
  orderMode?: "asc" | "desc";
  include?: string;
  limit?: number;
}

/** Allowlisted v3 tag-list filters (e.g. searchTerm "INT_JT_" resolves job-type tags by name). */
export interface WorkerListTagsParams {
  searchTerm?: string;
  pageSize?: number;
}

export interface TeamworkWorkerClient {
  /** Raw Teamwork v3 task-list response under `body` (shape owned by Teamwork; cast at the call site). */
  listTasks(params: WorkerListTasksParams): Promise<{ body: unknown; tokenUsed: TeamworkTokenUsed }>;
  /** Raw Teamwork v3 single-task response under `body`. `include` sideloads
   * (e.g. "projects,projects.categories,tasklists,users,tags") come back keyed by id
   * under `body.included`. */
  getTask(taskId: string, include?: string): Promise<{ body: unknown; tokenUsed: TeamworkTokenUsed }>;
  /** Raw v1 single-task read under `body` (`body["todo-item"]`) — exists because v3
   * doesn't expose follower ids (comment-follower-ids / change-follower-ids). */
  getTaskLegacy(taskId: string): Promise<{ body: unknown; tokenUsed: TeamworkTokenUsed }>;
  /** Raw v3 subtask-list response under `body` for the children of one task. */
  listSubtasks(taskId: string, params?: WorkerListSubtasksParams): Promise<{ body: unknown; tokenUsed: TeamworkTokenUsed }>;
  /** Create a subtask under a parent task (v1 — no v3 equivalent). Unlike
   * tasklist-scoped createTask, due dates on this path are prod-verified safe. */
  createSubtask(parentTaskId: string, input: WorkerCreateSubtaskInput): Promise<{ id: string; tokenUsed: TeamworkTokenUsed }>;
  updateTask(taskId: string, input: WorkerUpdateTaskInput): Promise<{ tokenUsed: TeamworkTokenUsed }>;
  updateTaskLegacy(taskId: string, input: WorkerUpdateTaskLegacyInput): Promise<{ tokenUsed: TeamworkTokenUsed }>;
  listComments(taskId: string, params?: WorkerListCommentsParams): Promise<{ body: unknown; tokenUsed: TeamworkTokenUsed }>;
  /** All tasklists in a project, INCLUDING completed ones (a completed list is still THE list for a job). */
  listTasklists(projectId: string): Promise<{ tasklists: WorkerTasklistInfo[]; tokenUsed: TeamworkTokenUsed }>;
  createTasklist(projectId: string, name: string): Promise<{ id: string; tokenUsed: TeamworkTokenUsed }>;
  /** No due-date support, deliberately: Teamwork defaults a due date to a random 2021 date (long-standing bug). */
  createTask(tasklistId: string, input: WorkerCreateTaskInput): Promise<{ id: string; tokenUsed: TeamworkTokenUsed }>;
  /** Complete-never-delete: completing is reversible (reopenTask) and keeps the Teamwork audit trail. */
  completeTask(taskId: string): Promise<{ tokenUsed: TeamworkTokenUsed }>;
  reopenTask(taskId: string): Promise<{ tokenUsed: TeamworkTokenUsed }>;
  listMilestones(projectId: string): Promise<{ milestones: WorkerMilestoneInfo[]; tokenUsed: TeamworkTokenUsed }>;
  /** Raw Teamwork v3 tag-list response under `body` (shape owned by Teamwork; cast at the call site). */
  listTags(params?: WorkerListTagsParams): Promise<{ body: unknown; tokenUsed: TeamworkTokenUsed }>;
  /** Raw Teamwork v3 time-log response under `body` — `body.timelogs[]` with `minutes`,
   * `taskId`, `userId`, `date` (shape owned by Teamwork; cast at the call site). */
  listTimelogs(params?: WorkerListTimelogsParams): Promise<{ body: unknown; tokenUsed: TeamworkTokenUsed }>;
  /** contentType "HTML" for rich bodies (inline <img> etc.); default plain text.
   * notifyUserIds: who to notify — omitted/empty notifies NOBODY, and on a service/bot
   * token the author is the bot, so pass the assignee when the comment must reach them. */
  createComment(
    taskId: string,
    body: string,
    contentType?: "text" | "HTML",
    notifyUserIds?: number[],
  ): Promise<{ id: string | null; tokenUsed: TeamworkTokenUsed }>;
  /** The calling user's Teamwork identity — raw v3 me.json under `body`
   * (`body.person` carries `userType`: "account" | "collaborator" | "contact").
   * Always runs on the user's own token; meaningless for headless/internal callers. */
  getMe(): Promise<{ body: unknown; tokenUsed: TeamworkTokenUsed }>;
  /** People on a project — raw v3 response under `body` (camelCase, no address/PII
   * fields, unlike v1). */
  listProjectPeople(projectId: string, pageSize?: number): Promise<{ body: unknown; tokenUsed: TeamworkTokenUsed }>;
  /** Stages (board columns) of a workflow — raw v3 response under `body`. Task objects
   * carry only {workflowId, stageId}; this resolves names. Backlog is stageId 0 and
   * never appears here. */
  listWorkflowStages(workflowId: string): Promise<{ body: unknown; tokenUsed: TeamworkTokenUsed }>;
  /** Recent proofs — raw v3 response under `body`. No task filter exists; filter by
   * `body.proofs[].entity.id` yourself. */
  listProofs(params?: WorkerListProofsParams): Promise<{ body: unknown; tokenUsed: TeamworkTokenUsed }>;
}

export function createTeamworkWorkerClient(opts: TeamworkWorkerClientOptions): TeamworkWorkerClient {
  const rawBase = opts.workerUrl ?? (opts.bindingFetch ? "https://internal" : undefined);
  if (!rawBase) throw new TeamworkWorkerError(0, "workerUrl is required (unless bindingFetch is provided)");
  const base = rawBase.replace(/\/$/, "");
  // https only — except localhost, so consumers can test against `wrangler dev`.
  if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) {
    throw new TeamworkWorkerError(0, "workerUrl must be an https:// origin (or http://localhost for wrangler dev)");
  }
  const timeoutMs = opts.timeoutMs ?? 10_000;

  if (!opts.getJwt && !opts.serviceSecret && !opts.bindingFetch) {
    throw new TeamworkWorkerError(0, "createTeamworkWorkerClient needs getJwt (user), serviceSecret (headless), or bindingFetch (worker-to-worker)");
  }
  const doFetch = opts.bindingFetch ?? fetch;

  async function call<T>(method: "GET" | "POST" | "PATCH" | "PUT", path: string, body?: unknown): Promise<T> {
    const auth: Record<string, string> = {};
    if (opts.bindingFetch) {
      /* the binding IS the auth — only the app id travels */
    } else if (opts.serviceSecret) {
      auth["x-maven-app-secret"] = opts.serviceSecret;
    } else {
      const jwt = await opts.getJwt!();
      if (!jwt) throw new TeamworkWorkerError(401, "No Maven session — cannot call the Teamwork worker");
      auth["Authorization"] = `Bearer ${jwt}`;
    }

    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          ...auth,
          "x-maven-app-id": opts.appId,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new TeamworkWorkerError(0, `Teamwork worker unreachable: ${err instanceof Error ? err.message : String(err)}`);
    }

    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON error body — fall through to status-based error */
    }
    if (!res.ok) {
      const msg =
        json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string"
          ? (json as { error: string }).error
          : `Teamwork worker HTTP ${res.status}`;
      throw new TeamworkWorkerError(res.status, msg);
    }
    return json as T;
  }

  const qs = (params: Record<string, unknown>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== false) q.set(k, String(v));
    }
    const s = q.toString();
    return s ? `?${s}` : "";
  };

  return {
    listTasks: (params) => call("GET", `/tasks${qs({ ...params })}`),
    getTask: (taskId, include) => call("GET", `/tasks/${taskId}${qs({ include })}`),
    getTaskLegacy: (taskId) => call("GET", `/tasks/${taskId}?legacy=true`),
    listSubtasks: (taskId, params = {}) => call("GET", `/tasks/${taskId}/subtasks${qs({ ...params })}`),
    createSubtask: (parentTaskId, input) => call("POST", `/tasks/${parentTaskId}/subtasks`, input),
    updateTask: (taskId, input) => call("PATCH", `/tasks/${taskId}`, input),
    updateTaskLegacy: (taskId, input) => call("PUT", `/tasks/${taskId}`, input),
    listComments: (taskId, params = {}) => call("GET", `/tasks/${taskId}/comments${qs({ ...params })}`),
    listTasklists: (projectId) => call("GET", `/projects/${projectId}/tasklists`),
    createTasklist: (projectId, name) => call("POST", `/projects/${projectId}/tasklists`, { name }),
    createTask: (tasklistId, input) => call("POST", `/tasklists/${tasklistId}/tasks`, input),
    completeTask: (taskId) => call("POST", `/tasks/${taskId}/complete`),
    reopenTask: (taskId) => call("POST", `/tasks/${taskId}/uncomplete`),
    listMilestones: (projectId) => call("GET", `/projects/${projectId}/milestones`),
    listTags: (params = {}) => call("GET", `/tags${qs({ ...params })}`),
    listTimelogs: (params = {}) => call("GET", `/timelogs${qs({ ...params })}`),
    createComment: (taskId, body, contentType, notifyUserIds) =>
      call("POST", `/tasks/${taskId}/comments`, {
        body,
        ...(contentType ? { contentType } : {}),
        ...(notifyUserIds && notifyUserIds.length > 0 ? { notifyUserIds } : {}),
      }),
    getMe: () => call("GET", `/me`),
    listProjectPeople: (projectId, pageSize) => call("GET", `/projects/${projectId}/people${qs({ pageSize })}`),
    listWorkflowStages: (workflowId) => call("GET", `/workflows/${workflowId}/stages`),
    listProofs: (params = {}) => call("GET", `/proofs${qs({ ...params })}`),
  };
}
