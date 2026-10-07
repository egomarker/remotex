import type { VideoChroma } from "./videoChroma.ts";

/// Where this client's gateway is, and how to call it.
///
/// The page is served by its gateway, so every request is same-origin. Keeping URL
/// construction here gives fetches, WebSockets, workers, and assets one spelling
/// of that origin and of the path a reverse proxy mounted it under.

/**
 * Find the gateway directory in a page or one of its workers.
 *
 * A page gets it from the `<base>` the gateway writes into the document. A
 * worker has no document, but Vite emits every worker one directory below the
 * mount, in `assets/`; its own URL therefore names the same directory. Empty is
 * the non-browser fallback used by unit tests importing this module directly.
 */
export function gatewayBaseUrl(
  documentBase: string | undefined,
  workerUrl: string | undefined,
): string {
  for (const [candidate, relative] of [
    [documentBase, "."],
    [workerUrl, ".."],
  ] as const) {
    if (!candidate) {
      continue;
    }
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return new URL(relative, url).toString();
      }
    } catch {
      // Not a browser URL. Try the other source, then use the test fallback.
    }
  }
  return "";
}

const DOCUMENT_BASE =
  typeof document === "undefined" ? undefined : document.baseURI;
const WORKER_URL =
  typeof document === "undefined"
    ? (globalThis.location?.href ?? undefined)
    : undefined;

/** The gateway's absolute public directory URL, always with a trailing slash. */
export const GATEWAY_BASE_URL = gatewayBaseUrl(DOCUMENT_BASE, WORKER_URL);

/** The gateway's origin, with no trailing slash. */
export const GATEWAY_ORIGIN = GATEWAY_BASE_URL
  ? new URL(GATEWAY_BASE_URL).origin
  : (globalThis.location?.origin ?? "").replace(/\/$/, "");

/** The gateway's public mount path, with both leading and trailing slashes. */
export const GATEWAY_BASE_PATH = GATEWAY_BASE_URL
  ? new URL(GATEWAY_BASE_URL).pathname
  : "/";

/** Turn the internal root-relative spelling of a route into a relative URL. */
function route(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new TypeError(`gateway path must start with one slash: ${path}`);
  }
  const pathname = path.slice(1).split(/[?#]/, 1)[0];
  const traverses = pathname.split("/").some((part) => {
    try {
      const decoded = decodeURIComponent(part);
      return (
        decoded === "." ||
        decoded === ".." ||
        decoded.includes("/") ||
        decoded.includes("\\")
      );
    } catch {
      return true;
    }
  });
  if (traverses) {
    throw new TypeError(`gateway path must not traverse its mount: ${path}`);
  }
  return path.slice(1);
}

/** An absolute URL for a gateway path (`/api/targets`). */
export function gatewayUrl(
  path: string,
  baseUrl: string = GATEWAY_BASE_URL,
): string {
  const relative = route(path);
  if (!baseUrl) {
    return `${GATEWAY_ORIGIN}${path}`;
  }
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(relative, base).toString();
}

/** The public pathname for an internal gateway route. */
export function gatewayPath(
  path: string,
  baseUrl: string = GATEWAY_BASE_URL,
): string {
  if (!baseUrl) {
    return path.split(/[?#]/, 1)[0];
  }
  return new URL(gatewayUrl(path, baseUrl)).pathname;
}

/**
 * The route within this gateway for a browser pathname, or null when the
 * pathname is outside its mount.
 */
export function gatewayRoute(
  pathname: string,
  basePath: string = GATEWAY_BASE_PATH,
): string | null {
  if (basePath === "/") {
    return pathname.startsWith("/") ? pathname : null;
  }
  const mount = basePath.replace(/\/$/, "");
  if (pathname === mount || pathname === `${mount}/`) {
    return "/";
  }
  if (!pathname.startsWith(`${mount}/`)) {
    return null;
  }
  return `/${pathname.slice(mount.length + 1)}`;
}

/// `fetch` against the gateway.
///
/// `credentials: "include"` makes the session-cookie requirement explicit even
/// though same-origin fetches would send it by default.
export function gatewayFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(gatewayUrl(path), { credentials: "include", ...init });
}

/// The WebSocket URL for `path`, carrying `session` as the claim.
///
/// Derived from the gateway's public base rather than the document's current
/// route, and the scheme follows it, so a gateway on `https:` gets `wss:`.
///
/// The session socket also names what only this window knows about itself: its
/// `screen` (the same numbers `connect` carries), the chroma its video decoder
/// takes, whether it decodes a High Performance Mac's picture, whether it composes
/// an RDP host's graphics pipeline, and whether it decodes the H.264 such a
/// pipeline may carry. All are here for one reason — a
/// gateway holding a target whose engine a claim change ended reconnects it at
/// attach time, before any message this client could send, and it must build that
/// session for this browser rather than the previous one, or cover it where the
/// session was started with a stream this one cannot take. The media sockets carry
/// the claim and nothing else.
export function gatewaySocketUrl(
  path: string,
  session: string,
  client?: {
    screen: { w: number; h: number; scale: number; fit: boolean };
    chroma: VideoChroma;
    appleMedia: boolean;
    rdpGraphics: boolean;
    rdpH264: boolean;
  },
  baseUrl: string = GATEWAY_BASE_URL,
): string {
  const url = new URL(gatewayUrl(path, baseUrl));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.search = `?session=${encodeURIComponent(session)}`;
  if (client) {
    url.searchParams.set("w", String(client.screen.w));
    url.searchParams.set("h", String(client.screen.h));
    url.searchParams.set("scale", String(client.screen.scale));
    url.searchParams.set("fit", String(client.screen.fit));
    url.searchParams.set("chroma", client.chroma);
    url.searchParams.set("apple_media", String(client.appleMedia));
    url.searchParams.set("rdp_graphics", String(client.rdpGraphics));
    url.searchParams.set("rdp_h264", String(client.rdpH264));
  }
  return url.toString();
}

/// The WebSocket URL of display `display`'s socket: its picture, and the input
/// made over it.
///
/// No claim rides on it. The display socket attaches by the login cookie, which
/// a page of this browser carries and nothing else does — and which is all a
/// display opened in another tab has: that tab is given no session token. What
/// such a tab presents is `tab`, its own name for itself, which tells its reload
/// from another tab, and `takeover` once its user has confirmed taking the
/// display from the tab showing it.
export function gatewayDisplaySocketUrl(
  display: number,
  tab: { id: string; takeover: boolean } | null = null,
  baseUrl: string = GATEWAY_BASE_URL,
): string {
  const url = new URL(gatewayUrl("/ws/display", baseUrl));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("display", String(display));
  if (tab) {
    url.searchParams.set("tab", tab.id);
    if (tab.takeover) {
      url.searchParams.set("takeover", "true");
    }
  }
  return url.toString();
}

/// The software HEVC decoder's files, `hevc.js` (wasm-bindgen's glue) and
/// `hevc.wasm`: a release of andrewtheguy/hevc-wasm the gateway serves beside
/// the bundle when it has the release archive. The decode worker and each
/// thread of the decoder's pool import the glue by this URL, and the glue is
/// given the module's.
export function hevcDecoderUrl(
  file: "hevc.js" | "hevc.wasm",
  baseUrl: string = GATEWAY_BASE_URL,
): string {
  return gatewayUrl(`/hevc/${file}`, baseUrl);
}
