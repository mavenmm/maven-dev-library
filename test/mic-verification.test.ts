import { describe, it, expect, vi, afterEach } from "vitest";
import { createMicLevelMeter, hasAudioInputDevice, nullMeter, SILENCE_FLOOR } from "../src/ui/feedback/mic-level";
import { submitVideoFeedback, type FeedbackConfig } from "../src/core/index";

// Acceptance bullets for the mic-verification feature, written from the plan
// rather than the implementation:
//   1. no audioinput device -> detectable BEFORE recording starts
//   2. getUserMedia denied -> reported, recording still proceeds
//   3. mic live -> meter produces a level
//   4. mic silent -> meter stays flat and sawSound() stays false
//   5. silent take -> hasAudio:false -> no transcript queued, comment says so
//   6. take with sound -> hasAudio:true -> queued exactly as before

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** A fake analyser that replays a fixed waveform, so no Web Audio is needed. */
function stubAudio(sampleAt: (i: number) => number) {
  const analyser = {
    fftSize: 512,
    getByteTimeDomainData(buf: Uint8Array) {
      for (let i = 0; i < buf.length; i++) buf[i] = sampleAt(i);
    },
  };
  const ctx = {
    createAnalyser: () => analyser,
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    close: async () => {},
  };
  vi.stubGlobal("AudioContext", function AudioContextStub(this: unknown) { return ctx; } as unknown as typeof AudioContext);
}

const streamWithAudio = () => ({ getAudioTracks: () => [{ muted: false }] }) as unknown as MediaStream;

describe("1 + 2 — device presence and permission are knowable, not swallowed", () => {
  it("detects that no audio input exists, without asking permission", async () => {
    vi.stubGlobal("navigator", { mediaDevices: { enumerateDevices: async () => [{ kind: "videoinput" }] } });
    expect(await hasAudioInputDevice()).toBe(false);
  });

  it("detects that an audio input exists", async () => {
    vi.stubGlobal("navigator", { mediaDevices: { enumerateDevices: async () => [{ kind: "audioinput" }, { kind: "videoinput" }] } });
    expect(await hasAudioInputDevice()).toBe(true);
  });

  it("returns null (assume fine) when it cannot tell — a false 'no mic' is worse than silence", async () => {
    vi.stubGlobal("navigator", {});
    expect(await hasAudioInputDevice()).toBeNull();

    vi.stubGlobal("navigator", { mediaDevices: { enumerateDevices: async () => { throw new Error("nope"); } } });
    expect(await hasAudioInputDevice()).toBeNull();
  });
});

describe("3 + 4 — the meter distinguishes sound from silence", () => {
  it("reports a level and latches sawSound for a loud signal", () => {
    // Full-scale square wave around the 128 midpoint.
    stubAudio((i) => (i % 2 ? 255 : 1));
    const m = createMicLevelMeter(streamWithAudio());
    const level = m.level();
    expect(level).toBeGreaterThan(SILENCE_FLOOR);
    expect(m.sawSound()).toBe(true);
    m.stop();
  });

  it("stays flat and never latches for a muted mic (pure midpoint = digital silence)", () => {
    stubAudio(() => 128);
    const m = createMicLevelMeter(streamWithAudio());
    for (let i = 0; i < 40; i++) m.level();
    expect(m.level()).toBe(0);
    expect(m.sawSound()).toBe(false);
    m.stop();
  });

  it("treats mic self-noise as silence — a dithering muted mic must not read as live", () => {
    // ±1 LSB of noise: ~0.008 RMS, below the floor.
    stubAudio((i) => (i % 2 ? 129 : 127));
    const m = createMicLevelMeter(streamWithAudio());
    for (let i = 0; i < 20; i++) m.level();
    expect(m.sawSound()).toBe(false);
    m.stop();
  });

  it("degrades to a flat meter instead of throwing when Web Audio is missing", () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", undefined);
    const m = createMicLevelMeter(streamWithAudio());
    expect(m.level()).toBe(0);
    expect(() => m.stop()).not.toThrow();
  });

  it("a stream with no audio track meters nothing", () => {
    stubAudio(() => 255);
    const m = createMicLevelMeter({ getAudioTracks: () => [] } as unknown as MediaStream);
    expect(m.level()).toBe(0);
  });

  it("nullMeter is inert", () => {
    const m = nullMeter();
    expect(m.level()).toBe(0);
    expect(m.sawSound()).toBe(false);
    expect(() => m.stop()).not.toThrow();
  });
});

describe("5 + 6 — hasAudio decides whether a transcript is ever awaited", () => {
  const cfg: FeedbackConfig = {
    appName: "Copydeck",
    teamwork: { baseUrl: "https://mavenmm.teamwork.com", tasklistId: "1", assigneeId: "100", workflowId: "66400", stageId: "388923" },
    vimeo: { folderId: "999" },
  };
  const secrets = { teamworkToken: "T", vimeoToken: "V", anthropicKey: "A" };
  const input = { type: "bug" as const, subject: "x", videoId: "555", videoUri: "/videos/555", pageUrl: "https://h" };

  function captureComments() {
    const comments: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any = {}) => {
      if (String(url).includes("/comments.json")) comments.push(JSON.parse(init.body).comment.body);
      const body = String(url).includes("/tasklists/") ? { id: 777 } : { task: { workflowStages: [{ stageId: 388923 }] } };
      return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body } as any;
    }));
    return comments;
  }

  it("silent take: no pending descriptor, so nothing is ever queued for transcription", async () => {
    const comments = captureComments();
    const out = await submitVideoFeedback(cfg, secrets, { ...input, hasAudio: false }, {});
    expect(out.result.ok).toBe(true);
    expect(out.pending).toBeUndefined();
    expect(comments[0]).toMatch(/No audio was captured/i);
    expect(comments[0]).not.toMatch(/summary pending/i);
  });

  it("take with sound: queued exactly as before", async () => {
    const comments = captureComments();
    const out = await submitVideoFeedback(cfg, secrets, { ...input, hasAudio: true }, {});
    expect(out.pending).toEqual({ taskId: "777", videoId: "555", videoUri: "/videos/555" });
    expect(comments[0]).toMatch(/summary pending/i);
  });

  it("hasAudio omitted (older client): stays optimistic and queues", async () => {
    captureComments();
    const out = await submitVideoFeedback(cfg, secrets, input, {});
    expect(out.pending).toEqual({ taskId: "777", videoId: "555", videoUri: "/videos/555" });
  });
});
