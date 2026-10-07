import assert from "node:assert/strict";
import { test } from "node:test";

import {
  gatewayBaseUrl,
  gatewayDisplaySocketUrl,
  gatewayPath,
  gatewayRoute,
  gatewaySocketUrl,
  gatewayUrl,
  hevcDecoderUrl,
} from "./gateway.ts";

const NESTED = "https://desktop.example/apps/remotex/";

test("the document base names root and nested gateway mounts", () => {
  assert.equal(
    gatewayBaseUrl("https://desktop.example/", undefined),
    "https://desktop.example/",
  );
  assert.equal(gatewayBaseUrl(NESTED, undefined), NESTED);
  assert.equal(
    gatewayBaseUrl(
      undefined,
      "https://desktop.example/apps/remotex/assets/paint-worker.js",
    ),
    NESTED,
  );
  assert.equal(gatewayBaseUrl(undefined, "file:///tmp/worker.js"), "");
});

test("HTTP, HEVC, and public route paths stay under root and nested mounts", () => {
  assert.equal(
    gatewayUrl("/api/config", "https://desktop.example/"),
    "https://desktop.example/api/config",
  );
  assert.equal(
    gatewayUrl("/api/targets", NESTED),
    "https://desktop.example/apps/remotex/api/targets",
  );
  assert.equal(
    hevcDecoderUrl("hevc.wasm", NESTED),
    "https://desktop.example/apps/remotex/hevc/hevc.wasm",
  );
  assert.equal(gatewayPath("/display/2", NESTED), "/apps/remotex/display/2");
  assert.equal(gatewayRoute("/apps/remotex/", "/apps/remotex/"), "/");
  assert.equal(
    gatewayRoute("/apps/remotex/display/2", "/apps/remotex/"),
    "/display/2",
  );
  assert.equal(gatewayRoute("/apps/another/display/2", "/apps/remotex/"), null);
});

test("session and display sockets use the mounted secure WebSocket paths", () => {
  const session = new URL(
    gatewaySocketUrl(
      "/ws",
      "claim/one",
      {
        screen: { w: 1440, h: 900, scale: 2, fit: false },
        chroma: "444",
        appleMedia: true,
        rdpGraphics: false,
        rdpH264: true,
      },
      NESTED,
    ),
  );
  assert.equal(session.origin, "wss://desktop.example");
  assert.equal(session.pathname, "/apps/remotex/ws");
  assert.deepEqual(Object.fromEntries(session.searchParams), {
    session: "claim/one",
    w: "1440",
    h: "900",
    scale: "2",
    fit: "false",
    chroma: "444",
    apple_media: "true",
    rdp_graphics: "false",
    rdp_h264: "true",
  });

  const display = new URL(
    gatewayDisplaySocketUrl(2, { id: "tab one", takeover: true }, NESTED),
  );
  assert.equal(display.pathname, "/apps/remotex/ws/display");
  assert.deepEqual(Object.fromEntries(display.searchParams), {
    display: "2",
    tab: "tab one",
    takeover: "true",
  });
});

test("gateway routes cannot escape or replace their mount", () => {
  for (const path of [
    "api/config",
    "//other.example/api",
    "/../api",
    "/%2e%2e/api",
    "/a/./b",
    "/a%2fb",
    "/a\\b",
  ]) {
    assert.throws(() => gatewayUrl(path, NESTED), TypeError, path);
  }
});
