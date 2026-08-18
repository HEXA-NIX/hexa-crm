// Project identifiers are dynamic and cannot be enumerated at build time.
// Keep the authenticated CRM as a client-side page, but register this route
// in the Node manifest so direct loads and browser refreshes return HTTP 200.
export const prerender = false;
export const ssr = false;
