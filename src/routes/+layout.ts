// En Node el documento debe pasar por hooks.server para recibir no-store.
// El adaptador estático conserva su fallback SPA para Tauri.
export const prerender = false;
export const ssr = false;
