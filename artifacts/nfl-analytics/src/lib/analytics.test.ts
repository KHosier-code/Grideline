import test from "node:test";
import assert from "node:assert/strict";
import { trackEvent, type AnalyticsData } from "./analytics.ts";

type TestWindow = {
  umami?: {
    track(name: string, data?: AnalyticsData): void;
  };
};

function withWindow(value: TestWindow | undefined, callback: () => void): void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

  if (value === undefined) {
    Reflect.deleteProperty(globalThis, "window");
  } else {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value,
    });
  }

  try {
    callback();
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "window", originalDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
}

test("analytics is a no-op during server-side execution", () => {
  withWindow(undefined, () => {
    assert.doesNotThrow(() => trackEvent("usage_sort_changed", { direction: "asc" }));
  });
});

test("analytics is a no-op when the tracker is missing", () => {
  withWindow({}, () => {
    assert.doesNotThrow(() => trackEvent("usage_row_toggled", { expanded: true }));
  });
});

test("analytics swallows tracker failures", () => {
  withWindow({
    umami: {
      track() {
        throw new Error("analytics unavailable");
      },
    },
  }, () => {
    assert.doesNotThrow(() => trackEvent("usage_filter_changed", { value: "all" }));
  });
});

test("analytics passes event payloads to a working tracker unchanged", () => {
  const payload = { direction: "desc", column: "targets", expanded: false };
  const calls: Array<{ name: string; data?: AnalyticsData }> = [];

  withWindow({
    umami: {
      track(name, data) {
        calls.push({ name, data });
      },
    },
  }, () => {
    trackEvent("usage_sort_changed", payload);
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.name, "usage_sort_changed");
  assert.strictEqual(calls[0]?.data, payload);
});