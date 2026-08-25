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
  workerUrl: string;
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
  pageSize?: number;
  page?: number;
  include?: string;
  includeCompletedTasks?: boolean;
}

/** v3 PATCH field subset ({ Task: { startAt, dueAt, tagIds } }). At least one field required. */
export interface WorkerUpdateTaskInput {
  startAt?: string;
  dueAt?: string;
  tagIds?: number[];
}

/** v1 PUT field subset — clearing a start date goes through v1 ("" clears; v3's null
 * handling is unverified). */
export interface WorkerUpdateTaskLegacyInput {
  startDate?: string;
  tagIds?: string[];
}

export interface WorkerListCommentsParams {
  pageSize?: number;
  orderBy?: string;
  orderMode?: "asc" | "desc";
}

export interface TeamworkWorkerClient {
  /** Raw Teamwork v3 task-list response under `body` (shape owned by Teamwork; cast at the call site). */
  listTasks(params: WorkerListTasksParams): Promise<{ body: unknown; tokenUsed: TeamworkTokenUsed }>;
  /** Raw Teamwork v3 single-task response under `body`. */
  getTask(taskId: string): Promise<{ body: unknown; tokenUsed: TeamworkTokenUsed }>;
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
  createComment(taskId: string, body: string): Promise<{ tokenUsed: TeamworkTokenUsed }>;
}

export function createTeamworkWorkerClient(opts: TeamworkWorkerClientOptions): TeamworkWorkerClient {
  const base = opts.workerUrl.replace(/\/$/, "");
  if (!/^https:\/\//.test(base)) throw new TeamworkWorkerError(0, "workerUrl must be an https:// origin");
  const timeoutMs = opts.timeoutMs ?? 10_000;

  if (!opts.getJwt && !opts.serviceSecret) {
    throw new TeamworkWorkerError(0, "createTeamworkWorkerClient needs getJwt (user callers) or serviceSecret (headless callers)");
  }

  async function call<T>(method: "GET" | "POST" | "PATCH" | "PUT", path: string, body?: unknown): Promise<T> {
    const auth: Record<string, string> = {};
    if (opts.serviceSecret) {
      auth["x-maven-app-secret"] = opts.serviceSecret;
    } else {
      const jwt = await opts.getJwt!();
      if (!jwt) throw new TeamworkWorkerError(401, "No Maven session — cannot call the Teamwork worker");
      auth["Authorization"] = `Bearer ${jwt}`;
    }

    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
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
    getTask: (taskId) => call("GET", `/tasks/${taskId}`),
    updateTask: (taskId, input) => call("PATCH", `/tasks/${taskId}`, input),
    updateTaskLegacy: (taskId, input) => call("PUT", `/tasks/${taskId}`, input),
    listComments: (taskId, params = {}) => call("GET", `/tasks/${taskId}/comments${qs({ ...params })}`),
    listTasklists: (projectId) => call("GET", `/projects/${projectId}/tasklists`),
    createTasklist: (projectId, name) => call("POST", `/projects/${projectId}/tasklists`, { name }),
    createTask: (tasklistId, input) => call("POST", `/tasklists/${tasklistId}/tasks`, input),
    completeTask: (taskId) => call("POST", `/tasks/${taskId}/complete`),
    reopenTask: (taskId) => call("POST", `/tasks/${taskId}/uncomplete`),
    listMilestones: (projectId) => call("GET", `/projects/${projectId}/milestones`),
    createComment: (taskId, body) => call("POST", `/tasks/${taskId}/comments`, { body }),
  };
}
