// Read-only guard for the GT labelling build (branch merge-free-legacy).
//
// This build is only for preparing ground truth: a reviewer imports a bundle,
// labels each window and exports the decisions. It must never change the
// segmentation. The review UI has no split button here, but neuroglancer's
// own graphene tools (multicut, merge) can still be opened from the layer
// panel, so every request to a chunkedgraph edit endpoint is refused in the
// browser before it is sent. Reads, including split previews, pass through.
//
// main.ts imports this first, so the guard is in place before neuroglancer loads.

const EDIT_ENDPOINT =
  /\/segmentation\/api\/v\d+\/table\/[^/?#]+\/(merge|split|undo|redo|rollback)(?:[/?#]|$)/i;

export const EDITS_DISABLED_MESSAGE =
  "Edits are turned off in this review build: split and merge requests are not sent.";

export function isEditRequest(url: string): boolean {
  let path = url;
  try {
    path = new URL(url, window.location.href).pathname;
  } catch {
    // not a parseable URL: test the raw string
  }
  return EDIT_ENDPOINT.test(path);
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const originalFetch = window.fetch.bind(window);
const guardedFetch = (input: RequestInfo | URL, init?: RequestInit) => {
  if (isEditRequest(urlOf(input))) {
    console.warn(`[edit guard] blocked ${urlOf(input)}`);
    return Promise.reject(new Error(EDITS_DISABLED_MESSAGE));
  }
  return originalFetch(input, init);
};
Object.defineProperty(guardedFetch, "editGuard", { value: true });
window.fetch = guardedFetch as typeof window.fetch;

const originalOpen = XMLHttpRequest.prototype.open as (...args: unknown[]) => void;
XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]): void {
  if (isEditRequest(String(args[1]))) {
    console.warn(`[edit guard] blocked ${String(args[1])}`);
    throw new Error(EDITS_DISABLED_MESSAGE);
  }
  originalOpen.apply(this, args);
} as unknown as typeof XMLHttpRequest.prototype.open;
