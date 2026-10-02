import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PanelNavigation } from "../src/ui/PanelNavigation";
import { App } from "../src/ui/App";
import { panelHeight } from "../src/shared/panel-layout";

describe("task panel", () => {
  it("keeps cancellation and activation state accessible while closed", () => {
    const noop = () => {};
    const html = renderToStaticMarkup(
      createElement(PanelNavigation, {
        task: "notes",
        expanded: false,
        active: true,
        busy: "Making notes",
        notes: 3,
        onSelect: noop,
        onActivate: noop,
        onPause: noop,
        onStop: noop,
        onSettings: noop,
      }),
    );
    expect(html).toContain("Pause AI for this video");
    expect(html).toContain('role="status"');
    expect(html).toContain("Making notes");
    expect(html).toContain("Stop</button>");
    expect(html).not.toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="3 saved notes"');
  });

  it("starts open and retains a labelled region for every task control", () => {
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain('class="task-panel"');
    expect(html).not.toContain('class="task-panel" hidden');
    for (const task of [
      "chat",
      "transcript",
      "notes",
      "comments",
      "downloads",
      "tools",
    ]) {
      expect(html).toContain(`aria-controls="task-${task}"`);
      expect(html).toContain(`id="task-${task}"`);
      expect(html).toContain(`aria-labelledby="panel-${task}"`);
    }
    expect(html).toContain("Activate for this video");
    expect(html).toContain("Create capsule");
  });
});

describe("iframe height messages", () => {
  it("rejects malformed heights and bounds finite values", () => {
    for (const input of [
      undefined,
      null,
      "540",
      {},
      NaN,
      Infinity,
      -Infinity,
    ]) {
      expect(panelHeight(input)).toBeUndefined();
    }
    expect(panelHeight(-1)).toBe(100);
    expect(panelHeight(3000)).toBe(1400);
    expect(panelHeight(135.25)).toBe(136);
    expect(panelHeight(600)).toBe(600);
  });
});
