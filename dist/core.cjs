"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/core/index.ts
var core_exports = {};
__export(core_exports, {
  CORE_VERSION: () => CORE_VERSION,
  FEEDBACK_TYPES: () => FEEDBACK_TYPES,
  addHtmlComment: () => addHtmlComment,
  buildContextHtml: () => buildContextHtml,
  buildTitle: () => buildTitle,
  createFeedbackTaskInTeamwork: () => createFeedbackTaskInTeamwork,
  createTextFeedback: () => createTextFeedback,
  createVideoTarget: () => createVideoTarget,
  createVimeoUpload: () => createVimeoUpload,
  easternDatePrefix: () => easternDatePrefix,
  escapeHtml: () => escapeHtml,
  fetchTranscript: () => fetchTranscript,
  moveTaskToStage: () => moveTaskToStage,
  moveVideoToFolder: () => moveVideoToFolder,
  setSoleFollower: () => setSoleFollower,
  submitVideoFeedback: () => submitVideoFeedback,
  summarizePendingVideo: () => summarizePendingVideo,
  summarizeTranscript: () => summarizeTranscript,
  teamworkTaskUrl: () => teamworkTaskUrl,
  titlePrefixFor: () => titlePrefixFor,
  vimeoWatchUrl: () => vimeoWatchUrl,
  vttToText: () => vttToText
});
module.exports = __toCommonJS(core_exports);

// src/core/types.ts
var FEEDBACK_TYPES = [
  { value: "bug", label: "Bug", titlePrefix: "Bug" },
  { value: "feature", label: "Feature request", titlePrefix: "Feature request" },
  { value: "working_well", label: "What's working well", titlePrefix: "What's working well" },
  { value: "other", label: "Other", titlePrefix: "Other" }
];

// src/core/compose.ts
function titlePrefixFor(type) {
  return FEEDBACK_TYPES.find((t) => t.value === type)?.titlePrefix ?? "Other";
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function easternDatePrefix(now = /* @__PURE__ */ new Date()) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", month: "short", day: "numeric" }).format(now);
}
function buildTitle(type, subject, now = /* @__PURE__ */ new Date()) {
  return `(${easternDatePrefix(now)}) [${titlePrefixFor(type)}] ${subject}`;
}
function buildContextHtml(submitter, ctx) {
  const who = submitter.name ? escapeHtml(submitter.name) : submitter.userId ? `user #${escapeHtml(submitter.userId)}` : "Unknown user";
  const email = submitter.email ? ` (${escapeHtml(submitter.email)})` : "";
  const pageLabel = ctx.pageTitle?.trim() || ctx.pageUrl;
  const lines = [
    `<strong>Submitted by:</strong> ${who}${email}`,
    `<strong>App:</strong> ${escapeHtml(ctx.appName)}`
  ];
  if (ctx.topicLabel?.trim()) lines.push(`<strong>Area:</strong> ${escapeHtml(ctx.topicLabel.trim())}`);
  if (ctx.pageUrl) lines.push(`<strong>Page:</strong> <a href="${escapeHtml(ctx.pageUrl)}">${escapeHtml(pageLabel)}</a>`);
  const browser = [ctx.userAgent, ctx.viewport].filter(Boolean).map((b) => escapeHtml(b));
  if (browser.length) lines.push(`<strong>Browser:</strong> ${browser.join(" \xB7 ")}`);
  return `<hr/><p>${lines.join("<br/>")}</p>`;
}

// src/core/teamwork.ts
function authHeaders(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}
function teamworkTaskUrl(cfg, taskId) {
  return `${cfg.baseUrl}/app/tasks/${taskId}`;
}
async function createFeedbackTaskInTeamwork(cfg, token, title) {
  const res = await fetch(`${cfg.baseUrl}/tasklists/${cfg.tasklistId}/tasks.json`, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ "todo-item": { content: title, "responsible-party-id": cfg.assigneeId, notify: false } })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Teamwork task create failed: HTTP ${res.status} \u2014 ${text.slice(0, 300)}`);
  let taskId = "";
  try {
    const j = JSON.parse(text);
    taskId = String(j.id ?? j.taskId ?? "");
  } catch {
  }
  if (!taskId) throw new Error(`Teamwork task create returned no id \u2014 ${text.slice(0, 300)}`);
  return taskId;
}
async function addHtmlComment(cfg, token, taskId, html) {
  const res = await fetch(`${cfg.baseUrl}/tasks/${taskId}/comments.json`, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ comment: { body: html, "content-type": "HTML", notify: false } })
  });
  if (!res.ok) throw new Error(`Teamwork comment failed: HTTP ${res.status} \u2014 ${(await res.text()).slice(0, 300)}`);
}
async function moveTaskToStage(cfg, token, taskId) {
  try {
    const res = await fetch(`${cfg.baseUrl}/projects/api/v3/workflows/${cfg.workflowId}/stages/${cfg.stageId}/tasks.json`, {
      method: "POST",
      headers: authHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ taskIds: [Number(taskId)] })
    });
    return res.ok;
  } catch {
    return false;
  }
}
async function setSoleFollower(cfg, token, taskId, followerId) {
  try {
    const res = await fetch(`${cfg.baseUrl}/projects/api/v3/tasks/${taskId}.json`, {
      method: "PATCH",
      headers: authHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ task: { changeFollowers: { userIds: [Number(followerId)] }, commentFollowers: { userIds: [Number(followerId)] } } })
    });
    return res.ok;
  } catch {
    return false;
  }
}

// src/core/create-text-feedback.ts
async function createTextFeedback(cfg, secrets, input, submitter) {
  const subject = (input.subject ?? "").trim();
  if (!subject) return { ok: false, error: "Please add a one-line subject." };
  const tw = cfg.teamwork;
  const token = secrets.teamworkToken;
  const title = buildTitle(input.type, subject);
  const body = (input.bodyHtml ?? "").trim() || "<p><em>(No description provided.)</em></p>";
  const commentHtml = body + buildContextHtml(submitter, {
    appName: cfg.appName,
    pageUrl: input.pageUrl,
    pageTitle: input.pageTitle,
    userAgent: input.userAgent,
    viewport: input.viewport,
    topicLabel: input.topicLabel
  });
  try {
    const taskId = await createFeedbackTaskInTeamwork(tw, token, title);
    await addHtmlComment(tw, token, taskId, commentHtml);
    await moveTaskToStage(tw, token, taskId);
    if (tw.soleFollowerId) await setSoleFollower(tw, token, taskId, tw.soleFollowerId);
    return { ok: true, taskId, url: teamworkTaskUrl(tw, taskId) };
  } catch (err) {
    return { ok: false, error: err.message || "Something went wrong filing your feedback." };
  }
}

// src/core/vimeo.ts
var VIMEO_API = "https://api.vimeo.com";
function vheaders(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, Accept: "application/vnd.vimeo.*+json;version=3.4", ...extra };
}
function vimeoWatchUrl(videoId) {
  return `https://vimeo.com/${videoId}`;
}
async function createVimeoUpload(token, name, sizeBytes) {
  const res = await fetch(`${VIMEO_API}/me/videos`, {
    method: "POST",
    headers: vheaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ upload: { approach: "tus", size: sizeBytes }, name: name.slice(0, 128), privacy: { view: "unlisted" } })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Vimeo create-upload failed: HTTP ${res.status} \u2014 ${text.slice(0, 300)}`);
  const j = JSON.parse(text);
  const uploadLink = j.upload?.upload_link ?? "";
  const videoUri = j.uri ?? "";
  const videoId = videoUri.split("/").pop() ?? "";
  if (!uploadLink || !videoId) throw new Error("Vimeo create-upload returned no upload link or id.");
  return { videoId, videoUri, uploadLink };
}
async function moveVideoToFolder(token, videoId, folderId) {
  if (!folderId) return false;
  try {
    const res = await fetch(`${VIMEO_API}/me/projects/${folderId}/videos/${videoId}`, { method: "PUT", headers: vheaders(token) });
    return res.ok;
  } catch {
    return false;
  }
}
function vttToText(vtt) {
  const out = [];
  let last = "";
  for (const raw of vtt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line === "WEBVTT" || line.includes("-->")) continue;
    if (/^\d+$/.test(line) || /^NOTE\b/.test(line)) continue;
    const t = line.replace(/<[^>]+>/g, "").trim();
    if (!t || t === last) continue;
    out.push(t);
    last = t;
  }
  return out.join(" ").trim();
}
async function fetchTranscript(token, videoId) {
  const res = await fetch(`${VIMEO_API}/videos/${videoId}/texttracks`, { headers: vheaders(token) });
  if (!res.ok) return null;
  const data = await res.json();
  const track = (data.data ?? []).find((t) => t.link);
  if (!track?.link) return null;
  const vttRes = await fetch(track.link);
  if (!vttRes.ok) return null;
  const text = vttToText(await vttRes.text());
  return text || null;
}

// src/core/summary.ts
var ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
function prompt(transcript) {
  return [
    "Summarize this screen-recording feedback transcript for a developer's task.",
    "Return concise HTML using <p>, <strong>, <ul>, <li> only (no <html>/<body>).",
    "Lead with a one-line summary, then bullet the concrete issues/requests.",
    "",
    "Transcript:",
    transcript.slice(0, 2e4)
  ].join("\n");
}
async function summarizeTranscript(anthropicKey, model, maxTokens, transcript) {
  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt(transcript) }] })
  });
  if (!res.ok) throw new Error(`Anthropic summarize failed: HTTP ${res.status} \u2014 ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const text = j.content?.map((c) => c.text ?? "").join("").trim();
  if (!text) throw new Error("Anthropic returned no summary text.");
  return text;
}

// src/core/create-video-feedback.ts
var DEFAULT_MODEL = "claude-sonnet-4-6";
var DEFAULT_MAX_TOKENS = 700;
async function createVideoTarget(_cfg, secrets, sizeBytes, subject) {
  if (!secrets.vimeoToken) throw new Error("Vimeo is not configured for this app.");
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new Error("Recording looks empty \u2014 try again.");
  const name = `Feedback: ${(subject || "").trim() || "screen recording"}`;
  return createVimeoUpload(secrets.vimeoToken, name, Math.round(sizeBytes));
}
async function submitVideoFeedback(cfg, secrets, input, submitter) {
  const subject = (input.subject ?? "").trim();
  if (!subject) return { result: { ok: false, error: "Please add a one-line subject." } };
  if (!input.videoId) return { result: { ok: false, error: "Missing video reference." } };
  const tw = cfg.teamwork;
  const token = secrets.teamworkToken;
  const watch = vimeoWatchUrl(input.videoId);
  const commentHtml = `<p>\u{1F3A5} <strong>Screen recording:</strong> <a href="${escapeHtml(watch)}">${escapeHtml(watch)}</a></p><p>\u{1F916} <em>AI summary pending \u2014 added automatically once the transcript is ready.</em></p>` + buildContextHtml(submitter, { appName: cfg.appName, pageUrl: input.pageUrl, pageTitle: input.pageTitle, userAgent: input.userAgent, viewport: input.viewport, topicLabel: input.topicLabel });
  try {
    const taskId = await createFeedbackTaskInTeamwork(tw, token, buildTitle(input.type, subject));
    await addHtmlComment(tw, token, taskId, commentHtml);
    await moveTaskToStage(tw, token, taskId);
    if (tw.soleFollowerId) await setSoleFollower(tw, token, taskId, tw.soleFollowerId);
    if (secrets.vimeoToken && cfg.vimeo?.folderId) await moveVideoToFolder(secrets.vimeoToken, input.videoId, cfg.vimeo.folderId);
    const pending = { taskId, videoId: input.videoId, videoUri: input.videoUri };
    return { result: { ok: true, taskId, url: teamworkTaskUrl(tw, taskId) }, pending };
  } catch (err) {
    return { result: { ok: false, error: err.message || "Something went wrong filing your video feedback." } };
  }
}
async function summarizePendingVideo(cfg, secrets, pending) {
  if (!secrets.vimeoToken || !secrets.anthropicKey) return { status: "failed", error: "Vimeo/Anthropic not configured." };
  try {
    const transcript = await fetchTranscript(secrets.vimeoToken, pending.videoId);
    if (!transcript) return { status: "retry" };
    const summary = await summarizeTranscript(secrets.anthropicKey, cfg.summary?.model ?? DEFAULT_MODEL, cfg.summary?.maxTokens ?? DEFAULT_MAX_TOKENS, transcript);
    await addHtmlComment(cfg.teamwork, secrets.teamworkToken, pending.taskId, `<p>\u{1F916} <strong>AI summary</strong></p>${summary}`);
    if (cfg.teamwork.soleFollowerId) await setSoleFollower(cfg.teamwork, secrets.teamworkToken, pending.taskId, cfg.teamwork.soleFollowerId);
    return { status: "summarized" };
  } catch (err) {
    return { status: "failed", error: err.message };
  }
}

// src/core/index.ts
var CORE_VERSION = "0.2.1";
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CORE_VERSION,
  FEEDBACK_TYPES,
  addHtmlComment,
  buildContextHtml,
  buildTitle,
  createFeedbackTaskInTeamwork,
  createTextFeedback,
  createVideoTarget,
  createVimeoUpload,
  easternDatePrefix,
  escapeHtml,
  fetchTranscript,
  moveTaskToStage,
  moveVideoToFolder,
  setSoleFollower,
  submitVideoFeedback,
  summarizePendingVideo,
  summarizeTranscript,
  teamworkTaskUrl,
  titlePrefixFor,
  vimeoWatchUrl,
  vttToText
});
