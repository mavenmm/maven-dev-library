import { useState, useRef, useCallback, useEffect } from "react";

// Screen + mic recorder for the video path. Captures a tab/window/screen
// (getDisplayMedia) + the user's mic (getUserMedia), recording the combined
// stream to a webm Blob via MediaRecorder. Pure browser APIs — no backend.

export type RecorderStatus = "idle" | "recording" | "recorded" | "error";

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

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamsRef = useRef<MediaStream[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const cleanupStreams = useCallback(() => {
    streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streamsRef.current = [];
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      // Chrome hides the *current* tab from the picker by default (selfBrowserSurface:"exclude").
      // "include" re-adds it as an option (doesn't force it). Cast: not every TS DOM lib types this field yet.
      const display = await navigator.mediaDevices.getDisplayMedia(
        { video: true, audio: true, selfBrowserSurface: "include" } as unknown as DisplayMediaStreamOptions,
      );
      let mic: MediaStream | null = null;
      try { mic = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { /* mic optional */ }
      streamsRef.current = mic ? [display, mic] : [display];

      const tracks: MediaStreamTrack[] = [...display.getVideoTracks()];
      if (mic) tracks.push(...mic.getAudioTracks());
      else tracks.push(...display.getAudioTracks());
      const combined = new MediaStream(tracks);

      chunksRef.current = [];
      const rec = new MediaRecorder(combined, { mimeType: pickMimeType() });
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const b = new Blob(chunksRef.current, { type: "video/webm" });
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        const url = URL.createObjectURL(b);
        previewUrlRef.current = url;
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
    setBlob(null); setPreviewUrl(null); setElapsedSec(0); setError(null); setStatus("idle");
  }, [cleanupStreams]);

  useEffect(() => () => {
    cleanupStreams();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, [cleanupStreams]);

  return { status, error, blob, previewUrl, elapsedSec, start, stop, reset };
}
