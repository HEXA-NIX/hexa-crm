import type { Handle } from "@sveltejs/kit";

/**
 * The web app is served as a long-running Node process.  HTML must not be
 * cached between deployments: an old Vite/SvelteKit document can reference
 * generated development modules that no longer exist and leave the app in a
 * half-working state after a restart.  Immutable build assets keep their own
 * hashed URLs and remain cacheable.
 */
export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    response.headers.set("Cache-Control", "no-store, max-age=0");
    response.headers.set("Pragma", "no-cache");
  }
  return response;
};
