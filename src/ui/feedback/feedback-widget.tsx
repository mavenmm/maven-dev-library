import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFeedback, FEEDBACK_TYPES, type FeedbackType, type FeedbackTopic, type FeedbackContextMeta, type FeedbackSubmitResult } from "./feedback-config";
const FeedbackComposer = lazy(() => import("./feedback-composer"));
import { useScreenRecorder } from "./use-screen-recorder";
import { uploadToVimeoTus } from "./upload-video";
import widgetCss from "../styles.css";

const PANEL_WIDTH = 1020; // matches copydeck; clamped to viewport−32 below
const PILL_WIDTH = 260;
type Mode = "write" | "video";

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function FeedbackWidget() {
  const { isOpen, close, config } = useFeedback();
  const { transport } = config;
  const enableVideo = config.enableVideo ?? true;
  const enableRichText = config.enableRichText ?? true;
  const collapseWhileRecording = config.collapseWhileRecording ?? true;
  const z = config.zIndex ?? 2147483000;
  const topics = config.topics;
  const needsTopic = !!(topics && topics.length);
  const topicPrompt = config.topicPrompt ?? "What's this feedback about?";

  const [mounted, setMounted] = useState(false);
  const [shadowEl, setShadowEl] = useState<HTMLElement | null>(null);
  const [mode, setMode] = useState<Mode>("write");
  const [type, setType] = useState<FeedbackType>("bug");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [plainBody, setPlainBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [result, setResult] = useState<FeedbackSubmitResult | null>(null);
  const [composerKey, setComposerKey] = useState(0);
  const [topic, setTopic] = useState<FeedbackTopic | null>(null);

  const recorder = useScreenRecorder();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const widthRef = useRef<number>(PANEL_WIDTH);

  // Render into an isolated shadow root so the host app's CSS (e.g. Tailwind preflight styling bare
  // <input>/<button>/<textarea> by element) cannot leak in. The widget's own stylesheet is injected
  // into the shadow root. Inherited props (font-family, color) still flow from the host — intentional.
  useEffect(() => {
    const host = document.createElement("div");
    host.setAttribute("data-mvui-feedback-root", "");
    host.style.position = "fixed";
    host.style.top = "0";
    host.style.left = "0";
    host.style.zIndex = String(z);
    const root = host.attachShadow({ mode: "open" });
    const styleEl = document.createElement("style");
    styleEl.textContent = widgetCss;
    root.appendChild(styleEl);
    const container = document.createElement("div");
    root.appendChild(container);
    document.body.appendChild(host);
    setShadowEl(container);
    setMounted(true);
    return () => { host.remove(); };
  }, [z]);
  const isPill = mode === "video" && recorder.status === "recording" && collapseWhileRecording;

  useEffect(() => {
    if (isOpen && !pos) setPos({ left: Math.max(16, window.innerWidth - PANEL_WIDTH - 24), top: Math.max(16, Math.round(window.innerHeight * 0.12)) });
  }, [isOpen, pos]);

  const onMove = useCallback((e: MouseEvent) => {
    if (!drag.current) return;
    const w = widthRef.current;
    setPos({ left: Math.min(Math.max(8, e.clientX - drag.current.dx), window.innerWidth - w - 8), top: Math.min(Math.max(8, e.clientY - drag.current.dy), window.innerHeight - 80) });
  }, []);
  const onUp = useCallback(() => { drag.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); }, [onMove]);
  const onDown = useCallback((e: React.MouseEvent) => {
    if (!pos) return;
    drag.current = { dx: e.clientX - pos.left, dy: e.clientY - pos.top };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  }, [pos, onMove, onUp]);
  useEffect(() => () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); }, [onMove, onUp]);

  function resetForm() { setSubject(""); setBodyHtml(""); setPlainBody(""); setResult(null); setUploadProgress(null); setComposerKey((k) => k + 1); setTopic(null); recorder.reset(); }
  function handleClose() { resetForm(); setMode("write"); close(); }
  function switchMode(next: Mode) {
    if (recorder.status === "recording") return;
    if (next === "write") recorder.reset();
    setResult(null); setMode(next);
  }

  const autoContext = (): FeedbackContextMeta => ({
    pageUrl: window.location.href, pageTitle: document.title, userAgent: navigator.userAgent, viewport: `${window.innerWidth}x${window.innerHeight}`,
  });

  function currentBodyHtml(): string {
    if (enableRichText) return bodyHtml;
    const t = plainBody.trim();
    return t ? `<p>${t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br/>")}</p>` : "";
  }

  async function handleSubmitText() {
    if (!subject.trim() || submitting) return;
    setSubmitting(true); setResult(null);
    try {
      const res = await transport.submitText({ type, subject: subject.trim(), bodyHtml: currentBodyHtml(), topic: topic?.value, topicLabel: topic?.label, ...autoContext() });
      setResult(res);
      if (res.ok) { setSubject(""); setBodyHtml(""); setPlainBody(""); setComposerKey((k) => k + 1); }
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message });
    } finally { setSubmitting(false); }
  }

  async function handleSubmitVideo() {
    if (!subject.trim() || !recorder.blob || submitting) return;
    setSubmitting(true); setResult(null); setUploadProgress(0);
    try {
      const target = await transport.createVideoTarget(recorder.blob.size, subject.trim());
      await uploadToVimeoTus(target.uploadLink, recorder.blob, (f) => setUploadProgress(f));
      const res = await transport.submitVideo({ type, subject: subject.trim(), videoId: target.videoId, videoUri: target.videoUri, topic: topic?.value, topicLabel: topic?.label, ...autoContext() });
      setResult(res);
      if (res.ok) { recorder.reset(); setSubject(""); }
    } catch (err) {
      setResult({ ok: false, error: `Video feedback failed: ${(err as Error).message}` });
    } finally { setSubmitting(false); setUploadProgress(null); }
  }

  if (!mounted || !isOpen || !pos || !shadowEl) return null;

  if (isPill) {
    widthRef.current = PILL_WIDTH;
    return createPortal(
      <div className="mvui-fb-pill" style={{ top: pos.top, left: pos.left, width: PILL_WIDTH, zIndex: z }}>
        <span className="mvui-fb-pill-grip" onMouseDown={onDown} title="Drag">⠿</span>
        <span className="mvui-fb-pill-time"><span className="mvui-fb-pill-dot" />{mmss(recorder.elapsedSec)}</span>
        <span className="mvui-fb-pill-label">recording…</span>
        <button type="button" className="mvui-fb-pill-stop" onClick={recorder.stop}>Stop</button>
      </div>,
      shadowEl,
    );
  }

  const panelWidth = Math.min(PANEL_WIDTH, window.innerWidth - 32);
  widthRef.current = panelWidth;
  const sendDisabled = submitting || !subject.trim() || (mode === "video" && recorder.status !== "recorded");

  return createPortal(
    <div className="mvui-fb-panel" role="dialog" aria-label="Send feedback" style={{ top: pos.top, left: pos.left, width: panelWidth, zIndex: z }}>
      <div className="mvui-fb-bar" onMouseDown={onDown}>
        <span className="mvui-fb-bar-title">Send feedback</span>
        <button type="button" className="mvui-fb-x" aria-label="Close" onClick={handleClose}>×</button>
      </div>
      <div className="mvui-fb-body">
        {result?.ok ? (
          <div className="mvui-fb-ok">
            <p>Thanks — your feedback was filed.</p>
            {result.url && <a href={result.url} target="_blank" rel="noreferrer">View the Teamwork task →</a>}
            <div className="mvui-fb-actions">
              <button type="button" className="mvui-fb-send" onClick={() => setResult(null)}>Send another</button>
              <button type="button" className="mvui-fb-cancel" onClick={handleClose}>Done</button>
            </div>
          </div>
        ) : needsTopic && !topic ? (
          <div className="mvui-fb-topic-step">
            <p className="mvui-fb-topic-prompt">{topicPrompt}</p>
            <div className="mvui-fb-topics">
              {topics!.map((t) => (
                <button key={t.value} type="button" className="mvui-fb-topic-choice" onClick={() => setTopic(t)}>{t.label}</button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {topic && (
              <div className="mvui-fb-topic-crumb">
                <span><strong>Area:</strong> {topic.label}</span>
                <button type="button" className="mvui-fb-link" onClick={() => setTopic(null)}>change</button>
              </div>
            )}
            <div className="mvui-fb-types">
              {FEEDBACK_TYPES.map((t) => (
                <button key={t.value} type="button" className="mvui-fb-type" data-active={type === t.value} onClick={() => setType(t.value)}>{t.label}</button>
              ))}
            </div>

            {enableVideo && (
              <div className="mvui-fb-modes">
                {(["write", "video"] as Mode[]).map((m) => (
                  <button key={m} type="button" className="mvui-fb-mode" data-active={mode === m} onClick={() => switchMode(m)}>{m === "write" ? "Write" : "Record video"}</button>
                ))}
              </div>
            )}

            <input className="mvui-fb-input" type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="One-line summary" />

            {mode === "write" ? (
              enableRichText ? (
                <Suspense fallback={<p className="mvui-fb-hint">Loading editor…</p>}>
                  <FeedbackComposer key={composerKey} uploadImage={transport.uploadImage} onChange={(html) => setBodyHtml(html)} />
                </Suspense>
              ) : (
                <textarea className="mvui-fb-textarea" value={plainBody} onChange={(e) => setPlainBody(e.target.value)} placeholder="What happened? What did you expect?" />
              )
            ) : (
              <VideoPane recorder={recorder} uploadProgress={uploadProgress} submitting={submitting} />
            )}

            {result && !result.ok && <p className="mvui-fb-err">{result.error}</p>}

            <div className="mvui-fb-actions">
              <button type="button" className="mvui-fb-cancel" onClick={handleClose}>Cancel</button>
              <button type="button" className="mvui-fb-send" disabled={sendDisabled} onClick={mode === "write" ? handleSubmitText : handleSubmitVideo}>
                {submitting ? (uploadProgress !== null ? `Uploading… ${Math.round(uploadProgress * 100)}%` : "Sending…") : "Send feedback"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    shadowEl,
  );
}

function VideoPane({ recorder, uploadProgress, submitting }: { recorder: ReturnType<typeof useScreenRecorder>; uploadProgress: number | null; submitting: boolean; }) {
  // Shown only when collapseWhileRecording=false (otherwise the panel is a pill while recording).
  if (recorder.status === "recording") {
    return (
      <div className="mvui-fb-video-recording">
        <span className="mvui-fb-pill-time"><span className="mvui-fb-pill-dot" />{mmss(recorder.elapsedSec)}</span>
        <span className="mvui-fb-hint">Recording… drive the app, then click Stop.</span>
        <button type="button" className="mvui-fb-pill-stop" onClick={recorder.stop}>Stop</button>
      </div>
    );
  }
  if (recorder.status === "recorded" && recorder.previewUrl) {
    return (
      <div className="mvui-fb-video-preview">
        <video src={recorder.previewUrl} controls className="mvui-fb-video" />
        <div className="mvui-fb-video-row">
          <button type="button" className="mvui-fb-link" onClick={recorder.reset} disabled={submitting}>↺ Re-record</button>
          {uploadProgress !== null && <span className="mvui-fb-hint">Uploading to Vimeo… {Math.round(uploadProgress * 100)}%</span>}
        </div>
      </div>
    );
  }
  return (
    <div className="mvui-fb-video-idle">
      <button type="button" className="mvui-fb-send" onClick={recorder.start}>⏺ Start recording</button>
      <p className="mvui-fb-hint">Captures a tab/window + your mic. The widget shrinks to a small pill while recording; click Stop when done.</p>
      {recorder.error && <p className="mvui-fb-err">{recorder.error}</p>}
    </div>
  );
}
