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
  FeedbackError: () => FeedbackError,
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
  fetchTranscriptResult: () => fetchTranscriptResult,
  isFeedbackError: () => isFeedbackError,
  isPermanentHttpStatus: () => isPermanentHttpStatus,
  messageOf: () => messageOf,
  moveTaskToStage: () => moveTaskToStage,
  moveVideoToFolder: () => moveVideoToFolder,
  pushWarning: () => pushWarning,
  readBodyText: () => readBodyText,
  safeBodyText: () => safeBodyText,
  setSoleFollower: () => setSoleFollower,
  snip: () => snip,
  submitVideoFeedback: () => submitVideoFeedback,
  summarizePendingVideo: () => summarizePendingVideo,
  summarizeTranscript: () => summarizeTranscript,
  teamworkTaskUrl: () => teamworkTaskUrl,
  titlePrefixFor: () => titlePrefixFor,
  vimeoWatchUrl: () => vimeoWatchUrl,
  vttToText: () => vttToText
});
module.exports = __toCommonJS(core_exports);

// src/core/errors.ts
function isPermanentHttpStatus(status) {
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 410 || status === 422;
}
var FeedbackError = class _FeedbackError extends Error {
  constructor(init) {
    super(init.message);
    this.name = "FeedbackError";
    this.step = init.step;
    this.httpStatus = init.httpStatus;
    this.responseBody = init.responseBody;
    this.cause = init.cause;
    this.retryable = init.retryable ?? (init.httpStatus === void 0 ? true : !isPermanentHttpStatus(init.httpStatus));
    Object.setPrototypeOf(this, _FeedbackError.prototype);
  }
  /** Flat, loggable shape — safe to JSON.stringify into a host's logger. */
  toDetail() {
    return {
      step: this.step,
      message: this.message,
      httpStatus: this.httpStatus,
      retryable: this.retryable,
      responseBody: this.responseBody
    };
  }
};
function isFeedbackError(err) {
  return err instanceof FeedbackError;
}
function pushWarning(sink, warning) {
  sink?.push(warning);
}
function messageOf(err) {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}
async function readBodyText(res) {
  try {
    return await res.text();
  } catch {
    return "<unreadable response body>";
  }
}
function snip(text, limit = 300) {
  return text.length > limit ? `${text.slice(0, limit)}\u2026` : text;
}
async function safeBodyText(res, limit = 300) {
  return snip(await readBodyText(res), limit);
}

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
  if (s === null || s === void 0) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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
function stageFields(cfg) {
  const workflowId = Number(cfg.workflowId);
  const stageId = Number(cfg.stageId);
  if (!Number.isFinite(workflowId) || !Number.isFinite(stageId) || workflowId <= 0 || stageId <= 0) return {};
  return { workflowId, stageId };
}
async function createFeedbackTaskInTeamwork(cfg, token, title) {
  let res;
  try {
    res = await fetch(`${cfg.baseUrl}/tasklists/${cfg.tasklistId}/tasks.json`, {
      method: "POST",
      headers: authHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        "todo-item": { content: title, "responsible-party-id": cfg.assigneeId, notify: false, ...stageFields(cfg) }
      })
    });
  } catch (err) {
    throw new FeedbackError({ step: "teamwork.createTask", message: `Teamwork task create could not reach the API: ${messageOf(err)}`, cause: err });
  }
  const text = await readBodyText(res);
  if (!res.ok) {
    throw new FeedbackError({
      step: "teamwork.createTask",
      message: `Teamwork task create failed: HTTP ${res.status} \u2014 ${snip(text)}`,
      httpStatus: res.status,
      responseBody: snip(text)
    });
  }
  let taskId = "";
  try {
    const j = JSON.parse(text);
    taskId = String(j.id ?? j.taskId ?? "");
  } catch (err) {
    throw new FeedbackError({
      step: "teamwork.createTask",
      message: `Teamwork task create returned unparseable JSON \u2014 ${snip(text)}`,
      httpStatus: res.status,
      responseBody: snip(text),
      cause: err,
      // A 200 with a broken body is a contract break, not a blip. Retrying would
      // create a SECOND task, so this must never be retried.
      retryable: false
    });
  }
  if (!taskId) {
    throw new FeedbackError({
      step: "teamwork.createTask",
      message: `Teamwork task create returned no id \u2014 ${snip(text)}`,
      httpStatus: res.status,
      responseBody: snip(text),
      retryable: false
    });
  }
  return taskId;
}
async function addHtmlComment(cfg, token, taskId, html) {
  let res;
  try {
    res = await fetch(`${cfg.baseUrl}/tasks/${taskId}/comments.json`, {
      method: "POST",
      headers: authHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ comment: { body: html, "content-type": "HTML", notify: false } })
    });
  } catch (err) {
    throw new FeedbackError({ step: "teamwork.addComment", message: `Teamwork comment could not reach the API: ${messageOf(err)}`, cause: err });
  }
  if (!res.ok) {
    const body = await safeBodyText(res);
    throw new FeedbackError({
      step: "teamwork.addComment",
      message: `Teamwork comment failed: HTTP ${res.status} \u2014 ${body}`,
      httpStatus: res.status,
      responseBody: body
    });
  }
}
async function readStageId(cfg, token, taskId) {
  try {
    const res = await fetch(`${cfg.baseUrl}/projects/api/v3/tasks/${taskId}.json`, { headers: authHeaders(token) });
    if (!res.ok) return null;
    const j = await res.json();
    if (!j || typeof j.task !== "object" || j.task === null) return null;
    const stages = j.task.workflowStages ?? [];
    return stages.length ? Number(stages[0]?.stageId ?? 0) : 0;
  } catch {
    return null;
  }
}
async function moveTaskToStage(cfg, token, taskId, warnings) {
  const fields = stageFields(cfg);
  if (!("stageId" in fields)) return false;
  try {
    const res = await fetch(`${cfg.baseUrl}/tasks/${taskId}.json`, {
      method: "PUT",
      headers: authHeaders(token, { "Content-Type": "application/json" }),
      // BOTH ids or Teamwork ignores the stage. See stageFields() above.
      body: JSON.stringify({ "todo-item": fields })
    });
    if (!res.ok) {
      pushWarning(warnings, {
        step: "teamwork.moveStage",
        message: `Task ${taskId} was filed but not moved to stage ${cfg.stageId}: HTTP ${res.status} \u2014 ${await safeBodyText(res, 200)}`,
        httpStatus: res.status
      });
      return false;
    }
    const actual = await readStageId(cfg, token, taskId);
    if (actual === null) return true;
    if (actual !== fields.stageId) {
      pushWarning(warnings, {
        step: "teamwork.moveStage",
        message: `Task ${taskId} reported success but is in stage ${actual}, not the configured ${cfg.stageId}. Check that project's workflow includes stage ${cfg.stageId}.`
      });
      return false;
    }
    return true;
  } catch (err) {
    pushWarning(warnings, { step: "teamwork.moveStage", message: `Task ${taskId} was filed but the stage move could not reach the API: ${messageOf(err)}` });
    return false;
  }
}
async function setSoleFollower(cfg, token, taskId, followerId, warnings) {
  try {
    const res = await fetch(`${cfg.baseUrl}/projects/api/v3/tasks/${taskId}.json`, {
      method: "PATCH",
      headers: authHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ task: { changeFollowers: { userIds: [Number(followerId)] }, commentFollowers: { userIds: [Number(followerId)] } } })
    });
    if (!res.ok) {
      pushWarning(warnings, {
        step: "teamwork.setFollower",
        // Worth surfacing: on a shared bot token, a failure here means the whole
        // team gets notified about one person's feedback.
        message: `Task ${taskId} followers were not reset to ${followerId}: HTTP ${res.status} \u2014 ${await safeBodyText(res, 200)}`,
        httpStatus: res.status
      });
    }
    return res.ok;
  } catch (err) {
    pushWarning(warnings, { step: "teamwork.setFollower", message: `Task ${taskId} follower reset could not reach the API: ${messageOf(err)}` });
    return false;
  }
}

// src/core/create-text-feedback.ts
async function createTextFeedback(cfg, secrets, input, submitter) {
  const subject = (input.subject ?? "").trim();
  if (!subject) return { ok: false, error: "Please add a one-line subject.", retryable: false };
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
  const warnings = [];
  let taskId;
  try {
    taskId = await createFeedbackTaskInTeamwork(tw, token, title);
  } catch (err) {
    return failure(err);
  }
  try {
    await addHtmlComment(tw, token, taskId, commentHtml);
  } catch (err) {
    warnings.push({
      step: "teamwork.addComment",
      message: `Task ${taskId} was created but its description could not be posted: ${messageOf(err)}`
    });
  }
  await moveTaskToStage(tw, token, taskId, warnings);
  if (tw.soleFollowerId) await setSoleFollower(tw, token, taskId, tw.soleFollowerId, warnings);
  return {
    ok: true,
    taskId,
    url: teamworkTaskUrl(tw, taskId),
    ...warnings.length ? { warnings: warnings.map((w) => w.message) } : {}
  };
}
function failure(err) {
  if (isFeedbackError(err)) {
    return { ok: false, error: err.message, step: err.step, retryable: err.retryable };
  }
  return { ok: false, error: messageOf(err) || "Something went wrong filing your feedback." };
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
  let res;
  try {
    res = await fetch(`${VIMEO_API}/me/videos`, {
      method: "POST",
      headers: vheaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ upload: { approach: "tus", size: sizeBytes }, name: name.slice(0, 128), privacy: { view: "unlisted" } })
    });
  } catch (err) {
    throw new FeedbackError({ step: "vimeo.createUpload", message: `Vimeo create-upload could not reach the API: ${messageOf(err)}`, cause: err });
  }
  const text = await readBodyText(res);
  if (!res.ok) {
    throw new FeedbackError({
      step: "vimeo.createUpload",
      message: `Vimeo create-upload failed: HTTP ${res.status} \u2014 ${snip(text)}`,
      httpStatus: res.status,
      responseBody: snip(text)
    });
  }
  let j;
  try {
    j = JSON.parse(text);
  } catch (err) {
    throw new FeedbackError({ step: "vimeo.createUpload", message: `Vimeo create-upload returned unparseable JSON \u2014 ${snip(text)}`, httpStatus: res.status, responseBody: snip(text), cause: err, retryable: false });
  }
  const uploadLink = j.upload?.upload_link ?? "";
  const videoUri = j.uri ?? "";
  const videoId = videoUri.split("/").pop() ?? "";
  if (!uploadLink || !videoId) {
    throw new FeedbackError({
      step: "vimeo.createUpload",
      message: `Vimeo create-upload returned no upload link or id \u2014 ${snip(text)}`,
      httpStatus: res.status,
      responseBody: snip(text),
      retryable: false
    });
  }
  return { videoId, videoUri, uploadLink };
}
async function moveVideoToFolder(token, videoId, folderId, warnings) {
  if (!folderId) return false;
  try {
    const res = await fetch(`${VIMEO_API}/me/projects/${folderId}/videos/${videoId}`, { method: "PUT", headers: vheaders(token) });
    if (!res.ok) {
      pushWarning(warnings, {
        step: "vimeo.moveToFolder",
        message: `Video ${videoId} uploaded but not filed into folder ${folderId}: HTTP ${res.status}`,
        httpStatus: res.status
      });
    }
    return res.ok;
  } catch (err) {
    pushWarning(warnings, { step: "vimeo.moveToFolder", message: `Video ${videoId} folder move could not reach the API: ${messageOf(err)}` });
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
function transcriptError(message, httpStatus, body) {
  return { status: "error", error: new FeedbackError({ step: "vimeo.fetchTranscript", message, httpStatus, responseBody: body }) };
}
async function fetchTranscriptResult(token, videoId) {
  let res;
  try {
    res = await fetch(`${VIMEO_API}/videos/${videoId}/texttracks`, { headers: vheaders(token) });
  } catch (err) {
    return { status: "error", error: new FeedbackError({ step: "vimeo.fetchTranscript", message: `Vimeo texttracks could not reach the API: ${messageOf(err)}`, cause: err }) };
  }
  if (!res.ok) {
    const body = await safeBodyText(res, 200);
    const permanent = isPermanentHttpStatus(res.status);
    return transcriptError(
      permanent ? `Vimeo texttracks rejected the request (HTTP ${res.status}) \u2014 check the Vimeo token or that video ${videoId} still exists. Retrying cannot help. ${body}` : `Vimeo texttracks failed: HTTP ${res.status} \u2014 ${body}`,
      res.status,
      body
    );
  }
  let data;
  try {
    data = await res.json();
  } catch (err) {
    return { status: "error", error: new FeedbackError({ step: "vimeo.fetchTranscript", message: `Vimeo texttracks returned unparseable JSON: ${messageOf(err)}`, httpStatus: res.status, cause: err }) };
  }
  const track = (data.data ?? []).find((t) => t.link);
  if (!track?.link) return { status: "pending" };
  let vttRes;
  try {
    vttRes = await fetch(track.link);
  } catch (err) {
    return { status: "error", error: new FeedbackError({ step: "vimeo.fetchTranscript", message: `Vimeo VTT download could not reach the CDN: ${messageOf(err)}`, cause: err }) };
  }
  if (!vttRes.ok) return transcriptError(`Vimeo VTT download failed: HTTP ${vttRes.status}`, vttRes.status);
  const text = vttToText(await vttRes.text());
  return text ? { status: "ready", text } : { status: "pending" };
}
async function fetchTranscript(token, videoId) {
  const out = await fetchTranscriptResult(token, videoId);
  return out.status === "ready" ? out.text : null;
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
  let res;
  try {
    res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt(transcript) }] })
    });
  } catch (err) {
    throw new FeedbackError({ step: "anthropic.summarize", message: `Anthropic summarize could not reach the API: ${messageOf(err)}`, cause: err });
  }
  if (!res.ok) {
    const body = await safeBodyText(res);
    throw new FeedbackError({
      step: "anthropic.summarize",
      message: `Anthropic summarize failed: HTTP ${res.status} \u2014 ${body}`,
      httpStatus: res.status,
      responseBody: body
    });
  }
  let j;
  try {
    j = await res.json();
  } catch (err) {
    throw new FeedbackError({ step: "anthropic.summarize", message: `Anthropic returned unparseable JSON: ${messageOf(err)}`, httpStatus: res.status, cause: err });
  }
  const text = j.content?.map((c) => c.text ?? "").join("").trim();
  if (!text) throw new FeedbackError({ step: "anthropic.summarize", message: "Anthropic returned no summary text.", retryable: true });
  return text;
}

// src/core/create-video-feedback.ts
var DEFAULT_MODEL = "claude-sonnet-4-6";
var DEFAULT_MAX_TOKENS = 700;
async function createVideoTarget(_cfg, secrets, sizeBytes, subject) {
  if (!secrets.vimeoToken) {
    throw new FeedbackError({ step: "vimeo.createUpload", message: "Vimeo is not configured for this app.", retryable: false });
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new FeedbackError({ step: "vimeo.createUpload", message: "Recording looks empty \u2014 try again.", retryable: false });
  }
  const name = `Feedback: ${(subject || "").trim() || "screen recording"}`;
  return createVimeoUpload(secrets.vimeoToken, name, Math.round(sizeBytes));
}
async function submitVideoFeedback(cfg, secrets, input, submitter) {
  const subject = (input.subject ?? "").trim();
  if (!subject) return { result: { ok: false, error: "Please add a one-line subject.", retryable: false } };
  if (!input.videoId) return { result: { ok: false, error: "Missing video reference.", retryable: false } };
  const tw = cfg.teamwork;
  const token = secrets.teamworkToken;
  const watch = vimeoWatchUrl(input.videoId);
  const commentHtml = `<p>\u{1F3A5} <strong>Screen recording:</strong> <a href="${escapeHtml(watch)}">${escapeHtml(watch)}</a></p><p>\u{1F916} <em>AI summary pending \u2014 added automatically once the transcript is ready.</em></p>` + buildContextHtml(submitter, { appName: cfg.appName, pageUrl: input.pageUrl, pageTitle: input.pageTitle, userAgent: input.userAgent, viewport: input.viewport, topicLabel: input.topicLabel });
  const warnings = [];
  let taskId;
  try {
    taskId = await createFeedbackTaskInTeamwork(tw, token, buildTitle(input.type, subject));
  } catch (err) {
    return { result: failure2(err, "Something went wrong filing your video feedback.") };
  }
  try {
    await addHtmlComment(tw, token, taskId, commentHtml);
  } catch (err) {
    warnings.push({
      step: "teamwork.addComment",
      // Worth shouting about: this comment carries the only link to the recording,
      // so without it the video is uploaded but unreachable from the task.
      message: `Task ${taskId} was created but the comment holding the video link (${watch}) could not be posted: ${messageOf(err)}`
    });
  }
  await moveTaskToStage(tw, token, taskId, warnings);
  if (tw.soleFollowerId) await setSoleFollower(tw, token, taskId, tw.soleFollowerId, warnings);
  if (secrets.vimeoToken && cfg.vimeo?.folderId) await moveVideoToFolder(secrets.vimeoToken, input.videoId, cfg.vimeo.folderId, warnings);
  const pending = { taskId, videoId: input.videoId, videoUri: input.videoUri };
  return {
    result: {
      ok: true,
      taskId,
      url: teamworkTaskUrl(tw, taskId),
      ...warnings.length ? { warnings: warnings.map((w) => w.message) } : {}
    },
    pending
  };
}
async function summarizePendingVideo(cfg, secrets, pending) {
  if (!secrets.vimeoToken || !secrets.anthropicKey) {
    return { status: "failed", error: "Vimeo/Anthropic not configured.", permanent: true };
  }
  const transcript = await fetchTranscriptResult(secrets.vimeoToken, pending.videoId);
  if (transcript.status === "error") {
    const e = transcript.error;
    if (e.retryable) return { status: "retry" };
    return { status: "failed", error: e.message, permanent: true, step: e.step };
  }
  if (transcript.status === "pending") return { status: "retry" };
  let summary;
  try {
    summary = await summarizeTranscript(secrets.anthropicKey, cfg.summary?.model ?? DEFAULT_MODEL, cfg.summary?.maxTokens ?? DEFAULT_MAX_TOKENS, transcript.text);
  } catch (err) {
    return summaryFailure(err);
  }
  const warnings = [];
  try {
    await addHtmlComment(cfg.teamwork, secrets.teamworkToken, pending.taskId, `<p>\u{1F916} <strong>AI summary</strong></p>${summary}`);
  } catch (err) {
    return summaryFailure(err);
  }
  if (cfg.teamwork.soleFollowerId) {
    await setSoleFollower(cfg.teamwork, secrets.teamworkToken, pending.taskId, cfg.teamwork.soleFollowerId, warnings);
  }
  return warnings.length ? { status: "summarized", warnings: warnings.map((w) => w.message) } : { status: "summarized" };
}
function summaryFailure(err) {
  if (isFeedbackError(err)) {
    return { status: "failed", error: err.message, permanent: !err.retryable, step: err.step };
  }
  return { status: "failed", error: messageOf(err) };
}
function failure2(err, fallback) {
  if (isFeedbackError(err)) {
    return { ok: false, error: err.message, step: err.step, retryable: err.retryable };
  }
  return { ok: false, error: messageOf(err) || fallback };
}

// src/core/index.ts
var CORE_VERSION = "0.3.0";
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CORE_VERSION,
  FEEDBACK_TYPES,
  FeedbackError,
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
  fetchTranscriptResult,
  isFeedbackError,
  isPermanentHttpStatus,
  messageOf,
  moveTaskToStage,
  moveVideoToFolder,
  pushWarning,
  readBodyText,
  safeBodyText,
  setSoleFollower,
  snip,
  submitVideoFeedback,
  summarizePendingVideo,
  summarizeTranscript,
  teamworkTaskUrl,
  titlePrefixFor,
  vimeoWatchUrl,
  vttToText
});
