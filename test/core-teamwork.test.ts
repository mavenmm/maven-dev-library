import { describe, it, expect, vi, afterEach } from "vitest";
import { createFeedbackTaskInTeamwork, addHtmlComment, moveTaskToStage, teamworkTaskUrl } from "../src/core/index";
import type { TeamworkConfig } from "../src/core/index";

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
