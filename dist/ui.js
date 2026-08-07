// src/ui/feedback/feedback-context.tsx
import { useCallback, useState } from "react";

// src/ui/feedback/feedback-config.ts
import { createContext, useContext } from "react";
var FEEDBACK_TYPES = [
  { value: "bug", label: "Bug" },
  { value: "feature", label: "Feature request" },
  { value: "working_well", label: "What's working well" },
  { value: "other", label: "Other" }
];
var FeedbackCtx = createContext(null);
function useFeedback() {
  const ctx = useContext(FeedbackCtx);
  if (!ctx) throw new Error("useFeedback must be used within a FeedbackProvider");
  return ctx;
}

// src/ui/feedback/feedback-context.tsx
import { jsx } from "react/jsx-runtime";
function FeedbackProvider({ config, children }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  return /* @__PURE__ */ jsx(FeedbackCtx.Provider, { value: { isOpen, open, close, config }, children });
}

// src/ui/feedback/feedback-launcher.tsx
import { jsx as jsx2, jsxs } from "react/jsx-runtime";
function FeedbackLauncher({ className, variant = "default" }) {
  const { open } = useFeedback();
  const base = variant === "inverted" ? "mvui-fb-launcher mvui-fb-launcher--inverted" : "mvui-fb-launcher";
  return /* @__PURE__ */ jsxs("button", { type: "button", onClick: open, className: className ?? base, children: [
    /* @__PURE__ */ jsx2("svg", { viewBox: "0 0 20 20", fill: "none", className: "mvui-fb-launcher-icon", "aria-hidden": "true", children: /* @__PURE__ */ jsx2("path", { d: "M4 4h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8l-4 3v-3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z", stroke: "currentColor", strokeWidth: "1.5", strokeLinejoin: "round" }) }),
    "Feedback"
  ] });
}

// src/ui/feedback/feedback-widget.tsx
import { lazy, Suspense, useCallback as useCallback3, useEffect as useEffect2, useRef as useRef2, useState as useState3 } from "react";
import { createPortal } from "react-dom";

// src/ui/feedback/use-screen-recorder.ts
import { useState as useState2, useRef, useCallback as useCallback2, useEffect } from "react";

// src/ui/feedback/mic-level.ts
var SILENCE_FLOOR = 0.01;
function audioContextCtor() {
  const w = globalThis;
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}
function nullMeter() {
  return { level: () => 0, sawSound: () => false, stop: () => {
  } };
}
function createMicLevelMeter(stream) {
  if (!stream || stream.getAudioTracks().length === 0) return nullMeter();
  const Ctor = audioContextCtor();
  if (!Ctor) return nullMeter();
  let ctx;
  let analyser;
  let source;
  try {
    ctx = new Ctor();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
  } catch {
    return nullMeter();
  }
  const buf = new Uint8Array(analyser.fftSize);
  let smoothed = 0;
  let sawSound = false;
  let stopped = false;
  return {
    level() {
      if (stopped) return 0;
      try {
        analyser.getByteTimeDomainData(buf);
      } catch {
        return 0;
      }
      let sumSquares = 0;
      for (let i = 0; i < buf.length; i++) {
        const deviation = (buf[i] - 128) / 128;
        sumSquares += deviation * deviation;
      }
      const rms = Math.sqrt(sumSquares / buf.length);
      if (rms >= SILENCE_FLOOR) sawSound = true;
      smoothed = rms > smoothed ? rms : smoothed * 0.8 + rms * 0.2;
      return Math.min(1, smoothed);
    },
    sawSound: () => sawSound,
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        source.disconnect();
      } catch {
      }
      try {
        void ctx.close();
      } catch {
      }
    }
  };
}
async function hasAudioInputDevice() {
  const md = globalThis.navigator?.mediaDevices;
  if (!md?.enumerateDevices) return null;
  try {
    const devices = await md.enumerateDevices();
    return devices.some((d) => d.kind === "audioinput");
  } catch {
    return null;
  }
}

// src/ui/feedback/use-screen-recorder.ts
var LEVEL_POLL_MS = 100;
function pickMimeType() {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "video/webm";
}
function useScreenRecorder() {
  const [status, setStatus] = useState2("idle");
  const [error, setError] = useState2(null);
  const [blob, setBlob] = useState2(null);
  const [previewUrl, setPreviewUrl] = useState2(null);
  const [elapsedSec, setElapsedSec] = useState2(0);
  const [micState, setMicState] = useState2("live");
  const [micLevel, setMicLevel] = useState2(0);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamsRef = useRef([]);
  const timerRef = useRef(null);
  const levelTimerRef = useRef(null);
  const meterRef = useRef(nullMeter());
  const previewUrlRef = useRef(null);
  const sawSoundRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void hasAudioInputDevice().then((has) => {
      if (!cancelled && has === false) setMicState("no-device");
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const cleanupStreams = useCallback2(() => {
    streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streamsRef.current = [];
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (levelTimerRef.current) {
      clearInterval(levelTimerRef.current);
      levelTimerRef.current = null;
    }
    meterRef.current.stop();
    meterRef.current = nullMeter();
    setMicLevel(0);
  }, []);
  const start = useCallback2(async () => {
    setError(null);
    try {
      const display = await navigator.mediaDevices.getDisplayMedia(
        { video: true, audio: true, selfBrowserSurface: "include" }
      );
      let mic = null;
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        setMicState("live");
      } catch (err) {
        const name = err?.name;
        setMicState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" ? "no-device" : "unavailable");
      }
      streamsRef.current = mic ? [display, mic] : [display];
      const tracks = [...display.getVideoTracks()];
      if (mic) tracks.push(...mic.getAudioTracks());
      else tracks.push(...display.getAudioTracks());
      const combined = new MediaStream(tracks);
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
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const b = new Blob(chunksRef.current, { type: "video/webm" });
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        const url = URL.createObjectURL(b);
        previewUrlRef.current = url;
        sawSoundRef.current = meterRef.current.sawSound();
        setBlob(b);
        setPreviewUrl(url);
        setStatus("recorded");
        cleanupStreams();
      };
      display.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (rec.state !== "inactive") rec.stop();
      });
      recorderRef.current = rec;
      rec.start();
      setStatus("recording");
      setElapsedSec(0);
      timerRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1e3);
    } catch (err) {
      cleanupStreams();
      const e = err;
      setError(e.name === "NotAllowedError" ? "Screen capture was cancelled or blocked." : e.message || "Couldn't start recording.");
      setStatus("idle");
    }
  }, [cleanupStreams]);
  const stop = useCallback2(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
  }, []);
  const reset = useCallback2(() => {
    cleanupStreams();
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    chunksRef.current = [];
    sawSoundRef.current = false;
    setBlob(null);
    setPreviewUrl(null);
    setElapsedSec(0);
    setError(null);
    setStatus("idle");
  }, [cleanupStreams]);
  useEffect(() => () => {
    cleanupStreams();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, [cleanupStreams]);
  return {
    status,
    error,
    blob,
    previewUrl,
    elapsedSec,
    start,
    stop,
    reset,
    micState,
    micLevel,
    /** Did the finished take carry any sound? Sent with the submission so the
     *  backend can skip waiting for a transcript that can never exist. */
    hasAudio: () => sawSoundRef.current
  };
}

// src/ui/feedback/upload-video.ts
import { Upload } from "tus-js-client";
var VideoUploadError = class _VideoUploadError extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.name = "VideoUploadError";
    this.httpStatus = opts.httpStatus;
    this.responseBody = opts.responseBody;
    this.cause = opts.cause;
    Object.setPrototypeOf(this, _VideoUploadError.prototype);
  }
};
function describeTusError(err) {
  const detailed = err;
  const res = detailed?.originalResponse;
  const httpStatus = typeof res?.getStatus === "function" ? res.getStatus() : void 0;
  let responseBody;
  try {
    responseBody = typeof res?.getBody === "function" ? String(res.getBody()).slice(0, 300) : void 0;
  } catch {
    responseBody = void 0;
  }
  const base = err instanceof Error ? err.message : String(err);
  const suffix = httpStatus ? ` (HTTP ${httpStatus}${responseBody ? ` \u2014 ${responseBody}` : ""})` : "";
  return new VideoUploadError(`Vimeo upload failed: ${base}${suffix}`, { httpStatus, responseBody, cause: err });
}
function uploadToVimeoTus(uploadLink, file, onProgress) {
  return new Promise((resolve, reject) => {
    if (!uploadLink) {
      reject(new VideoUploadError("Vimeo upload failed: no upload link was issued."));
      return;
    }
    const upload = new Upload(file, {
      uploadUrl: uploadLink,
      retryDelays: [0, 1e3, 3e3, 5e3, 1e4],
      metadata: { filename: "feedback-recording.webm", filetype: "video/webm" },
      onError: (err) => reject(describeTusError(err)),
      onProgress: (sent, total) => {
        if (onProgress && total > 0) onProgress(sent / total);
      },
      onSuccess: () => resolve()
    });
    try {
      upload.start();
    } catch (err) {
      reject(describeTusError(err));
    }
  });
}

// src/ui/styles.css
var styles_default = `/* @mavenmm/ui feedback widget \u2014 self-contained, scoped styles.
   Every selector is under an .mvui-fb-* class; NO element/global resets, so the
   sheet never fights a host app's CSS or Tailwind (any version).
   Sizing/typography tuned to copydeck's feedback widget (its effective
   text-sm\u224816px / text-xs\u224814px scale) while staying host-independent:
   font-family inherits the host, everything else is fixed px. */

.mvui-fb-launcher { display:inline-flex; align-items:center; gap:8px; border:0; background:transparent; cursor:pointer; font:inherit; font-size:16px; font-weight:500; padding:8px 12px; border-radius:6px; color:inherit; }
.mvui-fb-launcher:hover { background:rgba(0,0,0,0.06); }
/* inverted variant: white text/icon (icon uses currentColor) for dark surfaces */
.mvui-fb-launcher--inverted { color:#fff; }
.mvui-fb-launcher--inverted:hover { background:rgba(255,255,255,0.14); }
.mvui-fb-launcher-icon { width:18px; height:18px; }

.mvui-fb-panel { position:fixed; display:flex; flex-direction:column; background:#fff; color:#0f172a; border:1px solid #e2e8f0; border-radius:10px; box-shadow:0 25px 50px -12px rgba(0,0,0,0.25); font-family:inherit; font-size:16px; box-sizing:border-box; text-align:left; }
.mvui-fb-panel * { box-sizing:border-box; }
.mvui-fb-bar { display:flex; align-items:center; justify-content:space-between; padding:10px 16px; background:#e2e8f0; border-bottom:1px solid #cbd5e1; border-radius:10px 10px 0 0; cursor:move; user-select:none; }
.mvui-fb-bar-title { font-size:16px; font-weight:600; }
.mvui-fb-x { border:0; background:transparent; font-size:20px; line-height:1; color:#64748b; cursor:pointer; padding:0 6px; }
.mvui-fb-x:hover { color:#1e293b; }
.mvui-fb-body { display:flex; flex-direction:column; gap:16px; padding:16px; }

.mvui-fb-topic-step { display:flex; flex-direction:column; gap:16px; padding:8px 0 4px; text-align:left; }
.mvui-fb-topic-prompt { font-size:18px; font-weight:600; margin:0; color:#0f172a; }
.mvui-fb-topics { display:flex; flex-wrap:wrap; gap:12px; }
.mvui-fb-topic-choice { flex:1 1 180px; border:1px solid #cbd5e1; border-radius:10px; padding:20px 16px; font:inherit; font-size:15px; font-weight:600; color:#0f172a; background:#f8fafc; cursor:pointer; text-align:left; }
.mvui-fb-topic-choice:hover { border-color:#3b82f6; background:#eff6ff; }
.mvui-fb-topic-crumb { display:flex; align-items:center; gap:10px; font-size:13px; color:#475569; }

.mvui-fb-types { display:flex; flex-wrap:wrap; gap:8px; }
.mvui-fb-type { border:0; border-radius:6px; padding:6px 12px; font:inherit; font-size:14px; font-weight:500; cursor:pointer; background:#f1f5f9; color:#475569; }
.mvui-fb-type:hover { background:#e2e8f0; }
.mvui-fb-type[data-active="true"] { background:#1e293b; color:#fff; }

.mvui-fb-modes { display:inline-flex; width:max-content; border:1px solid #e2e8f0; border-radius:6px; padding:3px; }
.mvui-fb-mode { border:0; background:transparent; border-radius:4px; padding:6px 14px; font:inherit; font-size:14px; font-weight:500; color:#475569; cursor:pointer; }
.mvui-fb-mode:hover:not([data-active="true"]) { background:#f1f5f9; }
.mvui-fb-mode[data-active="true"] { background:#1e293b; color:#fff; }

.mvui-fb-input { width:100%; border:1px solid #cbd5e1; border-radius:6px; padding:8px 10px; font:inherit; font-size:16px; color:#0f172a; background:#fff; text-align:left; }
.mvui-fb-input::placeholder { color:#94a3b8; }
.mvui-fb-input:focus { outline:none; border-color:#3b82f6; box-shadow:0 0 0 1px #3b82f6; }
.mvui-fb-textarea { width:100%; min-height:176px; resize:vertical; border:1px solid #cbd5e1; border-radius:6px; padding:8px 10px; font:inherit; font-size:16px; color:#0f172a; background:#fff; text-align:left; }
.mvui-fb-textarea::placeholder { color:#94a3b8; }
.mvui-fb-textarea:focus { outline:none; border-color:#3b82f6; box-shadow:0 0 0 1px #3b82f6; }

.mvui-fb-composer { border:1px solid #cbd5e1; border-radius:6px; padding:8px 10px; background:#fff; min-height:256px; max-height:48vh; overflow-y:auto; }
.mvui-fb-prose { outline:none; font-size:16px; color:#0f172a; }
.mvui-fb-prose p { margin:0 0 0.5em; }
.mvui-fb-prose img { max-width:100%; height:auto; border-radius:4px; }
.mvui-fb-prose p.is-editor-empty:first-child::before { content:attr(data-placeholder); color:#9ca3af; float:left; height:0; pointer-events:none; }
.mvui-fb-composer-tools { display:flex; align-items:center; gap:8px; margin-top:6px; }
.mvui-fb-link { border:0; background:transparent; padding:0; font:inherit; font-size:14px; font-weight:500; color:#2563eb; cursor:pointer; }
.mvui-fb-link:hover { color:#1d4ed8; }
.mvui-fb-link:disabled { color:#94a3b8; cursor:default; }
.mvui-fb-hint { font-size:14px; color:#94a3b8; }

.mvui-fb-video-idle { border:1px dashed #93c5fd; background:#eff6ff; border-radius:10px; padding:28px 20px; text-align:center; }
.mvui-fb-video-idle .mvui-fb-hint { display:block; margin-top:8px; }
.mvui-fb-video-preview { display:flex; flex-direction:column; gap:8px; }
.mvui-fb-video { max-height:288px; width:100%; border:1px solid #cbd5e1; border-radius:6px; background:#000; }
.mvui-fb-video-row { display:flex; align-items:center; gap:12px; }
/* in-panel recording controls (collapseWhileRecording=false) */
.mvui-fb-video-recording { display:flex; align-items:center; gap:12px; border:1px solid #cbd5e1; border-radius:6px; padding:12px 14px; background:#fff; }
.mvui-fb-video-recording .mvui-fb-hint { flex:1; }

.mvui-fb-actions { display:flex; align-items:center; justify-content:flex-end; gap:10px; margin-top:6px; }
.mvui-fb-cancel { border:0; background:transparent; color:#64748b; font:inherit; font-size:16px; padding:8px 16px; cursor:pointer; }
.mvui-fb-cancel:hover { color:#334155; }
.mvui-fb-send { border:0; border-radius:6px; background:#2563eb; color:#fff; font:inherit; font-size:16px; font-weight:500; padding:10px 18px; cursor:pointer; }
.mvui-fb-send:hover { background:#1d4ed8; }
.mvui-fb-send:disabled { background:#cbd5e1; cursor:not-allowed; }

.mvui-fb-ok { border:1px solid #a7f3d0; background:#ecfdf5; color:#065f46; border-radius:6px; padding:14px; font-size:16px; }
.mvui-fb-ok p { margin:0; font-weight:500; }
.mvui-fb-ok a { display:inline-block; margin-top:4px; font-size:14px; font-weight:500; color:#047857; text-decoration:underline; }
.mvui-fb-ok a:hover { color:#064e3b; }
.mvui-fb-err { border:1px solid #fecdd3; background:#fff1f2; color:#be123c; border-radius:6px; padding:10px 14px; font-size:14px; margin:0; }

.mvui-fb-pill { position:fixed; display:flex; align-items:center; gap:8px; border:1px solid #334155; background:#0f172a; padding:10px 14px; border-radius:9999px; outline:1px solid rgba(244,63,94,0.4); box-shadow:0 8px 30px rgba(0,0,0,0.45),0 0 22px rgba(244,63,94,0.6); }
.mvui-fb-pill-grip { cursor:move; user-select:none; padding:0 4px; color:#64748b; }
.mvui-fb-pill-time { display:flex; align-items:center; gap:6px; font-size:16px; font-weight:600; color:#fb7185; }
.mvui-fb-pill-dot { width:10px; height:10px; border-radius:9999px; background:#f43f5e; animation:mvui-fb-pulse 2s cubic-bezier(0.4,0,0.6,1) infinite; }
.mvui-fb-pill-label { font-size:14px; color:#94a3b8; }
.mvui-fb-pill-stop { margin-left:auto; border:0; border-radius:6px; background:#e11d48; color:#fff; font:inherit; font-size:16px; padding:6px 14px; cursor:pointer; }
.mvui-fb-pill-stop:hover { background:#f43f5e; }

@keyframes mvui-fb-pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }

/* Mic level meter \u2014 sits in the recording pill and the expanded recording row.
   Four bars that move with the user's voice: a muted mic reads as four flat bars
   for the whole take, which is the only moment they can still fix it. */
.mvui-fb-mic { display:inline-flex; align-items:flex-end; gap:2px; height:14px; }
.mvui-fb-mic-bar { width:3px; border-radius:1px; background:#334155; transition:background 80ms linear; }
.mvui-fb-mic-bar[data-lit="true"] { background:#34d399; }
.mvui-fb-mic-off { align-items:center; gap:4px; position:relative; font-size:11px; color:#fbbf24; }
.mvui-fb-mic-slash { position:absolute; left:-1px; top:6px; width:13px; height:1.5px; background:#fbbf24; transform:rotate(-45deg); }
.mvui-fb-mic-word { white-space:nowrap; }
/* Amber, not red: a silent recording is a warning, not a failure \u2014 the video is
   still worth sending. Red here would read as "this is broken, stop". */
.mvui-fb-mic-warn { color:#b45309; }
`;

// src/ui/feedback/feedback-widget.tsx
import { Fragment, jsx as jsx3, jsxs as jsxs2 } from "react/jsx-runtime";
var FeedbackComposer = lazy(() => import("./feedback-composer-DHNFMEGW.js"));
var PANEL_WIDTH = 1020;
var PILL_WIDTH = 260;
function mmss(total) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function errorText(err, fallback) {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}
var MIC_BARS = 4;
function MicMeter({ level, state }) {
  if (state !== "live") {
    const why = state === "denied" ? "mic blocked" : state === "no-device" ? "no mic" : state === "muted" ? "mic muted" : "mic off";
    return /* @__PURE__ */ jsxs2("span", { className: "mvui-fb-mic mvui-fb-mic-off", title: `${why} \u2014 this recording will have no narration`, children: [
      /* @__PURE__ */ jsx3("span", { "aria-hidden": "true", children: "\u{1F399}" }),
      /* @__PURE__ */ jsx3("span", { className: "mvui-fb-mic-slash", "aria-hidden": "true" }),
      /* @__PURE__ */ jsx3("span", { className: "mvui-fb-mic-word", children: why })
    ] });
  }
  return /* @__PURE__ */ jsx3("span", { className: "mvui-fb-mic", role: "img", "aria-label": `Microphone level ${Math.round(level * 100)}%`, children: Array.from({ length: MIC_BARS }, (_, i) => {
    const lit = level >= (i + 1) / (MIC_BARS + 1);
    return /* @__PURE__ */ jsx3("span", { className: "mvui-fb-mic-bar", "data-lit": lit, style: { height: `${5 + i * 3}px` } }, i);
  }) });
}
function FeedbackWidget() {
  const { isOpen, close, config } = useFeedback();
  const { transport } = config;
  const enableVideo = config.enableVideo ?? true;
  const enableRichText = config.enableRichText ?? true;
  const collapseWhileRecording = config.collapseWhileRecording ?? true;
  const z = config.zIndex ?? 2147483e3;
  const topics = config.topics;
  const needsTopic = !!(topics && topics.length);
  const topicPrompt = config.topicPrompt ?? "What's this feedback about?";
  const defaultMode = (config.defaultMode ?? "video") === "video" && enableVideo ? "video" : "write";
  const [mounted, setMounted] = useState3(false);
  const [shadowEl, setShadowEl] = useState3(null);
  const [mode, setMode] = useState3(defaultMode);
  const [type, setType] = useState3("bug");
  const [subject, setSubject] = useState3("");
  const [bodyHtml, setBodyHtml] = useState3("");
  const [plainBody, setPlainBody] = useState3("");
  const [submitting, setSubmitting] = useState3(false);
  const [uploadProgress, setUploadProgress] = useState3(null);
  const [result, setResult] = useState3(null);
  const [composerKey, setComposerKey] = useState3(0);
  const [topic, setTopic] = useState3(null);
  const recorder = useScreenRecorder();
  const [pos, setPos] = useState3(null);
  const drag = useRef2(null);
  const widthRef = useRef2(PANEL_WIDTH);
  useEffect2(() => {
    const host = document.createElement("div");
    host.setAttribute("data-mvui-feedback-root", "");
    host.style.position = "fixed";
    host.style.top = "0";
    host.style.left = "0";
    host.style.zIndex = String(z);
    const root = host.attachShadow({ mode: "open" });
    const styleEl = document.createElement("style");
    styleEl.textContent = styles_default;
    root.appendChild(styleEl);
    const container = document.createElement("div");
    root.appendChild(container);
    document.body.appendChild(host);
    setShadowEl(container);
    setMounted(true);
    return () => {
      host.remove();
    };
  }, [z]);
  const isPill = mode === "video" && recorder.status === "recording" && collapseWhileRecording;
  useEffect2(() => {
    if (isOpen && !pos) setPos({ left: Math.max(16, window.innerWidth - PANEL_WIDTH - 24), top: Math.max(16, Math.round(window.innerHeight * 0.12)) });
  }, [isOpen, pos]);
  const onMove = useCallback3((e) => {
    if (!drag.current) return;
    const w = widthRef.current;
    setPos({ left: Math.min(Math.max(8, e.clientX - drag.current.dx), window.innerWidth - w - 8), top: Math.min(Math.max(8, e.clientY - drag.current.dy), window.innerHeight - 80) });
  }, []);
  const onUp = useCallback3(() => {
    drag.current = null;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  }, [onMove]);
  const onDown = useCallback3((e) => {
    if (!pos) return;
    drag.current = { dx: e.clientX - pos.left, dy: e.clientY - pos.top };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [pos, onMove, onUp]);
  useEffect2(() => () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  }, [onMove, onUp]);
  function resetForm() {
    setSubject("");
    setBodyHtml("");
    setPlainBody("");
    setResult(null);
    setUploadProgress(null);
    setComposerKey((k) => k + 1);
    setTopic(null);
    recorder.reset();
  }
  function handleClose() {
    resetForm();
    setMode(defaultMode);
    close();
  }
  function switchMode(next) {
    if (recorder.status === "recording") return;
    if (next === "write") recorder.reset();
    setResult(null);
    setMode(next);
  }
  const autoContext = () => ({
    pageUrl: window.location.href,
    pageTitle: document.title,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`
  });
  function currentBodyHtml() {
    if (enableRichText) return bodyHtml;
    const t = plainBody.trim();
    return t ? `<p>${t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br/>")}</p>` : "";
  }
  async function handleSubmitText() {
    if (!subject.trim() || submitting) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await transport.submitText({ type, subject: subject.trim(), bodyHtml: currentBodyHtml(), topic: topic?.value, topicLabel: topic?.label, ...autoContext() });
      setResult(res);
      if (res.ok) {
        setSubject("");
        setBodyHtml("");
        setPlainBody("");
        setComposerKey((k) => k + 1);
      }
    } catch (err) {
      setResult({ ok: false, error: errorText(err, "Couldn't send your feedback. Please try again.") });
    } finally {
      setSubmitting(false);
    }
  }
  async function handleSubmitVideo() {
    if (!subject.trim() || !recorder.blob || submitting) return;
    setSubmitting(true);
    setResult(null);
    setUploadProgress(0);
    try {
      const target = await transport.createVideoTarget(recorder.blob.size, subject.trim());
      await uploadToVimeoTus(target.uploadLink, recorder.blob, (f) => setUploadProgress(f));
      const res = await transport.submitVideo({ type, subject: subject.trim(), videoId: target.videoId, videoUri: target.videoUri, hasAudio: recorder.hasAudio(), topic: topic?.value, topicLabel: topic?.label, ...autoContext() });
      setResult(res);
      if (res.ok) {
        recorder.reset();
        setSubject("");
      }
    } catch (err) {
      setResult({ ok: false, error: `Video feedback failed: ${errorText(err, "the upload didn't complete.")}` });
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  }
  if (!mounted || !isOpen || !pos || !shadowEl) return null;
  if (isPill) {
    widthRef.current = PILL_WIDTH;
    return createPortal(
      /* @__PURE__ */ jsxs2("div", { className: "mvui-fb-pill", style: { top: pos.top, left: pos.left, width: PILL_WIDTH, zIndex: z }, children: [
        /* @__PURE__ */ jsx3("span", { className: "mvui-fb-pill-grip", onMouseDown: onDown, title: "Drag", children: "\u283F" }),
        /* @__PURE__ */ jsxs2("span", { className: "mvui-fb-pill-time", children: [
          /* @__PURE__ */ jsx3("span", { className: "mvui-fb-pill-dot" }),
          mmss(recorder.elapsedSec)
        ] }),
        /* @__PURE__ */ jsx3(MicMeter, { level: recorder.micLevel, state: recorder.micState }),
        /* @__PURE__ */ jsx3("span", { className: "mvui-fb-pill-label", children: "recording\u2026" }),
        /* @__PURE__ */ jsx3("button", { type: "button", className: "mvui-fb-pill-stop", onClick: recorder.stop, children: "Stop" })
      ] }),
      shadowEl
    );
  }
  const panelWidth = Math.min(PANEL_WIDTH, window.innerWidth - 32);
  widthRef.current = panelWidth;
  const sendDisabled = submitting || !subject.trim() || mode === "video" && recorder.status !== "recorded";
  return createPortal(
    /* @__PURE__ */ jsxs2("div", { className: "mvui-fb-panel", role: "dialog", "aria-label": "Send feedback", style: { top: pos.top, left: pos.left, width: panelWidth, zIndex: z }, children: [
      /* @__PURE__ */ jsxs2("div", { className: "mvui-fb-bar", onMouseDown: onDown, children: [
        /* @__PURE__ */ jsx3("span", { className: "mvui-fb-bar-title", children: "Send feedback" }),
        /* @__PURE__ */ jsx3("button", { type: "button", className: "mvui-fb-x", "aria-label": "Close", onClick: handleClose, children: "\xD7" })
      ] }),
      /* @__PURE__ */ jsx3("div", { className: "mvui-fb-body", children: result?.ok ? /* @__PURE__ */ jsxs2("div", { className: "mvui-fb-ok", children: [
        /* @__PURE__ */ jsx3("p", { children: "Thanks \u2014 your feedback was filed." }),
        result.url && /* @__PURE__ */ jsx3("a", { href: result.url, target: "_blank", rel: "noreferrer", children: "View the Teamwork task \u2192" }),
        /* @__PURE__ */ jsxs2("div", { className: "mvui-fb-actions", children: [
          /* @__PURE__ */ jsx3("button", { type: "button", className: "mvui-fb-send", onClick: () => setResult(null), children: "Send another" }),
          /* @__PURE__ */ jsx3("button", { type: "button", className: "mvui-fb-cancel", onClick: handleClose, children: "Done" })
        ] })
      ] }) : needsTopic && !topic ? /* @__PURE__ */ jsxs2("div", { className: "mvui-fb-topic-step", children: [
        /* @__PURE__ */ jsx3("p", { className: "mvui-fb-topic-prompt", children: topicPrompt }),
        /* @__PURE__ */ jsx3("div", { className: "mvui-fb-topics", children: topics.map((t) => /* @__PURE__ */ jsx3("button", { type: "button", className: "mvui-fb-topic-choice", onClick: () => setTopic(t), children: t.label }, t.value)) })
      ] }) : /* @__PURE__ */ jsxs2(Fragment, { children: [
        topic && /* @__PURE__ */ jsxs2("div", { className: "mvui-fb-topic-crumb", children: [
          /* @__PURE__ */ jsxs2("span", { children: [
            /* @__PURE__ */ jsx3("strong", { children: "Area:" }),
            " ",
            topic.label
          ] }),
          /* @__PURE__ */ jsx3("button", { type: "button", className: "mvui-fb-link", onClick: () => setTopic(null), children: "change" })
        ] }),
        /* @__PURE__ */ jsx3("div", { className: "mvui-fb-types", children: FEEDBACK_TYPES.map((t) => /* @__PURE__ */ jsx3("button", { type: "button", className: "mvui-fb-type", "data-active": type === t.value, onClick: () => setType(t.value), children: t.label }, t.value)) }),
        enableVideo && /* @__PURE__ */ jsx3("div", { className: "mvui-fb-modes", children: ["write", "video"].map((m) => /* @__PURE__ */ jsx3("button", { type: "button", className: "mvui-fb-mode", "data-active": mode === m, onClick: () => switchMode(m), children: m === "write" ? "Write" : "Record video" }, m)) }),
        /* @__PURE__ */ jsx3("input", { className: "mvui-fb-input", type: "text", value: subject, onChange: (e) => setSubject(e.target.value), placeholder: "One-line summary" }),
        mode === "write" ? enableRichText ? /* @__PURE__ */ jsx3(Suspense, { fallback: /* @__PURE__ */ jsx3("p", { className: "mvui-fb-hint", children: "Loading editor\u2026" }), children: /* @__PURE__ */ jsx3(FeedbackComposer, { uploadImage: transport.uploadImage, onChange: (html) => setBodyHtml(html) }, composerKey) }) : /* @__PURE__ */ jsx3("textarea", { className: "mvui-fb-textarea", value: plainBody, onChange: (e) => setPlainBody(e.target.value), placeholder: "What happened? What did you expect?" }) : /* @__PURE__ */ jsx3(VideoPane, { recorder, uploadProgress, submitting }),
        result && !result.ok && /* @__PURE__ */ jsx3("p", { className: "mvui-fb-err", children: result.error }),
        /* @__PURE__ */ jsxs2("div", { className: "mvui-fb-actions", children: [
          /* @__PURE__ */ jsx3("button", { type: "button", className: "mvui-fb-cancel", onClick: handleClose, children: "Cancel" }),
          /* @__PURE__ */ jsx3("button", { type: "button", className: "mvui-fb-send", disabled: sendDisabled, onClick: mode === "write" ? handleSubmitText : handleSubmitVideo, children: submitting ? uploadProgress !== null ? `Uploading\u2026 ${Math.round(uploadProgress * 100)}%` : "Sending\u2026" : "Send feedback" })
        ] })
      ] }) })
    ] }),
    shadowEl
  );
}
function VideoPane({ recorder, uploadProgress, submitting }) {
  if (recorder.status === "recording") {
    return /* @__PURE__ */ jsxs2("div", { className: "mvui-fb-video-recording", children: [
      /* @__PURE__ */ jsxs2("span", { className: "mvui-fb-pill-time", children: [
        /* @__PURE__ */ jsx3("span", { className: "mvui-fb-pill-dot" }),
        mmss(recorder.elapsedSec)
      ] }),
      /* @__PURE__ */ jsx3(MicMeter, { level: recorder.micLevel, state: recorder.micState }),
      /* @__PURE__ */ jsx3("span", { className: "mvui-fb-hint", children: "Recording\u2026 drive the app, then click Stop." }),
      /* @__PURE__ */ jsx3("button", { type: "button", className: "mvui-fb-pill-stop", onClick: recorder.stop, children: "Stop" })
    ] });
  }
  if (recorder.status === "recorded" && recorder.previewUrl) {
    return /* @__PURE__ */ jsxs2("div", { className: "mvui-fb-video-preview", children: [
      /* @__PURE__ */ jsx3("video", { src: recorder.previewUrl, controls: true, className: "mvui-fb-video" }),
      /* @__PURE__ */ jsxs2("div", { className: "mvui-fb-video-row", children: [
        /* @__PURE__ */ jsx3("button", { type: "button", className: "mvui-fb-link", onClick: recorder.reset, disabled: submitting, children: "\u21BA Re-record" }),
        uploadProgress !== null && /* @__PURE__ */ jsxs2("span", { className: "mvui-fb-hint", children: [
          "Uploading to Vimeo\u2026 ",
          Math.round(uploadProgress * 100),
          "%"
        ] })
      ] })
    ] });
  }
  return /* @__PURE__ */ jsxs2("div", { className: "mvui-fb-video-idle", children: [
    /* @__PURE__ */ jsx3("button", { type: "button", className: "mvui-fb-send", onClick: recorder.start, children: "\u23FA Start recording" }),
    /* @__PURE__ */ jsx3("p", { className: "mvui-fb-hint", children: "Captures a tab/window + your mic. The widget shrinks to a small pill while recording; click Stop when done." }),
    recorder.micState === "no-device" && /* @__PURE__ */ jsx3("p", { className: "mvui-fb-hint mvui-fb-mic-warn", children: "No microphone detected \u2014 this recording will have no sound." }),
    recorder.micState === "denied" && /* @__PURE__ */ jsx3("p", { className: "mvui-fb-hint mvui-fb-mic-warn", children: "Microphone access is blocked, so the recording will be silent. Allow it in your browser's site settings to narrate." }),
    recorder.error && /* @__PURE__ */ jsx3("p", { className: "mvui-fb-err", children: recorder.error })
  ] });
}

// src/ui/index.ts
var UI_VERSION = "0.1.0";
export {
  FEEDBACK_TYPES,
  FeedbackLauncher,
  FeedbackProvider,
  FeedbackWidget,
  UI_VERSION,
  useFeedback
};
