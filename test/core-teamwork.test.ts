import { describe, it, expect, vi, afterEach } from "vitest";
import { createFeedbackTaskInTeamwork, addHtmlComment, moveTaskToStage, teamworkTaskUrl } from "../src/core/index";
import type { TeamworkConfig, FeedbackWarning } from "../src/core/index";

const cfg: TeamworkConfig = { baseUrl: "https://mavenmm.teamwork.com", tasklistId: "2976106", assigneeId: "100", workflowId: "66400", stageId: "388923" };
afterEach(() => vi.restoreAllMocks());

function mockFetch(impl: (url: string, init: any) => { ok: boolean; status?: number; body?: string }) {
  return vi.fn(async (url: string, init: any) => {
    const r = impl(url, init);
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), text: async () => r.body ?? "" } as any;
  });
}

describe("core teamwork client", () => {
  it("teamworkTaskUrl", () => { expect(teamworkTaskUrl(cfg, "9")).toBe("https://mavenmm.teamwork.com/app/tasks/9"); });
  it("creates a task with assignee + bearer, returns id", async () => {
    vi.stubGlobal("fetch", mockFetch((url, init) => {
      expect(url).toBe("https://mavenmm.teamwork.com/tasklists/2976106/tasks.json");
      expect(init.headers.Authorization).toBe("Bearer T");
      expect(JSON.parse(init.body)["todo-item"]["responsible-party-id"]).toBe("100");
      return { ok: true, body: JSON.stringify({ id: 555 }) };
    }));
    expect(await createFeedbackTaskInTeamwork(cfg, "T", "My title")).toBe("555");
  });
  it("throws on non-OK create", async () => {
    vi.stubGlobal("fetch", mockFetch(() => ({ ok: false, status: 403, body: "no" })));
    await expect(createFeedbackTaskInTeamwork(cfg, "T", "x")).rejects.toThrow(/403/);
  });
  it("posts an HTML comment", async () => {
    vi.stubGlobal("fetch", mockFetch((url, init) => {
      expect(url).toBe("https://mavenmm.teamwork.com/tasks/555/comments.json");
      expect(JSON.parse(init.body).comment["content-type"]).toBe("HTML");
      return { ok: true };
    }));
    await expect(addHtmlComment(cfg, "T", "555", "<p>hi</p>")).resolves.toBeUndefined();
  });
  it("moveTaskToStage returns true/false, never throws", async () => {
    vi.stubGlobal("fetch", mockFetch(() => ({ ok: true })));
    expect(await moveTaskToStage(cfg, "T", "5")).toBe(true);
    vi.stubGlobal("fetch", mockFetch(() => ({ ok: false, status: 500 })));
    expect(await moveTaskToStage(cfg, "T", "5")).toBe(false);
  });
});

// Teamwork 41039784: feedback tasks were not landing in To Do (ASAP).
// Verified against the live API 2026-08-07 — see the comment on stageFields().
describe("board stage placement", () => {
  function stageMock(readback: unknown, putOk = true) {
    const seen: { url: string; method?: string; body?: any }[] = [];
    return {
      seen,
      fn: vi.fn(async (url: string, init: any = {}) => {
        seen.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
        if (init.method === "PUT") return { ok: putOk, status: putOk ? 200 : 500, text: async () => "" } as any;
        return { ok: true, status: 200, text: async () => JSON.stringify(readback), json: async () => readback } as any;
      }),
    };
  }

  it("sends workflowId AND stageId on create — stageId alone is silently ignored by Teamwork", async () => {
    let body: any;
    vi.stubGlobal("fetch", mockFetch((_url, init) => {
      body = JSON.parse(init.body)["todo-item"];
      return { ok: true, body: JSON.stringify({ id: 1 }) };
    }));
    await createFeedbackTaskInTeamwork(cfg, "T", "title");
    expect(body.workflowId).toBe(66400);
    expect(body.stageId).toBe(388923);
  });

  it("omits both ids when no stage is configured, rather than sending stageId 0", async () => {
    let body: any;
    vi.stubGlobal("fetch", mockFetch((_url, init) => {
      body = JSON.parse(init.body)["todo-item"];
      return { ok: true, body: JSON.stringify({ id: 1 }) };
    }));
    await createFeedbackTaskInTeamwork({ ...cfg, stageId: "", workflowId: "" }, "T", "title");
    expect(body).not.toHaveProperty("stageId");
    expect(body).not.toHaveProperty("workflowId");
  });

  it("uses the v1 task endpoint, NOT the v3 workflows endpoint that answers 403", async () => {
    const { fn, seen } = stageMock({ task: { workflowStages: [{ stageId: 388923 }] } });
    vi.stubGlobal("fetch", fn);
    expect(await moveTaskToStage(cfg, "T", "5")).toBe(true);
    expect(seen[0].url).toBe("https://mavenmm.teamwork.com/tasks/5.json");
    expect(seen[0].method).toBe("PUT");
    expect(seen[0].body["todo-item"]).toEqual({ workflowId: 66400, stageId: 388923 });
    expect(seen.some((s) => s.url.includes("/workflows/66400/stages/"))).toBe(false);
  });

  it("warns when Teamwork answers 200 but the task is still in no stage", async () => {
    // The exact failure mode that hid this for weeks: a success code and nothing moved.
    const { fn } = stageMock({ task: { workflowStages: [{ stageId: 0 }] } });
    vi.stubGlobal("fetch", fn);
    const warnings: FeedbackWarning[] = [];
    expect(await moveTaskToStage(cfg, "T", "5", warnings)).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/reported success but is in stage 0/);
  });

  it("does not cry wolf when the read-back itself is unusable", async () => {
    const { fn } = stageMock({ unexpected: true });
    vi.stubGlobal("fetch", fn);
    const warnings: FeedbackWarning[] = [];
    expect(await moveTaskToStage(cfg, "T", "5", warnings)).toBe(true);
    expect(warnings).toHaveLength(0);
  });
});
