import { useCallback, useState, type ReactNode } from "react";
import { FeedbackCtx, type UiFeedbackConfig } from "./feedback-config";

export function FeedbackProvider({ config, children }: { config: UiFeedbackConfig; children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  return <FeedbackCtx.Provider value={{ isOpen, open, close, config }}>{children}</FeedbackCtx.Provider>;
}
