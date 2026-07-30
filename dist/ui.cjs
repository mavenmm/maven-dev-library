"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/ui/feedback/feedback-composer.tsx
var feedback_composer_exports = {};
__export(feedback_composer_exports, {
  FeedbackComposer: () => FeedbackComposer,
  default: () => feedback_composer_default
});
function FeedbackComposer({ uploadImage, onChange, placeholder }) {
  const fileInputRef = (0, import_react5.useRef)(null);
  const editorRef = (0, import_react5.useRef)(null);
  const [uploading, setUploading] = (0, import_react5.useState)(0);
  const [uploadError, setUploadError] = (0, import_react5.useState)(null);
  const insertImageFile = (0, import_react5.useCallback)(async (file) => {
    const editor2 = editorRef.current;
    if (!editor2) return;
    setUploadError(null);
    setUploading((n) => n + 1);
    try {
      const { url } = await uploadImage(file);
      editor2.chain().focus().setImage({ src: url }).run();
    } catch (err) {
      setUploadError(`Couldn't add screenshot: ${err.message || "upload failed"}`);
    } finally {
      setUploading((n) => Math.max(0, n - 1));
    }
  }, [uploadImage]);
  const uploadImageItems = (0, import_react5.useCallback)((items) => {
    if (!items) return false;
    let found = false;
    for (const item of Array.from(items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          found = true;
          void insertImageFile(file);
        }
      }
    }
    return found;
  }, [insertImageFile]);
  const uploadImageFiles = (0, import_react5.useCallback)((files) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    images.forEach((f) => void insertImageFile(f));
    return images.length > 0;
  }, [insertImageFile]);
  const editor = (0, import_react4.useEditor)({
    immediatelyRender: false,
    extensions: [
      import_starter_kit.default,
      import_extension_image.default,
      import_extension_placeholder.default.configure({ placeholder: placeholder ?? "Describe it \u2014 paste screenshots inline." })
    ],
    content: "",
    editorProps: {
      attributes: { class: "mvui-fb-prose" },
      handlePaste: (_view, event) => {
        if (uploadImageItems(event.clipboardData?.items)) return true;
        const files = event.clipboardData?.files;
        if (files && files.length && uploadImageFiles(Array.from(files))) return true;
        return false;
      },
      handleDrop: (_view, event) => {
        const dt = event.dataTransfer;
        if (!dt?.files?.length) return false;
        const handled = uploadImageFiles(Array.from(dt.files));
        if (handled) event.preventDefault();
        return handled;
      }
    },
    onUpdate: ({ editor: editor2 }) => onChange(editor2.getHTML(), editor2.isEmpty)
  });
  (0, import_react5.useEffect)(() => {
    editorRef.current = editor;
  }, [editor]);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "mvui-fb-composer", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_react4.EditorContent, { editor }) }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "mvui-fb-composer-tools", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "mvui-fb-link", onClick: () => fileInputRef.current?.click(), children: "+ Add screenshot" }),
      uploading > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "mvui-fb-hint", children: "Uploading screenshot\u2026" }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "mvui-fb-hint", children: "or paste an image" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "input",
        {
          ref: fileInputRef,
          type: "file",
          accept: "image/*",
          multiple: true,
          style: { display: "none" },
          onChange: (e) => {
            if (e.target.files) uploadImageFiles(Array.from(e.target.files));
            e.target.value = "";
          }
        }
      )
    ] }),
    uploadError && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "mvui-fb-err", children: uploadError })
  ] });
}
var import_react4, import_starter_kit, import_extension_image, import_extension_placeholder, import_react5, import_jsx_runtime3, feedback_composer_default;
var init_feedback_composer = __esm({
  "src/ui/feedback/feedback-composer.tsx"() {
    "use strict";
    import_react4 = require("@tiptap/react");
    import_starter_kit = __toESM(require("@tiptap/starter-kit"), 1);
    import_extension_image = __toESM(require("@tiptap/extension-image"), 1);
    import_extension_placeholder = __toESM(require("@tiptap/extension-placeholder"), 1);
    import_react5 = require("react");
    import_jsx_runtime3 = require("react/jsx-runtime");
    feedback_composer_default = FeedbackComposer;
  }
});

// src/ui/index.ts
var ui_exports = {};
__export(ui_exports, {
  FEEDBACK_TYPES: () => FEEDBACK_TYPES,
  FeedbackLauncher: () => FeedbackLauncher,
  FeedbackProvider: () => FeedbackProvider,
  FeedbackWidget: () => FeedbackWidget,
  UI_VERSION: () => UI_VERSION,
  useFeedback: () => useFeedback
});
module.exports = __toCommonJS(ui_exports);

// src/ui/feedback/feedback-context.tsx
var import_react2 = require("react");

// src/ui/feedback/feedback-config.ts
var import_react = require("react");
var FEEDBACK_TYPES = [
  { value: "bug", label: "Bug" },
  { value: "feature", label: "Feature request" },
  { value: "working_well", label: "What's working well" },
  { value: "other", label: "Other" }
];
var FeedbackCtx = (0, import_react.createContext)(null);
function useFeedback() {
  const ctx = (0, import_react.useContext)(FeedbackCtx);
  if (!ctx) throw new Error("useFeedback must be used within a FeedbackProvider");
  return ctx;
}

// src/ui/feedback/feedback-context.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function FeedbackProvider({ config, children }) {
  const [isOpen, setIsOpen] = (0, import_react2.useState)(false);
  const open = (0, import_react2.useCallback)(() => setIsOpen(true), []);
  const close = (0, import_react2.useCallback)(() => setIsOpen(false), []);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FeedbackCtx.Provider, { value: { isOpen, open, close, config }, children });
}

// src/ui/feedback/feedback-launcher.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function FeedbackLauncher({ className, variant = "default" }) {
  const { open } = useFeedback();
  const base = variant === "inverted" ? "mvui-fb-launcher mvui-fb-launcher--inverted" : "mvui-fb-launcher";
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", onClick: open, className: className ?? base, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("svg", { viewBox: "0 0 20 20", fill: "none", className: "mvui-fb-launcher-icon", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("path", { d: "M4 4h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8l-4 3v-3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z", stroke: "currentColor", strokeWidth: "1.5", strokeLinejoin: "round" }) }),
    "Feedback"
  ] });
}

// src/ui/feedback/feedback-widget.tsx
var import_react6 = require("react");
var import_react_dom = require("react-dom");

// src/ui/feedback/use-screen-recorder.ts
var import_react3 = require("react");
function pickMimeType() {
  const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "video/webm";
}
function useScreenRecorder() {
  const [status, setStatus] = (0, import_react3.useState)("idle");
  const [error, setError] = (0, import_react3.useState)(null);
  const [blob, setBlob] = (0, import_react3.useState)(null);
  const [previewUrl, setPreviewUrl] = (0, import_react3.useState)(null);
  const [elapsedSec, setElapsedSec] = (0, import_react3.useState)(0);
  const recorderRef = (0, import_react3.useRef)(null);
  const chunksRef = (0, import_react3.useRef)([]);
  const streamsRef = (0, import_react3.useRef)([]);
  const timerRef = (0, import_react3.useRef)(null);
  const previewUrlRef = (0, import_react3.useRef)(null);
  const cleanupStreams = (0, import_react3.useCallback)(() => {
    streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streamsRef.current = [];
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  const start = (0, import_react3.useCallback)(async () => {
    setError(null);
    try {
      const display = await navigator.mediaDevices.getDisplayMedia(
        { video: true, audio: true, selfBrowserSurface: "include" }
      );
      let mic = null;
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
      }
      streamsRef.current = mic ? [display, mic] : [display];
      const tracks = [...display.getVideoTracks()];
      if (mic) tracks.push(...mic.getAudioTracks());
      else tracks.push(...display.getAudioTracks());
      const combined = new MediaStream(tracks);
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
  const stop = (0, import_react3.useCallback)(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
  }, []);
  const reset = (0, import_react3.useCallback)(() => {
    cleanupStreams();
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    chunksRef.current = [];
    setBlob(null);
    setPreviewUrl(null);
    setElapsedSec(0);
    setError(null);
    setStatus("idle");
  }, [cleanupStreams]);
  (0, import_react3.useEffect)(() => () => {
    cleanupStreams();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, [cleanupStreams]);
  return { status, error, blob, previewUrl, elapsedSec, start, stop, reset };
}

// src/ui/feedback/upload-video.ts
var import_tus_js_client = require("tus-js-client");
function uploadToVimeoTus(uploadLink, file, onProgress) {
  return new Promise((resolve, reject) => {
    const upload = new import_tus_js_client.Upload(file, {
      uploadUrl: uploadLink,
      retryDelays: [0, 1e3, 3e3, 5e3, 1e4],
      metadata: { filename: "feedback-recording.webm", filetype: "video/webm" },
      onError: (err) => reject(err),
      onProgress: (sent, total) => {
        if (onProgress && total > 0) onProgress(sent / total);
      },
      onSuccess: () => resolve()
    });
    upload.start();
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
`;

// src/ui/feedback/feedback-widget.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
var FeedbackComposer2 = (0, import_react6.lazy)(() => Promise.resolve().then(() => (init_feedback_composer(), feedback_composer_exports)));
var PANEL_WIDTH = 1020;
var PILL_WIDTH = 260;
function mmss(total) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
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
  const [mounted, setMounted] = (0, import_react6.useState)(false);
  const [shadowEl, setShadowEl] = (0, import_react6.useState)(null);
  const [mode, setMode] = (0, import_react6.useState)(defaultMode);
  const [type, setType] = (0, import_react6.useState)("bug");
  const [subject, setSubject] = (0, import_react6.useState)("");
  const [bodyHtml, setBodyHtml] = (0, import_react6.useState)("");
  const [plainBody, setPlainBody] = (0, import_react6.useState)("");
  const [submitting, setSubmitting] = (0, import_react6.useState)(false);
  const [uploadProgress, setUploadProgress] = (0, import_react6.useState)(null);
  const [result, setResult] = (0, import_react6.useState)(null);
  const [composerKey, setComposerKey] = (0, import_react6.useState)(0);
  const [topic, setTopic] = (0, import_react6.useState)(null);
  const recorder = useScreenRecorder();
  const [pos, setPos] = (0, import_react6.useState)(null);
  const drag = (0, import_react6.useRef)(null);
  const widthRef = (0, import_react6.useRef)(PANEL_WIDTH);
  (0, import_react6.useEffect)(() => {
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
  (0, import_react6.useEffect)(() => {
    if (isOpen && !pos) setPos({ left: Math.max(16, window.innerWidth - PANEL_WIDTH - 24), top: Math.max(16, Math.round(window.innerHeight * 0.12)) });
  }, [isOpen, pos]);
  const onMove = (0, import_react6.useCallback)((e) => {
    if (!drag.current) return;
    const w = widthRef.current;
    setPos({ left: Math.min(Math.max(8, e.clientX - drag.current.dx), window.innerWidth - w - 8), top: Math.min(Math.max(8, e.clientY - drag.current.dy), window.innerHeight - 80) });
  }, []);
  const onUp = (0, import_react6.useCallback)(() => {
    drag.current = null;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  }, [onMove]);
  const onDown = (0, import_react6.useCallback)((e) => {
    if (!pos) return;
    drag.current = { dx: e.clientX - pos.left, dy: e.clientY - pos.top };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [pos, onMove, onUp]);
  (0, import_react6.useEffect)(() => () => {
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
      setResult({ ok: false, error: err.message });
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
      const res = await transport.submitVideo({ type, subject: subject.trim(), videoId: target.videoId, videoUri: target.videoUri, topic: topic?.value, topicLabel: topic?.label, ...autoContext() });
      setResult(res);
      if (res.ok) {
        recorder.reset();
        setSubject("");
      }
    } catch (err) {
      setResult({ ok: false, error: `Video feedback failed: ${err.message}` });
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  }
  if (!mounted || !isOpen || !pos || !shadowEl) return null;
  if (isPill) {
    widthRef.current = PILL_WIDTH;
    return (0, import_react_dom.createPortal)(
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "mvui-fb-pill", style: { top: pos.top, left: pos.left, width: PILL_WIDTH, zIndex: z }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "mvui-fb-pill-grip", onMouseDown: onDown, title: "Drag", children: "\u283F" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "mvui-fb-pill-time", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "mvui-fb-pill-dot" }),
          mmss(recorder.elapsedSec)
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "mvui-fb-pill-label", children: "recording\u2026" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "mvui-fb-pill-stop", onClick: recorder.stop, children: "Stop" })
      ] }),
      shadowEl
    );
  }
  const panelWidth = Math.min(PANEL_WIDTH, window.innerWidth - 32);
  widthRef.current = panelWidth;
  const sendDisabled = submitting || !subject.trim() || mode === "video" && recorder.status !== "recorded";
  return (0, import_react_dom.createPortal)(
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "mvui-fb-panel", role: "dialog", "aria-label": "Send feedback", style: { top: pos.top, left: pos.left, width: panelWidth, zIndex: z }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "mvui-fb-bar", onMouseDown: onDown, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "mvui-fb-bar-title", children: "Send feedback" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "mvui-fb-x", "aria-label": "Close", onClick: handleClose, children: "\xD7" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "mvui-fb-body", children: result?.ok ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "mvui-fb-ok", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: "Thanks \u2014 your feedback was filed." }),
        result.url && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("a", { href: result.url, target: "_blank", rel: "noreferrer", children: "View the Teamwork task \u2192" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "mvui-fb-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "mvui-fb-send", onClick: () => setResult(null), children: "Send another" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "mvui-fb-cancel", onClick: handleClose, children: "Done" })
        ] })
      ] }) : needsTopic && !topic ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "mvui-fb-topic-step", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "mvui-fb-topic-prompt", children: topicPrompt }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "mvui-fb-topics", children: topics.map((t) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "mvui-fb-topic-choice", onClick: () => setTopic(t), children: t.label }, t.value)) })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
        topic && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "mvui-fb-topic-crumb", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: "Area:" }),
            " ",
            topic.label
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "mvui-fb-link", onClick: () => setTopic(null), children: "change" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "mvui-fb-types", children: FEEDBACK_TYPES.map((t) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "mvui-fb-type", "data-active": type === t.value, onClick: () => setType(t.value), children: t.label }, t.value)) }),
        enableVideo && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "mvui-fb-modes", children: ["write", "video"].map((m) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "mvui-fb-mode", "data-active": mode === m, onClick: () => switchMode(m), children: m === "write" ? "Write" : "Record video" }, m)) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { className: "mvui-fb-input", type: "text", value: subject, onChange: (e) => setSubject(e.target.value), placeholder: "One-line summary" }),
        mode === "write" ? enableRichText ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_react6.Suspense, { fallback: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "mvui-fb-hint", children: "Loading editor\u2026" }), children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(FeedbackComposer2, { uploadImage: transport.uploadImage, onChange: (html) => setBodyHtml(html) }, composerKey) }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("textarea", { className: "mvui-fb-textarea", value: plainBody, onChange: (e) => setPlainBody(e.target.value), placeholder: "What happened? What did you expect?" }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(VideoPane, { recorder, uploadProgress, submitting }),
        result && !result.ok && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "mvui-fb-err", children: result.error }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "mvui-fb-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "mvui-fb-cancel", onClick: handleClose, children: "Cancel" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "mvui-fb-send", disabled: sendDisabled, onClick: mode === "write" ? handleSubmitText : handleSubmitVideo, children: submitting ? uploadProgress !== null ? `Uploading\u2026 ${Math.round(uploadProgress * 100)}%` : "Sending\u2026" : "Send feedback" })
        ] })
      ] }) })
    ] }),
    shadowEl
  );
}
function VideoPane({ recorder, uploadProgress, submitting }) {
  if (recorder.status === "recording") {
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "mvui-fb-video-recording", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "mvui-fb-pill-time", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "mvui-fb-pill-dot" }),
        mmss(recorder.elapsedSec)
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "mvui-fb-hint", children: "Recording\u2026 drive the app, then click Stop." }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "mvui-fb-pill-stop", onClick: recorder.stop, children: "Stop" })
    ] });
  }
  if (recorder.status === "recorded" && recorder.previewUrl) {
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "mvui-fb-video-preview", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("video", { src: recorder.previewUrl, controls: true, className: "mvui-fb-video" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "mvui-fb-video-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "mvui-fb-link", onClick: recorder.reset, disabled: submitting, children: "\u21BA Re-record" }),
        uploadProgress !== null && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "mvui-fb-hint", children: [
          "Uploading to Vimeo\u2026 ",
          Math.round(uploadProgress * 100),
          "%"
        ] })
      ] })
    ] });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "mvui-fb-video-idle", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "mvui-fb-send", onClick: recorder.start, children: "\u23FA Start recording" }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "mvui-fb-hint", children: "Captures a tab/window + your mic. The widget shrinks to a small pill while recording; click Stop when done." }),
    recorder.error && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "mvui-fb-err", children: recorder.error })
  ] });
}

// src/ui/index.ts
var UI_VERSION = "0.1.0";
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  FEEDBACK_TYPES,
  FeedbackLauncher,
  FeedbackProvider,
  FeedbackWidget,
  UI_VERSION,
  useFeedback
});
