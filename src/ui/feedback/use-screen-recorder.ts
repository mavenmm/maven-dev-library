import { useState, useRef, useCallback, useEffect } from "react";
import { createMicLevelMeter, hasAudioInputDevice, nullMeter, type MicLevelMeter, type MicState } from "./mic-level";

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

  const start = useCallback(async () => {
    setError(null);
    try {
      // Chrome hides the *current* tab from the picker by default (selfBrowserSurface:"exclude").
      // "include" re-adds it as an option (doesn't force it). Cast: not every TS DOM lib types this field yet.
      const display = await navigator.mediaDevices.getDisplayMedia(
        { video: true, audio: true, selfBrowserSurface: "include" } as unknown as DisplayMediaStreamOptions,
      );

      // The mic stays optional — a recording with no narration is still useful, so
      // a refused mic must never abort the take. What changed is that we no longer
      // throw the reason away: this used to be a bare `catch { /* mic optional */ }`,
      // so a denied prompt silently fell back to tab audio and told nobody.
      let mic: MediaStream | null = null;
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        setMicState("live");
      } catch (err) {
        const name = (err as Error)?.name;
        setMicState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" ? "no-device" : "unavailable");
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
        if (micTrack.muted) setMicState("muted");
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
    cleanupStreams();
    if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = null; }
    chunksRef.current = [];
    sawSoundRef.current = false;
    setBlob(null); setPreviewUrl(null); setElapsedSec(0); setError(null); setStatus("idle");
  }, [cleanupStreams]);

  useEffect(() => () => {
    cleanupStreams();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, [cleanupStreams]);

  return {
    status, error, blob, previewUrl, elapsedSec, start, stop, reset,
    micState, micLevel,
    /** Did the finished take carry any sound? Sent with the submission so the
     *  backend can skip waiting for a transcript that can never exist. */
    hasAudio: () => sawSoundRef.current,
  };
}
