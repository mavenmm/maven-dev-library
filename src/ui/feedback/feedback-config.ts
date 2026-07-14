import { createContext, useContext } from "react";

export type FeedbackType = "bug" | "feature" | "working_well" | "other";

export interface FeedbackTypeOption { value: FeedbackType; label: string; }
export const FEEDBACK_TYPES: FeedbackTypeOption[] = [
  { value: "bug", label: "Bug" },
  { value: "feature", label: "Feature request" },
  { value: "working_well", label: "What's working well" },
  { value: "other", label: "Other" },
];

/** Auto-captured page context attached to every submission. */
export interface FeedbackContextMeta {
  pageUrl: string;
  pageTitle?: string;
  userAgent?: string;
  viewport?: string;
}

export interface TextFeedbackPayload extends FeedbackContextMeta {
  type: FeedbackType;
  subject: string;
  /** Rich-text body HTML (inline screenshot <img> carry absolute public URLs). */
  bodyHtml: string;
}

export interface VideoFeedbackPayload extends FeedbackContextMeta {
  type: FeedbackType;
  subject: string;
  videoId: string;
  videoUri: string;
}

/** Vimeo resumable-upload target minted server-side; browser tus-uploads to it. */
export interface VideoUploadTarget { uploadLink: string; videoId: string; videoUri: string; }

export interface FeedbackSubmitResult { ok: boolean; taskId?: string; url?: string; error?: string; }

/**
 * The host-supplied backend. The UI is 100% backend-agnostic: it only ever
 * calls these methods. Phase 2 supplies real implementations (Teamwork/Vimeo/S3);
 * tests/dev supply mocks. Secrets never reach the browser through this interface.
 */
export interface FeedbackTransport {
  /** File the text+screenshot feedback as a task. */
  submitText(payload: TextFeedbackPayload): Promise<FeedbackSubmitResult>;
  /** Upload a pasted/picked screenshot; returns its permanent public URL. */
  uploadImage(file: File | Blob): Promise<{ url: string }>;
  /** Mint a Vimeo resumable-upload target for a recording of `sizeBytes`. */
  createVideoTarget(sizeBytes: number, subject: string): Promise<VideoUploadTarget>;
  /** File the video feedback as a task (after the browser finishes the tus upload). */
  submitVideo(payload: VideoFeedbackPayload): Promise<FeedbackSubmitResult>;
}

export interface UiFeedbackConfig {
  transport: FeedbackTransport;
  /** z-index for the floating portal; default 2147483000 (above MUI/Chakra). */
  zIndex?: number;
  /** Show the screen-recording path (needs Vimeo). Default true. */
  enableVideo?: boolean;
  /** Use the rich-text composer + inline screenshots (needs S3). Default true. */
  enableRichText?: boolean;
  /** While recording, collapse the modal to a small draggable pill (default true,
   *  matches copydeck). Set false to keep the full panel up with inline recording
   *  controls (the panel will then appear in same-surface captures). */
  collapseWhileRecording?: boolean;
}

interface FeedbackState { isOpen: boolean; open: () => void; close: () => void; config: UiFeedbackConfig; }

export const FeedbackCtx = createContext<FeedbackState | null>(null);

export function useFeedback(): FeedbackState {
  const ctx = useContext(FeedbackCtx);
  if (!ctx) throw new Error("useFeedback must be used within a FeedbackProvider");
  return ctx;
}
