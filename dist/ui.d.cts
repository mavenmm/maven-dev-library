import * as react from 'react';
import { ReactNode } from 'react';

type FeedbackType = "bug" | "feature" | "working_well" | "other";
interface FeedbackTypeOption {
    value: FeedbackType;
    label: string;
}
declare const FEEDBACK_TYPES: FeedbackTypeOption[];
/** An "area" the feedback is about (e.g. whole-app vs a specific feature). App-defined. */
interface FeedbackTopic {
    value: string;
    label: string;
}
/** Auto-captured page context attached to every submission. */
interface FeedbackContextMeta {
    pageUrl: string;
    pageTitle?: string;
    userAgent?: string;
    viewport?: string;
}
interface TextFeedbackPayload extends FeedbackContextMeta {
    type: FeedbackType;
    subject: string;
    /** Rich-text body HTML (inline screenshot <img> carry absolute public URLs). */
    bodyHtml: string;
    /** Selected topic/area (only when the app configures `topics`). */
    topic?: string;
    topicLabel?: string;
}
interface VideoFeedbackPayload extends FeedbackContextMeta {
    type: FeedbackType;
    subject: string;
    videoId: string;
    videoUri: string;
    /** Selected topic/area (only when the app configures `topics`). */
    topic?: string;
    topicLabel?: string;
}
/** Vimeo resumable-upload target minted server-side; browser tus-uploads to it. */
interface VideoUploadTarget {
    uploadLink: string;
    videoId: string;
    videoUri: string;
}
interface FeedbackSubmitResult {
    ok: boolean;
    taskId?: string;
    url?: string;
    error?: string;
}
/**
 * The host-supplied backend. The UI is 100% backend-agnostic: it only ever
 * calls these methods. Phase 2 supplies real implementations (Teamwork/Vimeo/S3);
 * tests/dev supply mocks. Secrets never reach the browser through this interface.
 */
interface FeedbackTransport {
    /** File the text+screenshot feedback as a task. */
    submitText(payload: TextFeedbackPayload): Promise<FeedbackSubmitResult>;
    /** Upload a pasted/picked screenshot; returns its permanent public URL. */
    uploadImage(file: File | Blob): Promise<{
        url: string;
    }>;
    /** Mint a Vimeo resumable-upload target for a recording of `sizeBytes`. */
    createVideoTarget(sizeBytes: number, subject: string): Promise<VideoUploadTarget>;
    /** File the video feedback as a task (after the browser finishes the tus upload). */
    submitVideo(payload: VideoFeedbackPayload): Promise<FeedbackSubmitResult>;
}
interface UiFeedbackConfig {
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
    /** When set, the widget opens on a "what's this about?" step and the chosen
     *  topic's label is attached to the filed task. Omit to skip the step entirely. */
    topics?: FeedbackTopic[];
    /** Prompt shown on the topic step (default "What's this feedback about?"). */
    topicPrompt?: string;
    /** Which mode the form opens in. Default "video" (Record video first). Falls back
     *  to "write" automatically when `enableVideo` is false. */
    defaultMode?: "write" | "video";
}
interface FeedbackState {
    isOpen: boolean;
    open: () => void;
    close: () => void;
    config: UiFeedbackConfig;
}
declare function useFeedback(): FeedbackState;

declare function FeedbackProvider({ config, children }: {
    config: UiFeedbackConfig;
    children: ReactNode;
}): react.JSX.Element;

declare function FeedbackLauncher({ className, variant }: {
    className?: string;
    variant?: "default" | "inverted";
}): react.JSX.Element;

declare function FeedbackWidget(): react.ReactPortal | null;

declare const UI_VERSION = "0.1.0";

export { FEEDBACK_TYPES, type FeedbackContextMeta, FeedbackLauncher, FeedbackProvider, type FeedbackSubmitResult, type FeedbackTransport, type FeedbackType, FeedbackWidget, type TextFeedbackPayload, UI_VERSION, type UiFeedbackConfig, type VideoFeedbackPayload, type VideoUploadTarget, useFeedback };
