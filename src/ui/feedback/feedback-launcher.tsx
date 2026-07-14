import { useFeedback } from "./feedback-config";

export function FeedbackLauncher({ className, variant = "default" }: { className?: string; variant?: "default" | "inverted" }) {
  const { open } = useFeedback();
  // `variant="inverted"` forces a light (white) tone for dark surfaces, since the
  // default launcher uses color:inherit and can vanish on the host's background.
  // A caller-supplied `className` still fully overrides (style it yourself).
  const base = variant === "inverted" ? "mvui-fb-launcher mvui-fb-launcher--inverted" : "mvui-fb-launcher";
  return (
    <button type="button" onClick={open} className={className ?? base}>
      <svg viewBox="0 0 20 20" fill="none" className="mvui-fb-launcher-icon" aria-hidden="true">
        <path d="M4 4h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8l-4 3v-3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      Feedback
    </button>
  );
}
