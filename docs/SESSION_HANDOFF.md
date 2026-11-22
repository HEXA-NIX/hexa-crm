# Relevo para nuevas sesiones — hexa-crm

> Guía operativa para continuar el trabajo sin depender de conversaciones
> anteriores. No contiene ni debe contener secretos, contraseñas, tokens ni
> datos personales.

**Comprobado:** 2026-08-05 (Europe/Madrid)  
**Repositorio:** `HEXA-NIX/hexa-crm`  
**Integración:** `dev`  
**Producción/release:** `main`, solo tras autorización humana explícita.

## Regla de trabajo

Lee primero [`AGENTS.md`](../AGENTS.md), conserva cualquier checkout sucio y
actualiza solo referencias con `git fetch origin --prune`. El flujo obligatorio
es:

```text
feat/*, fix/*, docs/*, chore/* → PR/merge a dev → checks verdes
                                      → autorización humana → dev → main
```

No hagas commit, push, merge o deploy a `main` sin autorización. Tras un
hotfix excepcional publicado en `main`, intégralo de vuelta a `dev` antes de
continuar. Los hooks locales no sustituyen la protección remota; consulta
[`BRANCH_PROTECTION.md`](./BRANCH_PROTECTION.md).

## Foto de estado (no sustituye una comprobación actual)

| Elemento | Estado del 2026-08-05 |
|---|---|
| Stable actual | `v0.3.2`, commit `756eec2` en `main` |
| Integración | `dev` contiene `main`; referencia comprobada: `5270c8f` |
| Versiones | `package.json`, Tauri y Cargo: `0.3.2` |
| Web desplegada | Worker `hexa-crm-cloudflare`, dominio `crm.nix-0.com`, D1 `hexa-crm` |
| Dependabot | npm, Cargo y GitHub Actions fijan `target-branch: dev` |

`dev` puede avanzar y normalmente estará por delante de `main`. No conviertas
esa diferencia en release sin revisar changelog, PRs, checks y autorización.
Comprueba además la sincronización de forma explícita, no solo con el log:

```bash
git merge-base --is-ancestor origin/main origin/dev
```

Salida `0` significa que `dev` contiene el `main` conocido localmente; refresca
las referencias antes de interpretar el resultado.

## Topología y fuentes de verdad

| Modo | Persistencia | Uso |
|---|---|---|
| Navegador local | `localStorage` | Demo/desarrollo sin `DATABASE_URL`. |
| Central Node | PostgreSQL | SvelteKit con `DATABASE_URL` y `HEXA_CENTRAL_MODE=1`. |
| Producción web | Cloudflare Worker + D1 | `crm.nix-0.com`; código en `workers/cloudflare/`. |

D1 y PostgreSQL no comparten datos ni migraciones. No añadas `DATABASE_URL` al
Worker ni supongas que un usuario de un modo existe en otro. Ver
[`CLOUDFLARE_STORAGE.md`](./CLOUDFLARE_STORAGE.md) y
[`CENTRAL_DEPLOYMENT.md`](./CENTRAL_DEPLOYMENT.md).

### Worker y D1

- Configuración: [`workers/cloudflare/wrangler.jsonc`](../workers/cloudflare/wrangler.jsonc).
  Declara Worker, binding `DB`, assets SPA, dominio y migraciones.
- Health: `GET /api/health`; API de aplicación: `POST /api/rpc`.
- Las migraciones de `workers/cloudflare/migrations/` son acumulativas. Un
  redespliegue de código no revierte el schema D1.
- El Worker sirve los assets SPA y ejecuta primero `/api/*`; un deploy afecta
  frontend y API a la vez.
- El workflow estable
  [`cloudflare-stable-release.yml`](../.github/workflows/cloudflare-stable-release.yml)
  se dispara al publicar una Release estable. Construye, aplica migraciones D1
  y despliega con `--keep-vars`. Su dispatch manual está pensado para un tag
  estable publicado, pero su validación actual no fuerza el resultado de `jq`;
  antes de usarlo confirma externamente la Release y pide autorización.

### Acceso y usuarios

El backend del login depende del modo, no solo de la casilla visible:

| Contexto | Login normal sin casilla | Login con «operador a CRM central» |
|---|---|---|
| Vite (`npm run dev`) | `browserApi` / localStorage por defecto | REST remoto configurado por URL + tenant |
| Producción web (`WEB_DATA_MODE=central`) | `POST /api/rpc`, actualmente Worker/D1 | REST `POST /api/v1/operator/login` en el CRM remoto elegido |
| Tauri | comando nativo | No asumir paridad: verificar el contrato de la app nativa |

El RPC normal usa `{cmd:"login", args:{username,password,pin}}`; el Worker
valida el hash D1 y crea una sesión de ocho horas. `list_users` y `upsert_user`
requieren `admin`. Las contraseñas temporales son de 14 caracteres, vencen a
las 24 horas y fuerzan cambio al entrar.

Para investigar un acceso, identifica primero el modo y comprueba usuario
activo y la petición real del backend correspondiente; no pongas secretos en
issues, logs, commits o documentos. Si se autoriza un reset, modifica solo la
cuenta afectada y valida el contrato sin mostrar el secreto. La versión `v0.3.2`
evita que Ollama indisponible bloquee el listado de usuarios de Ajustes.

## Multiempresa: alcance real

D1 ya tiene `companies`, `company_members` y `active_company_id`; el Worker
filtra productos, clientes, ventas, caja y stock por empresa y permite listar o
cambiar entre membresías. No es todavía una administración completa de tenants:

- no existe UI/RPC de plataforma para crear una empresa y su fundador;
- `admin` se guarda globalmente en `users`; antes de crear tenants se requiere
  un rol de plataforma separado y pruebas de aislamiento;
- el login normal del Worker/D1 comienza en empresa `1`, `settings` no están por empresa y
  algunos caminos Node/local no tienen la misma semántica;
- el dashboard Worker devuelve métricas de ventas/caja incompletas.

[`MULTI_COMPANY_ANALYSIS.md`](./MULTI_COMPANY_ANALYSIS.md) conserva diseño de
producto; partes de su "estado actual" son históricas. Para implementar usa
Worker, migraciones y tests actuales como evidencia primaria.

## Desarrollo local seguro

Un checkout recibido puede estar sucio o en una rama antigua. No lo limpies:

```bash
git fetch origin --prune
git worktree add -b fix/descripcion /tmp/hexa-crm-fix origin/dev
cd /tmp/hexa-crm-fix
git submodule update --init --recursive
npm ci
npm run check
npm test
npm run build
```

Para UI local:

```bash
npm run dev -- --host 127.0.0.1
# habitualmente http://127.0.0.1:1420
curl -I http://127.0.0.1:1420/
```

Para emular el Worker, prepara antes los assets y D1 local:

```bash
npm run build:cloudflare
npm run cf:dev -- --local
```

No apuntes pruebas locales contra D1 remota ni trates el resultado como paridad
con producción. Antes de diagnosticar un puerto, comprueba que el proceso
escucha realmente.

## Release, deploy y rollback

1. Añade los cambios de producto a `[Unreleased]` en `CHANGELOG.md`.
2. Para release, alinea versión package/Tauri/Cargo y ejecuta `npm run check`,
   `npm test`, `npm run build` y `npm run build:cloudflare` si afecta la web.
3. Integra en `dev`; el responsable humano decide `dev → main`, tag `vX.Y.Z`
   y GitHub Release estable.
4. La Release dispara Cloudflare. Revisa el workflow y
   `curl -fsS https://crm.nix-0.com/api/health` después.
5. El dispatch manual está destinado a redesplegar un tag estable publicado.
   Antes de usarlo, pide autorización y verifica explícitamente que la Release
   no es draft ni prerelease:

   ```bash
   gh release view TAG --repo HEXA-NIX/hexa-crm --json isDraft,isPrerelease
   ```

   No deshace migraciones D1; evalúa una migración correctiva antes de tratarlo
   como rollback.

El camino Incus/PostgreSQL de [`RELEASES.md`](./RELEASES.md) es alternativo;
la web de producción actual usa Cloudflare/D1.

## Dependabot y PRs

Las tres entradas de `.github/dependabot.yml` tienen `target-branch: dev`.
Editar el archivo no retargetea PRs existentes, por lo que al inicio de una
sesión hay que comprobarlas:

```bash
gh pr list --repo HEXA-NIX/hexa-crm --state open \
  --json number,title,author,baseRefName,headRefName,url

# Solo tras verificar que NUMERO es una PR Dependabot:
gh api -X PATCH repos/HEXA-NIX/hexa-crm/pulls/NUMERO -f base=dev
```

Revisa actualizaciones secuencialmente. Un merge puede dejar otras PRs
`BEHIND`/`DIRTY`; actualiza la rama, espera CI nueva y no fuerces versiones
incompatibles solo para obtener verde.

## Receta de comienzo y cierre

### Inicio

```bash
git fetch origin --prune
git status --short
git log --oneline --decorate -5 origin/dev origin/main
gh pr list --repo HEXA-NIX/hexa-crm --state open \
  --json number,title,baseRefName,headRefName,mergeStateStatus,url
curl -fsS https://crm.nix-0.com/api/health
git merge-base --is-ancestor origin/main origin/dev
```

### Cierre

Deja siempre: rama/base/PR, ficheros tocados, comandos y resultados, evidencia
de deploy o flujo autenticado, límites no probados y toda acción que aún
requiere autorización humana. Un build verde o un HTTP aislado no prueba por sí
solo persistencia, aislamiento de tenant ni acceso extremo a extremo.

## Referencias

| Necesidad | Fuente primaria |
|---|---|
| Ramas, agentes y releases | [`AGENTS.md`](../AGENTS.md) |
| Cambios publicados | [`CHANGELOG.md`](../CHANGELOG.md) |
| Checklist de versión | [`RELEASES.md`](./RELEASES.md) |
| Worker/D1 | `workers/cloudflare/` y [`CLOUDFLARE_STORAGE.md`](./CLOUDFLARE_STORAGE.md) |
| PostgreSQL central | [`CENTRAL_DEPLOYMENT.md`](./CENTRAL_DEPLOYMENT.md), [`openapi-v1.yaml`](./openapi-v1.yaml) |
| CI/protección | [`BRANCH_PROTECTION.md`](./BRANCH_PROTECTION.md), `.github/workflows/ci.yml` |
