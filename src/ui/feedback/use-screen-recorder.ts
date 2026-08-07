import { useState, useRef, useCallback, useEffect } from "react";
import { createMicLevelMeter, hasAudioInputDevice, nullMeter, prettyDeviceLabel, type MicLevelMeter, type MicState } from "./mic-level";

// Screen + mic recorder for the video path. Captures a tab/window/screen
// (getDisplayMedia) + the user's mic (getUserMedia), recording the combined
// stream to a webm Blob via MediaRecorder. Pure browser APIs — no backend.

export type RecorderStatus = "idle" | "recording" | "recorded" | "error";

/** How often the meter is read into React state. 10/s is smooth enough for four
 *  bars and far cheaper than re-rendering on every animation frame. */
const LEVEL_POLL_MS = 100;

function pickMimeType(): string {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "video/webm";
}

/** Live, or muted at the OS/hardware level — the browser's own verdict. */
function micStateOf(stream: MediaStream): MicState {
  const track = stream.getAudioTracks()[0];
  if (!track) return "no-device";
  return track.muted ? "muted" : "live";
}

export function useScreenRecorder() {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  // "live" until we learn otherwise. Starting pessimistic would flash a scary
  // warning on every mount before enumerateDevices has answered.
  const [micState, setMicState] = useState<MicState>("live");
  const [micLevel, setMicLevel] = useState(0);
  // Which microphone is actually being used. Null until the origin has mic
  // permission — browsers withhold device labels before that.
  const [micLabel, setMicLabel] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamsRef = useRef<MediaStream[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const meterRef = useRef<MicLevelMeter>(nullMeter());
  const previewUrlRef = useRef<string | null>(null);
  // Whether THIS take ever carried sound. Read at submit time; a ref because the
  // value is captured after recording stops, not rendered.
  const sawSoundRef = useRef(false);
  // A mic acquired by prepareMic() and not yet handed to a recording. Held so the
  // confirm step can inspect it and start() can reuse it without prompting twice.
  const preparedMicRef = useRef<MediaStream | null>(null);

  // Pre-flight, before the user commits to recording: if the machine has no audio
  // input at all we can say so up front instead of letting them narrate into
  // nothing and find out afterwards. Runs on mount; needs no permission.
  useEffect(() => {
    let cancelled = false;
    void hasAudioInputDevice().then((has) => {
      // null = couldn't tell. Assume fine — a false "no microphone" warning is
      // worse than no warning, because it teaches people to ignore the banner.
      if (!cancelled && has === false) setMicState("no-device");
    });
    return () => { cancelled = true; };
  }, []);

  const cleanupStreams = useCallback(() => {
    streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streamsRef.current = [];
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (levelTimerRef.current) { clearInterval(levelTimerRef.current); levelTimerRef.current = null; }
    meterRef.current.stop();
    meterRef.current = nullMeter();
    setMicLevel(0);
  }, []);

  /**
   * Acquire the mic and report what we're dealing with, BEFORE the screen picker.
   *
   * Order matters: `track.muted` — the browser's definitive "this input is muted"
   * flag — only exists once getUserMedia has resolved. The mic used to be
   * requested *after* getDisplayMedia, so by the time we knew it was muted the
   * user had already picked a screen and recording was underway. Asking first
   * costs one permission prompt earlier and makes the muted case catchable
   * (Rondie spotted this: "I can proceed > I see mic muted").
   *
   * The stream is kept so start() reuses it — the user is never prompted twice.
   */
  const prepareMic = useCallback(async (): Promise<MicState> => {
    if (preparedMicRef.current) return micStateOf(preparedMicRef.current);
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      preparedMicRef.current = mic;
      setMicLabel(prettyDeviceLabel(mic.getAudioTracks()[0]?.label));
      const state = micStateOf(mic);
      setMicState(state);
      return state;
    } catch (err) {
      const name = (err as Error)?.name;
      const state: MicState = name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" ? "no-device" : "unavailable";
      setMicState(state);
      return state;
    }
  }, []);

  /** Drop a prepared mic the user decided not to record with. */
  const discardMic = useCallback(() => {
    preparedMicRef.current?.getTracks().forEach((t) => t.stop());
    preparedMicRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      // Chrome hides the *current* tab from the picker by default (selfBrowserSurface:"exclude").
      // "include" re-adds it as an option (doesn't force it). Cast: not every TS DOM lib types this field yet.
      const display = await navigator.mediaDevices.getDisplayMedia(
        { video: true, audio: true, selfBrowserSurface: "include" } as unknown as DisplayMediaStreamOptions,
      );

      // Reuse the mic prepareMic() already acquired; fall back to asking now if a
      // caller drove start() directly. Either way the mic stays OPTIONAL — a
      // recording with no narration is still useful, so a refused mic must never
      // abort the take. What changed is that we no longer throw the reason away:
      // this used to be a bare `catch { /* mic optional */ }`, so a denied prompt
      // silently fell back to tab audio and told nobody.
      let mic: MediaStream | null = preparedMicRef.current;
      preparedMicRef.current = null;
      if (!mic) {
        try {
          mic = await navigator.mediaDevices.getUserMedia({ audio: true });
          setMicLabel(prettyDeviceLabel(mic.getAudioTracks()[0]?.label));
          setMicState(micStateOf(mic));
        } catch (err) {
          const name = (err as Error)?.name;
          setMicState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" ? "no-device" : "unavailable");
        }
      }

      streamsRef.current = mic ? [display, mic] : [display];

      const tracks: MediaStreamTrack[] = [...display.getVideoTracks()];
      if (mic) tracks.push(...mic.getAudioTracks());
      else tracks.push(...display.getAudioTracks());
      const combined = new MediaStream(tracks);

      // An OS-level or hardware mute surfaces here on browsers that support it.
      // It does NOT catch a switch that simply delivers silence — that's the
      // meter's job, and why we don't rely on this alone.
      const micTrack = mic?.getAudioTracks()[0];
      if (micTrack) {
        micTrack.addEventListener("mute", () => setMicState("muted"));
        micTrack.addEventListener("unmute", () => setMicState("live"));
      }

      sawSoundRef.current = false;
      meterRef.current = createMicLevelMeter(mic);
      levelTimerRef.current = setInterval(() => setMicLevel(meterRef.current.level()), LEVEL_POLL_MS);

      chunksRef.current = [];
      const rec = new MediaRecorder(combined, { mimeType: pickMimeType() });
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const b = new Blob(chunksRef.current, { type: "video/webm" });
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        const url = URL.createObjectURL(b);
        previewUrlRef.current = url;
        // Capture BEFORE cleanup tears the meter down.
        sawSoundRef.current = meterRef.current.sawSound();
        setBlob(b); setPreviewUrl(url); setStatus("recorded"); cleanupStreams();
      };
      display.getVideoTracks()[0]?.addEventListener("ended", () => { if (rec.state !== "inactive") rec.stop(); });

      recorderRef.current = rec;
      rec.start();
      setStatus("recording"); setElapsedSec(0);
      timerRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    } catch (err) {
      cleanupStreams();
      const e = err as Error;
      setError(e.name === "NotAllowedError" ? "Screen capture was cancelled or blocked." : e.message || "Couldn't start recording.");
      setStatus("idle");
    }
  }, [cleanupStreams]);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
  }, []);

  const reset = useCallback(() => {
    discardMic();
    cleanupStreams();
    if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = null; }
    chunksRef.current = [];
    sawSoundRef.current = false;
    setBlob(null); setPreviewUrl(null); setElapsedSec(0); setError(null); setStatus("idle");
  }, [cleanupStreams, discardMic]);

  useEffect(() => () => {
    discardMic();
    cleanupStreams();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, [cleanupStreams, discardMic]);

  return {
    status, error, blob, previewUrl, elapsedSec, start, stop, reset, prepareMic, discardMic,
    micState, micLevel, micLabel,
    /** Did the finished take carry any sound? Sent with the submission so the
     *  backend can skip waiting for a transcript that can never exist. */
    hasAudio: () => sawSoundRef.current,
  };
}
