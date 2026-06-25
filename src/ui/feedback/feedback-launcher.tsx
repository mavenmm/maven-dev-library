import { useFeedback } from "./feedback-config";

export function FeedbackLauncher({ className }: { className?: string }) {
  const { open } = useFeedback();
  return (
    <button type="button" onClick={open} className={className ?? "mvui-fb-launcher"}>
      <svg viewBox="0 0 20 20" fill="none" className="mvui-fb-launcher-icon" aria-hidden="true">
        <path d="M4 4h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8l-4 3v-3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      Feedback
    </button>
  );
}
