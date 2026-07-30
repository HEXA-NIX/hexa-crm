# Persistencia en Cloudflare

La base se elige por entorno con `DATA_BACKEND`:

- `d1`: Worker Cloudflare con el binding `DB`; es el modo desplegado por
  `workers/cloudflare/wrangler.jsonc`.
- `postgres`: runtime Node central existente con `DATABASE_URL` y
  `HEXA_CENTRAL_MODE=1`. Conserva PostgreSQL, pgvector y las políticas RLS.

Los dos modos no comparten datos ni migraciones. No se debe configurar una
`DATABASE_URL` en el Worker D1; los secretos PostgreSQL pertenecen únicamente
al despliegue Node/central.
