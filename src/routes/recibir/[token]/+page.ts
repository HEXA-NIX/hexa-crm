// The document link is intentionally rendered on demand so the public
// bearer-token page can work for any token without being put in the static
// prerender set used by the authenticated CRM shell.
export const prerender = false;
// WhatsApp reads Open Graph metadata from the first HTML response, so this
// route opts back into SSR while the main CRM remains a client-rendered SPA.
export const ssr = true;
