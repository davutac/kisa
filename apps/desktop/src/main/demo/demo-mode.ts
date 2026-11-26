/**
 * Demo mode shows Kisa with a made-up mailbox, for screenshots, recordings
 * and trying the app without an account. The real mail engine runs against
 * mail servers that live in memory, in a profile made for this one launch,
 * so nothing of the user's is read and nothing reaches a network. See
 * docs/architecture/demo-mode.md.
 *
 * Chosen at launch and never changed afterwards: a running app cannot move
 * between a real profile and the demo one.
 */
export const isDemoMode = process.argv.includes("--demo");

/** Said when demo mode refuses something that belongs to real accounts. */
export const DEMO_MODE_REFUSAL =
  "Demo mode shows sample mail only. Start Kisa without --demo to use your own accounts.";
