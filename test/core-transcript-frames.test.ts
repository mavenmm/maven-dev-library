import { describe, it, expect, vi, afterEach } from "vitest";
import { summarizePendingVideo, transcriptToHtml, fetchVideoFrames, TRANSCRIPT_MAX_CHARS, type FeedbackConfig, type FeedbackWarning } from "../src/core/index";

// Teamwork 41044223 — Dave: post the raw transcript into the task, plus a still
// frame or two, keeping the AI summary above it all.
//
// One test per acceptance bullet in the plan, written from the intent.

afterEach(() => vi.restoreAllMocks());

const cfg: FeedbackConfig = {
  appName: "Copydeck",
  teamwork: { baseUrl: "https://mavenmm.teamwork.com", tasklistId: "1", assigneeId: "100", workflowId: "66400", stageId: "388923" },
};
const secrets = { teamworkToken: "T", vimeoToken: "V", anthropicKey: "A" };
const pending = { taskId: "777", videoId: "555" };

/**
 * Stubs the whole summarize path. `transcriptText` is what Vimeo's VTT yields;
 * `frames` controls whether Vimeo hands back picture URLs. Returns the comment
 * bodies actually posted, which is what every assertion here reads.
 */
function stubPipeline(opts: { transcriptText?: string; frames?: boolean; frameStatus?: number; duration?: number } = {}) {
  const { transcriptText = "The table columns shift when I add a row.", frames = true, frameStatus = 201, duration = 60 } = opts;
  const comments: string[] = [];
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: any = {}) => {
    const u = String(url);
    calls.push(`${init.method ?? "GET"} ${u}`);
    const ok = (body: unknown, status = 200) => ({ ok: true, status, text: async () => JSON.stringify(body), json: async () => body }) as any;

    if (u.includes("/texttracks")) return ok({ data: [{ link: "https://vtt" }] });
    if (u === "https://vtt") return { ok: true, status: 200, text: async () => `WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n${transcriptText}` } as any;
    if (u.includes("api.anthropic.com")) return ok({ content: [{ text: "<p>Columns shift on row add.</p>" }] });
    if (u.includes("?fields=duration")) return ok({ duration });
    if (u.includes("/pictures")) {
      if (!frames) return { ok: false, status: frameStatus, text: async () => "no picture for you" } as any;
      const id = 900 + calls.length;
      return ok({ uri: `/videos/555/pictures/${id}`, sizes: [
        { width: 200, link: `https://i.vimeocdn.com/video/${id}-small` },
        { width: 1280, link: `https://i.vimeocdn.com/video/${id}-d_1280x720` },
        { width: 1920, link: `https://i.vimeocdn.com/video/${id}-d_1920x1080` },
      ] }, frameStatus);
    }
    if (u.includes("/comments.json")) { comments.push(JSON.parse(init.body).comment.body); return ok({}); }
    return ok({ task: { workflowStages: [{ stageId: 388923 }] } });
  }));
  return { comments, calls };
}

describe("the async comment carries summary, frames, then transcript", () => {
  it("keeps the AI summary above it all, in Dave's order", async () => {
    const { comments } = stubPipeline();
    const out = await summarizePendingVideo(cfg, secrets, pending);
    expect(out.status).toBe("summarized");

    const body = comments[0];
    const iSummary = body.indexOf("AI summary");
    const iFrames = body.indexOf("Frames from the recording");
    const iTranscript = body.indexOf("Full transcript");
    expect(iSummary).toBeGreaterThanOrEqual(0);
    expect(iFrames).toBeGreaterThan(iSummary);
    expect(iTranscript).toBeGreaterThan(iFrames);
    expect(body).toContain("The table columns shift when I add a row.");
  });

  it("renders frames as <img> pointing at the public Vimeo CDN", async () => {
    const { comments } = stubPipeline();
    await summarizePendingVideo(cfg, secrets, pending);
    const imgs = comments[0].match(/<img[^>]+>/g) ?? [];
    expect(imgs).toHaveLength(2);
    // 1280 preferred over 1920: big enough to read, not so big it dwarfs the summary.
    expect(imgs.every((i) => i.includes("d_1280x720"))).toBe(true);
  });

  it("asks Vimeo for frames at two DIFFERENT offsets, not the same one twice", async () => {
    const { calls } = stubPipeline({ duration: 100 });
    await summarizePendingVideo(cfg, secrets, pending);
    const posts = calls.filter((c) => c.startsWith("POST") && c.includes("/pictures"));
    expect(posts).toHaveLength(2);
  });

  it("frames failing is a WARNING — the summary and transcript still post", async () => {
    const { comments } = stubPipeline({ frames: false, frameStatus: 403 });
    const out = await summarizePendingVideo(cfg, secrets, pending);
    expect(out.status).toBe("summarized");
    expect(comments[0]).toContain("AI summary");
    expect(comments[0]).toContain("Full transcript");
    expect(comments[0]).not.toContain("<img");
    expect((out as { warnings?: string[] }).warnings?.join(" ")).toMatch(/frame/i);
  });

  it("frameCount 0 skips Vimeo pictures entirely — no wasted API calls", async () => {
    const { comments, calls } = stubPipeline();
    await summarizePendingVideo({ ...cfg, videoComment: { frameCount: 0 } }, secrets, pending);
    expect(calls.some((c) => c.includes("/pictures"))).toBe(false);
    expect(comments[0]).not.toContain("<img");
  });

  it("includeTranscript false leaves the summary untouched", async () => {
    const { comments } = stubPipeline();
    await summarizePendingVideo({ ...cfg, videoComment: { includeTranscript: false } }, secrets, pending);
    expect(comments[0]).toContain("AI summary");
    expect(comments[0]).not.toContain("Full transcript");
  });
});

describe("transcriptToHtml", () => {
  it("escapes the transcript — untrusted speech must not become markup", () => {
    const html = transcriptToHtml('I clicked <script>alert("x")</script> and it broke.');
    expect(html).not.toMatch(/<script>/);
    expect(html).toContain("&lt;script&gt;");
    // Still readable as text.
    expect(html).toContain("and it broke.");
  });

  // Two independent layers neutralise markup, and it's worth pinning both down:
  //   1. vttToText strips anything shaped like a tag (it exists to drop VTT's own
  //      <v Speaker> / <i> cue markup, and catches well-formed HTML as a side effect)
  //   2. transcriptToHtml escapes whatever survives — which is what saves us from a
  //      fragment with no closing bracket, since layer 1's regex can't match it
  it("a well-formed tag is stripped by the VTT layer before it reaches the comment", async () => {
    const { comments } = stubPipeline({ transcriptText: "the <b>bold</b> label is wrong" });
    await summarizePendingVideo(cfg, secrets, pending);
    const section = comments[0].slice(comments[0].indexOf("Full transcript"));
    expect(section).not.toMatch(/<b>/);
    expect(section).toContain("the bold label is wrong");
  });

  it("an UNCLOSED tag — which the VTT stripper cannot match — is escaped", async () => {
    const { comments } = stubPipeline({ transcriptText: "I clicked <script alert then it broke" });
    await summarizePendingVideo(cfg, secrets, pending);
    const section = comments[0].slice(comments[0].indexOf("Full transcript"));
    expect(section).toContain("&lt;script");
    expect(section).not.toMatch(/<script/);
  });

  it("reflows one long space-joined string into paragraphs, losing no words", () => {
    const sentence = "The column header moves left when I add a row. ";
    const text = sentence.repeat(40).trim();
    const html = transcriptToHtml(text);
    const paras = html.match(/<p>/g) ?? [];
    expect(paras.length).toBeGreaterThan(1);
    // Word count is preserved — reflowing is presentation only.
    const stripped = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    expect(stripped.split(" ").length).toBe(text.split(/\s+/).length);
  });

  it("truncates on a word boundary and says so, naming the recording", () => {
    const text = "word ".repeat(5000).trim(); // 25,000 chars
    const html = transcriptToHtml(text, { maxChars: 1000, videoUrl: "https://vimeo.com/555" });
    expect(html).toContain("Transcript truncated at 1,000 characters");
    expect(html).toContain("of 24,999");
    expect(html).toContain("https://vimeo.com/555");
    // No mid-word cut: nothing but whole "word" tokens survive.
    const stripped = html.replace(/<em>.*<\/em>/, "").replace(/<[^>]+>/g, " ");
    expect(stripped.split(/\s+/).filter(Boolean).every((w) => w === "word")).toBe(true);
  });

  it("does not add a truncation note when nothing was cut", () => {
    expect(transcriptToHtml("Short and complete.")).not.toMatch(/truncated/);
  });

  it("empty or whitespace transcript renders nothing at all", () => {
    expect(transcriptToHtml("")).toBe("");
    expect(transcriptToHtml("   ")).toBe("");
    expect(transcriptToHtml(null as unknown as string)).toBe("");
  });

  it("defaults to a 15,000-character cap", () => {
    expect(TRANSCRIPT_MAX_CHARS).toBe(15_000);
  });
});

describe("fetchVideoFrames is best-effort", () => {
  it("falls back to the existing auto-thumbnail when duration can't be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any = {}) => {
      const u = String(url);
      if (u.includes("?fields=duration")) return { ok: false, status: 500, text: async () => "" } as any;
      if (u.includes("/pictures") && (init.method ?? "GET") === "GET") {
        const body = { data: [{ active: true, sizes: [{ width: 1280, link: "https://i.vimeocdn.com/auto-d_1280x720" }] }] };
        return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body } as any;
      }
      return { ok: false, status: 500, text: async () => "" } as any;
    }));
    const warnings: FeedbackWarning[] = [];
    expect(await fetchVideoFrames("V", "555", 2, warnings)).toEqual(["https://i.vimeocdn.com/auto-d_1280x720"]);
    expect(warnings).toHaveLength(0); // a usable fallback is not worth warning about
  });

  it("returns [] and warns when nothing at all is available", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, text: async () => "gone" }) as any));
    const warnings: FeedbackWarning[] = [];
    expect(await fetchVideoFrames("V", "555", 2, warnings)).toEqual([]);
    expect(warnings.some((w) => w.step === "vimeo.frames")).toBe(true);
  });

  it("never throws, even when the network is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(fetchVideoFrames("V", "555", 2)).resolves.toEqual([]);
  });

  it("count 0 makes no calls whatsoever", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await fetchVideoFrames("V", "555", 0)).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});
