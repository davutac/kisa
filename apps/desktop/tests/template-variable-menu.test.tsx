import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Command,
  CommandList,
} from "../src/renderer/src/components/ui/command";
import { TemplateVariableCommandItems } from "../src/renderer/src/templates/template-variable-picker";

describe("template variable menu", () => {
  it("renders syntax guidance and resolved previews within the menu context", () => {
    const markup = renderToString(
      <Command>
        <CommandList>
          <TemplateVariableCommandItems
            context={{
              accountEmail: "me@example.com",
              accountName: "Me Person",
              locale: "en-US",
              now: new Date(2026, 7, 10, 12).getTime(),
              toEmail: "you@example.com",
            }}
            onSelect={() => {}}
          />
        </CommandList>
      </Command>
    );

    expect(markup).toContain("Date with format");
    expect(markup).toContain("{{date:dd.MM.yyyy}}");
    expect(markup).toContain("10.08.2026");
    expect(markup).toContain("Me Person");
    expect(markup).toContain("you@example.com");
  });

  it("explains previews that depend on application context", () => {
    const markup = renderToString(
      <Command>
        <CommandList>
          <TemplateVariableCommandItems
            context={{ now: 0 }}
            onSelect={() => {}}
          />
        </CommandList>
      </Command>
    );

    expect(markup).toContain("Current account when applied");
    expect(markup).toContain("Current account name when applied");
    expect(markup).toContain("Requires one To recipient");
  });
});
