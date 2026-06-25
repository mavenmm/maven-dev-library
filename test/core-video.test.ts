import { describe, it, expect, vi, afterEach } from "vitest";
import { createVimeoUpload, vttToText, fetchTranscript, vimeoWatchUrl, createVideoTarget, submitVideoFeedback, summarizePendingVideo } from "../src/core/index";
import type { FeedbackConfig } from "../src/core/index";

const cfg: FeedbackConfig = {
  appName: "Maven Home",
  teamwork: { baseUrl: "https://mavenmm.teamwork.com", tasklistId: "1", assigneeId: "100", workflowId: "66400", stageId: "388923" },
  vimeo: { folderId: "999" },
};
afterEach(() => vi.restoreAllMocks());

function jsonRes(ok: boolean, body: any, status = ok ? 200 : 500) {
  return { ok, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)), json: async () => body } as any;
}

describe("vimeo client", () => {
  it("vimeoWatchUrl", () => { expect(vimeoWatchUrl("123")).toBe("https://vimeo.com/123"); });

  it("createVimeoUpload returns target from the API shape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes(true, { uri: "/videos/555", upload: { upload_link: "https://tus/x" } })));
    const t = await createVideoTarget(cfg, { teamworkToken: "T", vimeoToken: "V" }, 1234, "bug");
    expect(t).toEqual({ videoId: "555", videoUri: "/videos/555", uploadLink: "https://tus/x" });
  });

  it("createVideoTarget throws when Vimeo not configured", async () => {
    await expect(createVideoTarget(cfg, { teamworkToken: "T" }, 1, "x")).rejects.toThrow(/Vimeo/);
  });

  it("vttToText strips header/timestamps/dupes", () => {
    const vtt = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nHello\nHello\n2\n00:00:03.000 --> 00:00:04.000\nworld";
    expect(vttToText(vtt)).toBe("Hello world");
  });

  it("fetchTranscript returns null when no track ready", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes(true, { data: [] })));
    expect(await fetchTranscript("V", "555")).toBeNull();
  });
});

describe("submitVideoFeedback", () => {
  it("creates the task with a video link + pending note and returns a pending descriptor", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
      seen.push(url);
      if (url.endsWith("/tasks.json") && url.includes("/tasklists/")) return jsonRes(true, { id: 777 });
      return jsonRes(true, {});
    }));
    const out = await submitVideoFeedback(cfg, { teamworkToken: "T", vimeoToken: "V" },
      { type: "bug", subject: "broken", videoId: "555", videoUri: "/videos/555", pageUrl: "https://h" }, { name: "Rondie" });
    expect(out.result).toEqual({ ok: true, taskId: "777", url: "https://mavenmm.teamwork.com/app/tasks/777" });
    expect(out.pending).toEqual({ taskId: "777", videoId: "555", videoUri: "/videos/555" });
    // task create + comment + stage move + folder move
    expect(seen.some((u) => u.includes("/comments.json"))).toBe(true);
    expect(seen.some((u) => u.includes("/me/projects/999/videos/555"))).toBe(true);
  });
});

describe("summarizePendingVideo", () => {
  it("retries when transcript not ready", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes(true, { data: [] })));
    const out = await summarizePendingVideo(cfg, { teamworkToken: "T", vimeoToken: "V", anthropicKey: "A" }, { taskId: "777", videoId: "555" });
    expect(out).toEqual({ status: "retry" });
  });

  it("summarizes + posts the 2nd comment when ready", async () => {
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      call++;
      if (url.includes("/texttracks")) return jsonRes(true, { data: [{ link: "https://vtt" }] });
      if (url === "https://vtt") return jsonRes(true, "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nthe footer is broken");
      if (url.includes("api.anthropic.com")) return jsonRes(true, { content: [{ text: "<p>Footer bug</p>" }] });
      return jsonRes(true, {}); // teamwork comment
    }));
    const out = await summarizePendingVideo(cfg, { teamworkToken: "T", vimeoToken: "V", anthropicKey: "A" }, { taskId: "777", videoId: "555" });
    expect(out).toEqual({ status: "summarized" });
  });

  it("fails gracefully when not configured", async () => {
    const out = await summarizePendingVideo(cfg, { teamworkToken: "T" }, { taskId: "1", videoId: "2" });
    expect(out.status).toBe("failed");
  });
});
