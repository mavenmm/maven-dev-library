// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, within, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { FeedbackProvider, FeedbackLauncher, FeedbackWidget, type FeedbackTransport } from "../src/ui/index";

// The pre-start gate: when the browser tells us the mic is unusable — absent,
// refused, or reporting itself muted — confirm before the user invests time.
// Never gate Send, and never gate on suspicion. See handleStartClicked().

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function panel() {
  const host = document.querySelector("[data-mvui-feedback-root]");
  if (!host?.shadowRoot) throw new Error("feedback shadow root not mounted");
  return within(host.shadowRoot as unknown as HTMLElement);
}

const transport: FeedbackTransport = {
  submitText: vi.fn(async () => ({ ok: true })),
  uploadImage: vi.fn(async () => ({ url: "https://cdn/x.png" })),
  createVideoTarget: vi.fn(async () => ({ uploadLink: "https://tus/x", videoId: "v", videoUri: "/videos/v" })),
  submitVideo: vi.fn(async () => ({ ok: true })),
};

/** `devices` drives enumerateDevices; getDisplayMedia is spied so we can assert
 *  whether the recording actually began. */
function setupMedia(
  devices: Array<{ kind: string; deviceId?: string; label?: string }>,
  mic: { reject?: string; muted?: boolean; label?: string } = { reject: "NotAllowedError" },
) {
  const getDisplayMedia = vi.fn(async () => { throw new Error("stop here — we only assert that recording BEGAN"); });
  const getUserMedia = vi.fn(async () => {
    if (mic.reject) throw Object.assign(new Error("no"), { name: mic.reject });
    const track = { muted: !!mic.muted, label: mic.label ?? "AirPods Pro", stop() {}, addEventListener() {} };
    return { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
  });
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: { enumerateDevices: async () => devices, getDisplayMedia, getUserMedia },
  });
  return getDisplayMedia;
}

function open() {
  render(
    <FeedbackProvider config={{ transport, enableVideo: true, enableRichText: false, defaultMode: "video" }}>
      <FeedbackLauncher />
      <FeedbackWidget />
    </FeedbackProvider>,
  );
  fireEvent.click(document.querySelector("button")!);
}

describe("pre-start confirmation when the mic is certainly unusable", () => {
  beforeEach(() => { window.MediaRecorder = undefined as never; });

  it("no audio device: Start asks first instead of recording", async () => {
    const getDisplayMedia = setupMedia([{ kind: "videoinput" }]);
    open();
    // The warning appears without any interaction — before they commit.
    await waitFor(() => expect(panel().getByText(/No microphone detected/i)).toBeTruthy());

    fireEvent.click(panel().getByText(/Start recording/i));

    await waitFor(() => expect(panel().getByText(/no narration/i)).toBeTruthy());
    expect(panel().getByText(/Record without sound/i)).toBeTruthy();
    expect(panel().getByText(/Let me fix the mic/i)).toBeTruthy();
    // The decisive assertion: nothing started.
    expect(getDisplayMedia).not.toHaveBeenCalled();
  });

  it("'Record without sound' proceeds — it is a confirmation, not a block", async () => {
    const getDisplayMedia = setupMedia([{ kind: "videoinput" }]);
    open();
    await waitFor(() => expect(panel().getByText(/No microphone detected/i)).toBeTruthy());
    fireEvent.click(panel().getByText(/Start recording/i));
    await waitFor(() => expect(panel().getByText(/Record without sound/i)).toBeTruthy());

    fireEvent.click(panel().getByText(/Record without sound/i));
    await waitFor(() => expect(getDisplayMedia).toHaveBeenCalledOnce());
  });

  it("'Let me fix the mic' returns to the idle pane without recording", async () => {
    const getDisplayMedia = setupMedia([{ kind: "videoinput" }]);
    open();
    await waitFor(() => expect(panel().getByText(/No microphone detected/i)).toBeTruthy());
    fireEvent.click(panel().getByText(/Start recording/i));
    await waitFor(() => expect(panel().getByText(/Let me fix the mic/i)).toBeTruthy());

    fireEvent.click(panel().getByText(/Let me fix the mic/i));
    await waitFor(() => expect(panel().getByText(/Start recording/i)).toBeTruthy());
    expect(getDisplayMedia).not.toHaveBeenCalled();
  });

  it("a MUTED mic is caught before the screen picker opens", async () => {
    // The case Rondie hit: the gate never fired and the mute only showed up in the
    // pill mid-recording, because the mic used to be requested AFTER getDisplayMedia.
    const getDisplayMedia = setupMedia(
      [{ kind: "audioinput", deviceId: "default", label: "AirPods Pro" }],
      { muted: true, label: "AirPods Pro" },
    );
    open();
    fireEvent.click(panel().getByText(/Start recording/i));

    await waitFor(() => expect(panel().getByText(/microphone is muted/i)).toBeTruthy());
    expect(panel().getByText(/AirPods Pro/)).toBeTruthy();
    expect(getDisplayMedia).not.toHaveBeenCalled(); // never got as far as the picker
  });

  it("a working mic is NEVER gated — Start records immediately", async () => {
    const getDisplayMedia = setupMedia([{ kind: "audioinput", deviceId: "default", label: "AirPods Pro" }], { muted: false });
    open();
    await waitFor(() => expect(panel().getByText(/Start recording/i)).toBeTruthy());

    fireEvent.click(panel().getByText(/Start recording/i));
    // Straight through. The gate must only trigger on the browser's own verdict;
    // a live mic whose owner simply hasn't spoken yet must never be questioned,
    // or the prompt gets dismissed on reflex and stops meaning anything.
    await waitFor(() => expect(getDisplayMedia).toHaveBeenCalledOnce());
  });

  it("does NOT name the mic in the idle pane — only where it answers a question", async () => {
    setupMedia([{ kind: "audioinput", deviceId: "default", label: "Default - AirPods Pro" }], { muted: false });
    open();
    await waitFor(() => expect(panel().getByText(/Start recording/i)).toBeTruthy());
    // Shown in the pill while recording and in the muted confirm (covered above),
    // never in the pane a user reads before every single recording.
    expect(panel().queryByText(/AirPods Pro/)).toBeNull();
  });
});
