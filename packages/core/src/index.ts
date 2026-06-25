// @mavenmm/core — framework-neutral shared logic for Maven dev components.
// Barebones for now: feature modules (feedback, etc.) land here as they are built.

export const CORE_VERSION = "0.0.1";

/** Health-check used by the scaffold smoke test; safe to delete once a real module lands. */
export function ping(): "pong" {
  return "pong";
}
