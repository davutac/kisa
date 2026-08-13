import * as Effect from "effect/Effect";

import type { AiProviderStatus } from "../../shared/ipc/ai";
import { getClaudeStatus } from "./providers/claude";
import { getCodexStatus } from "./providers/codex";
import { getOpenCodeStatus } from "./providers/opencode";

export const listAiProviderStatuses = Effect.fn("listAiProviderStatuses")(
  function* listAiProviderStatuses() {
    const statuses: readonly AiProviderStatus[] = yield* Effect.all(
      [getCodexStatus(), getClaudeStatus(), getOpenCodeStatus()],
      { concurrency: "unbounded" }
    );
    return statuses;
  }
);
