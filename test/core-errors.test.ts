import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createTextFeedback,
  submitVideoFeedback,
  summarizePendingVideo,
  fetchTranscriptResult,
  moveTaskToStage,
  createVimeoUpload,
  createFeedbackTaskInTeamwork,
  snip,
  escapeHtml,
  FeedbackError,
  isFeedbackError,
  isPermanentHttpStatus,
  type FeedbackConfig,
  type FeedbackWarning,
} from "../src/core/index";

// One test per defect found in the 2026-08-06 error-handling audit. Written from
// the intended behaviour, not from the implementation.

const cfg: FeedbackConfig = {
  appName: "Maven Home",
  teamwork: { baseUrl: "https://mavenmm.teamwork.com", tasklistId: "1", assigneeId: "100", workflowId: "66400", stageId: "388923" },
  vimeo: { folderId: "999" },
};
const secrets = { teamworkToken: "T", vimeoToken: "V", anthropicKey: "A" };

afterEach(() => vi.restoreAllMocks());

function res(ok: boolean, status: number, body: unknown = {}) {
  return {
    ok,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => body,
  } as any;
}

describe("finding 1 — a dead Vimeo token must not look like a slow transcript", () => {
  it("reports a 401 from texttracks as permanent failure, not retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(false, 401, "invalid token")));
    const out = await summarizePendingVideo(cfg, secrets, { taskId: "777", videoId: "555" });
    expect(out.status).toBe("failed");
    expect(out).toMatchObject({ permanent: true, step: "vimeo.fetchTranscript" });
    // The message has to name the cause — this is the only thing a human will read.
    expect((out as { error: string }).error).toMatch(/401/);
  });

  it("reports a 404 (deleted video) as permanent failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(false, 404, "not found")));
    const out = await summarizePendingVideo(cfg, secrets, { taskId: "777", videoId: "555" });
    expect(out).toMatchObject({ status: "failed", permanent: true });
  });

  it("still retries on a transient 500 — a blip is not a dead token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(false, 500, "upstream hiccup")));
    const out = await summarizePendingVideo(cfg, secrets, { taskId: "777", videoId: "555" });
    expect(out).toEqual({ status: "retry" });
  });

  it("still retries while the transcript genuinely is not ready", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(true, 200, { data: [] })));
    expect(await summarizePendingVideo(cfg, secrets, { taskId: "777", videoId: "555" })).toEqual({ status: "retry" });
  });

  it("fetchTranscriptResult separates ready / pending / error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(true, 200, { data: [] })));
    expect(await fetchTranscriptResult("V", "1")).toEqual({ status: "pending" });

    vi.stubGlobal("fetch", vi.fn(async () => res(false, 403, "nope")));
    const err = await fetchTranscriptResult("V", "1");
    expect(err.status).toBe("error");
    expect(isFeedbackError((err as { error: FeedbackError }).error)).toBe(true);
    expect((err as { error: FeedbackError }).error.retryable).toBe(false);
  });
});

describe("finding 2 — best-effort failures must leave a trace", () => {
  it("moveTaskToStage records why it returned false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(false, 403, "no access")));
    const warnings: FeedbackWarning[] = [];
    const ok = await moveTaskToStage(cfg.teamwork, "T", "777", warnings);
    expect(ok).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ step: "teamwork.moveStage", httpStatus: 403 });
    expect(warnings[0].message).toContain("777");
  });

  it("surfaces a failed stage move as a warning on an otherwise successful submission", async () => {
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      call++;
      if (call === 1) return res(true, 200, { id: 777 }); // create task
      if (call === 2) return res(true, 200); // comment
      return res(false, 403, "no access"); // stage move
    }));
    const out = await createTextFeedback(cfg, { teamworkToken: "T" }, { type: "bug", subject: "x", pageUrl: "https://h" }, {});
    expect(out.ok).toBe(true);
    expect((out as { warnings?: string[] }).warnings?.[0]).toMatch(/stage/i);
  });
});

describe("finding 3 — a created task must never be reported as a total failure", () => {
  it("text: comment failure returns ok:true with the task url, so nobody resubmits", async () => {
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      call++;
      if (call === 1) return res(true, 200, { id: 777 }); // create task succeeded
      return res(false, 500, "comment blew up");
    }));
    const out = await createTextFeedback(cfg, { teamworkToken: "T" }, { type: "bug", subject: "x", pageUrl: "https://h" }, {});
    expect(out).toMatchObject({ ok: true, taskId: "777", url: "https://mavenmm.teamwork.com/app/tasks/777" });
    expect((out as { warnings?: string[] }).warnings?.join(" ")).toMatch(/description could not be posted/i);
  });

  it("video: comment failure keeps ok:true and names the orphaned recording", async () => {
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      call++;
      if (call === 1) return res(true, 200, { id: 777 });
      return res(false, 500, "comment blew up");
    }));
    const out = await submitVideoFeedback(cfg, secrets, { type: "bug", subject: "x", videoId: "555", videoUri: "/videos/555", pageUrl: "https://h" }, {});
    expect(out.result.ok).toBe(true);
    expect(out.pending).toEqual({ taskId: "777", videoId: "555", videoUri: "/videos/555" });
    expect((out.result as { warnings?: string[] }).warnings?.join(" ")).toContain("https://vimeo.com/555");
  });

  it("a failure BEFORE the task exists is still a hard failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(false, 401, "bad token")));
    const out = await createTextFeedback(cfg, { teamworkToken: "T" }, { type: "bug", subject: "x", pageUrl: "https://h" }, {});
    expect(out).toMatchObject({ ok: false, step: "teamwork.createTask", retryable: false });
  });
});

describe("finding 4 — errors carry structure, not just a message", () => {
  it("FeedbackError derives retryable from the HTTP status", () => {
    expect(new FeedbackError({ step: "teamwork.createTask", message: "x", httpStatus: 401 }).retryable).toBe(false);
    expect(new FeedbackError({ step: "teamwork.createTask", message: "x", httpStatus: 503 }).retryable).toBe(true);
    // No status at all (network/DNS) is assumed transient.
    expect(new FeedbackError({ step: "teamwork.createTask", message: "x" }).retryable).toBe(true);
  });

  it("a 200 with an unparseable body is never retried — retrying would double-file", () => {
    expect(isPermanentHttpStatus(200)).toBe(false);
    const e = new FeedbackError({ step: "teamwork.createTask", message: "x", httpStatus: 200, retryable: false });
    expect(e.retryable).toBe(false);
  });

  it("toDetail is a flat loggable shape", () => {
    const e = new FeedbackError({ step: "anthropic.summarize", message: "boom", httpStatus: 429, responseBody: "slow down" });
    expect(JSON.parse(JSON.stringify(e.toDetail()))).toEqual({
      step: "anthropic.summarize", message: "boom", httpStatus: 429, retryable: true, responseBody: "slow down",
    });
  });
});

// v0.6.0 regression, caught in production ~35 min after deploy: safeBodyText()
// clipped the body to 300 chars and the caller JSON.parse'd the CLIPPED string, so
// every valid-but-large payload came back "unparseable". Vimeo's create-upload
// response is ~1.5KB, so all video feedback 500'd; Teamwork's create response is
// short enough to survive, which is why text feedback looked fine.
describe("regression — a large but valid response body must parse", () => {
  it("createVimeoUpload parses a response far longer than the 300-char message limit", async () => {
    const big = {
      uri: "/videos/1216449347",
      upload: { upload_link: "https://tus.vimeo.com/x" },
      // Real Vimeo replies carry embed html, pictures, privacy, user… ~1.5KB.
      padding: "x".repeat(2000),
    };
    expect(JSON.stringify(big).length).toBeGreaterThan(300);
    vi.stubGlobal("fetch", vi.fn(async () => res(true, 200, big)));
    await expect(createVimeoUpload("V", "Feedback: probe", 1234)).resolves.toEqual({
      videoId: "1216449347", videoUri: "/videos/1216449347", uploadLink: "https://tus.vimeo.com/x",
    });
  });

  it("createFeedbackTaskInTeamwork parses an oversized create response", async () => {
    const big = { id: 777, padding: "y".repeat(2000) };
    vi.stubGlobal("fetch", vi.fn(async () => res(true, 200, big)));
    await expect(createFeedbackTaskInTeamwork(cfg.teamwork, "T", "title")).resolves.toBe("777");
  });

  it("error messages still clip, so a huge body can't flood a log line", () => {
    expect(snip("z".repeat(5000)).length).toBeLessThanOrEqual(301);
    expect(snip("short")).toBe("short");
  });
});

describe("finding 5 — escapeHtml survives a non-string", () => {
  it("coerces a numeric userId instead of throwing s.replace is not a function", () => {
    expect(() => escapeHtml(12345 as unknown as string)).not.toThrow();
    expect(escapeHtml(12345 as unknown as string)).toBe("12345");
  });

  it("treats null/undefined as empty", () => {
    expect(escapeHtml(null as unknown as string)).toBe("");
    expect(escapeHtml(undefined as unknown as string)).toBe("");
  });
});
