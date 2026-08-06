import { describe, it, expect, vi, afterEach } from "vitest";
import { createTextFeedback } from "../src/core/index";
import type { FeedbackConfig } from "../src/core/index";

const cfg: FeedbackConfig = { appName: "Maven Home", teamwork: { baseUrl: "https://mavenmm.teamwork.com", tasklistId: "2976106", assigneeId: "100", workflowId: "66400", stageId: "388923" } };
afterEach(() => vi.restoreAllMocks());

function sequenceFetch(calls: { ok: boolean; body?: string }[]) {
  const seen: string[] = [];
  const fn = vi.fn(async (url: string) => {
    seen.push(url);
    const r = calls.shift()!;
    return { ok: r.ok, status: r.ok ? 200 : 500, text: async () => r.body ?? "" } as any;
  });
  return { fn, seen };
}

describe("createTextFeedback", () => {
  it("rejects an empty subject without hitting the network", async () => {
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    const res = await createTextFeedback(cfg, { teamworkToken: "T" }, { type: "bug", subject: "  ", pageUrl: "https://h" }, {});
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining("subject") });
    expect(f).not.toHaveBeenCalled();
  });
  it("creates task + comment + stage; skips follower when soleFollowerId unset", async () => {
    const { fn, seen } = sequenceFetch([{ ok: true, body: JSON.stringify({ id: 777 }) }, { ok: true }, { ok: true }]);
    vi.stubGlobal("fetch", fn);
    const res = await createTextFeedback(cfg, { teamworkToken: "T" }, { type: "bug", subject: "Broken link", bodyHtml: "<p>x</p>", pageUrl: "https://h/x" }, { name: "Rondie" });
    expect(res).toEqual({ ok: true, taskId: "777", url: "https://mavenmm.teamwork.com/app/tasks/777" });
    expect(seen).toHaveLength(3);
    expect(seen[1]).toContain("/tasks/777/comments.json");
  });
  it("runs follower cleanup when soleFollowerId set (copydeck case)", async () => {
    const { fn, seen } = sequenceFetch([{ ok: true, body: JSON.stringify({ id: 1 }) }, { ok: true }, { ok: true }, { ok: true }]);
    vi.stubGlobal("fetch", fn);
    const cfg2: FeedbackConfig = { ...cfg, teamwork: { ...cfg.teamwork, soleFollowerId: "100" } };
    const res = await createTextFeedback(cfg2, { teamworkToken: "T" }, { type: "other", subject: "x", pageUrl: "https://h" }, {});
    expect(res.ok).toBe(true);
    expect(seen).toHaveLength(4);
    expect(seen[3]).toContain("/projects/api/v3/tasks/1.json");
  });
  it("returns ok:false when creation throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "boom" }) as any));
    const res = await createTextFeedback(cfg, { teamworkToken: "T" }, { type: "bug", subject: "x", pageUrl: "https://h" }, {});
    expect(res.ok).toBe(false);
  });
});
