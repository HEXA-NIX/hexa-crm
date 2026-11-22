# Changelog

Todos los cambios relevantes del producto **hexa-crm** se documentan aquí.
El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y este proyecto usa [Versionado Semántico](https://semver.org/lang/es/).

> **Regla de equipo (desde 0.2.0):** ninguna release se publica sin entrada en este archivo.
> Ver proceso en [`docs/RELEASES.md`](./docs/RELEASES.md).

## [Unreleased]

---

## [0.4.0] — 2026-11-22

Release mayor que consolida **Proyectos** (cartera multiempresa, subtareas, documentación, solicitudes, sprints híbridos, economía, hitos y portal de cliente), **Facturación emitida y recibida**, **Presupuestos PDF**, **Gastos/WhatsApp OCR**, **Google Drive**, **Personal/nóminas**, **Financiación**, preparación local VERI\*FACTU e integración con **Orca**.

### Added

- **Proyectos y Trabajo:**
  - Portafolio integral de Proyectos con indicadores de salud, resumen de riesgos, bloqueos, entregas próximas, búsqueda y orden por atención, fecha, progreso o valor, además de actualización periódica de cartera.
  - Ficha de proyecto estructurada (Resumen, Plan/Información, Trabajo, Gestión, Solicitudes, Economía, Documentos y Actividad) con URLs compartibles (`/proyectos/[id]`), portada de salud/progreso, logo propio (PNG/JPG/WebP) o heredado y PRD/definición ampliada.
  - Catálogo visual de stack tecnológico con categorías (incluyendo App móvil/escritorio y Plugins/streaming: Twitch, YouTube, OBS) y valores personalizados.
  - Registro de solicitudes y sugerencias por proyecto con tipo, solicitante, impacto, prioridad, responsable, estados de revisión, conversación y conversión trazable a tarea.
  - Subtareas agrupadas bajo su tarea padre con expansión/plegado, progreso agregado, arrastre en Kanban y herencia de alertas y valores efectivos (responsable/vencimiento) sin sobrescribir datos propios.
  - Columna **Validación** entre *En progreso* y *Hecho* (y separación entre «Validación» interna y «Validar cliente» con aviso por WhatsApp y aprobación/solicitud de cambios desde el portal).
  - Sprints híbridos en Trabajo: backlog y Kanban del sprint, refinamiento, Sprint Poker asistido por IA, capacidad humana/IA, revisor humano obligatorio, activación, revisión, retrospectiva, cierre e historial.
  - Documentación vinculada a cada proyecto (enlaces, rutas de archivos, notas internas) y capa extensible de almacenamiento documental con **Google Drive** (OAuth de un clic, renovación automática, credencial cifrada, carpeta configurable y subida drag & drop de hasta 20 MB).
  - Importación masiva de tareas y subtareas desde Markdown (ChatGPT) con fechas heredables/sobrescribibles y copia de tareas en formato encargo Markdown para IA.
  - Portal aislado para clientes (`/portal`) donde consultar resumen, hitos, facturas enviadas y tareas en lectura, validar entregables y crear o responder sus propias solicitudes.
  - Objetivo económico mensual por empresa/hito y gráfica mensual acumulada de facturación prevista vs registrada con hitos y márgenes (incluyendo saldo negativo).
  - Integración de tareas con **Orca** (`tools/orca-worker.mjs`): despacho desde ficha, cola RPC autenticada, worktree local y puente loopback para modo browser.
- **Facturación, Presupuestos y Finanzas:**
  - Facturación emitida separada de facturas recibidas: series por empresa, borradores editables, emisión inmutable con fecha de operación/vencimiento, cobros parciales en popup por método, anulación, rectificativas/abonos e impresión PDF con plantilla comercial.
  - Presupuestos (`/presupuestos`) con editor modal a pantalla completa, descuentos por línea y generales (% o fijo), ahorro mostrado en PDF comercial, conversión a factura y reapertura segura al anular facturas sin cobros ni abonos.
  - Bandeja de gastos y facturas recibidas (`/gastos`) con adjuntos PDF/imagen, revisión, pagos parciales y movimiento automático de Caja.
  - Módulo empresarial **Financiación** (`/financiacion`): subvenciones (a fondo perdido / reembolsables, comisión de gestión, sincronización de cobros con Caja), inversores, rondas pre-money/post-money con dilución del *cap table* y préstamos por empresa.
  - Cuestionario y perfil fiscal por empresa en Ajustes + cálculo real de modelos fiscales aplicables y borrador revisable del modelo 303 con exportación CSV (sin presentación ante la AEAT).
  - Preparación VERI\*FACTU local por empresa: registros de alta/anulación encadenados con SHA-256, URL de QR de pruebas, exportación JSON y comprobación local de integridad (no homologado ni conectado con AEAT).
  - Área administrativa **Personal** (`/personal`): fichas laborales aisladas por empresa y restringidas a administradores, registro de nóminas por periodo con documentación y pago conectado a Caja.
- **WhatsApp (GOWA), OCR y Recepción Documental:**
  - Integración por empresa/usuario mediante GOWA (QR por empresa, reutilización de sesión compartida, envío confirmado, resúmenes semanales y de tareas vencidas/próximas de 7 días).
  - Webhook firmado (`POST /api/whatsapp/webhook`) para clasificar documentos por encuesta/voto o texto y crear borradores de gastos o solicitudes de proyecto desde teléfonos autorizados, con transcripción de notas de voz (Whisper) y lectura OCR con modelo visual Ollama independiente.
  - Enlace público temporal `/recibir/[token]` (30 min, un solo uso, Open Graph) para confirmar tipo de documento y empresa destino desde WhatsApp.
- **Organización, Empresa y UI:**
  - Alta de empresas independientes desde Ajustes, ficha completa de Empresa (razón social, NIF/CIF, entidad, dirección, logo con marco Hexa), visión consolidada en Dashboard y foto de perfil de usuarios del equipo.
  - Selector de fechas HEXA unificado, selector de rango de dos meses en Facturas, ordenación en cabeceras de tablas principales (`SortableHeader`), inputs monetarios con separadores de miles en formato español, submenú lateral de Ventas (Facturas, Presupuestos, Servicios) y diálogos visuales que reemplazan `alert`/`confirm`/`prompt` nativos.
  - Zonas de carga con arrastrar y soltar en documentos, logos de proyecto y fotos de usuario.

### Changed

- `/proyectos`, la ficha de proyecto y el menú mantienen siempre visible la cartera completa aunque solo exista un proyecto (eliminada la redirección automática); el acceso a Proyectos pasa a depender del rol (usuarios internos también en empresas `shop`; clientes limitados a `/portal`).
- El Dashboard financiero separa valor de cartera, facturación por fecha de operación, cobros y subvenciones, financiación, gastos de Caja y disponible; los gastos de Caja no vinculados a proyecto computan en «Gastado».
- La configuración que antes era global (IVA, Ollama, objetivos, nombre de tienda y copias) se almacena por empresa con compatibilidad de lectura heredada y copias limitadas al tenant activo; el arranque central bloquea cualquier restauración destructiva.
- La navegación y las vistas distinguen entre productos propios, trabajos para cliente (catálogo de contactos de HEXA) y proyectos internos de grupo (empresa propietaria y herencia de logo).
- Los estados y tarjetas de Kanban muestran `inbox` como **Backlog**, Validación en azul, subtareas plegadas por defecto, ordenación por fecha de vencimiento (ISO completo), avatares de responsable y alertas heredadas amarillo/rojo; las tareas archivadas dejan de computar en el progreso.
- Cobertura completa de modo claro en modales, paneles de IA, tarjetas editoriales y superficies de Ventas, Trabajo, Caja y Ajustes; la carga diferida de pestañas de proyecto distingue entre «cargando» y «vacío».
- El asistente de puesta en marcha deja de abrirse automáticamente en cada navegador en modo central.
- Ventas sincroniza el libro de stock legado con `stock_balances` y refuerza validaciones de cantidades, precios, IVA, inventario, Caja (permitiendo fecha pasada) y estados de gastos.

### Fixed

- Corrige la tipificación de `$props()` en `src/routes/recibir/[token]/+page.svelte` para `svelte-check` 4.7.5 y alinea el campo `avatar_data_url` en `AuthUser`/`UserInput` de Tauri (`src-tauri/src/models.rs`), restaurando la compilación limpia de `cargo test --locked`.
- La ruta dinámica `/proyectos/[id]` queda registrada en el servidor Node sin prerenderado para que la recarga directa devuelva HTTP 200 en vez de 404/500.
- La recepción de facturas por WhatsApp funciona sin sesión web activa, tolera reintentos del webhook sin duplicar, conserva archivos originales en lecturas fallidas y caduca enlaces a los 30 minutos.
- La cartera de proyectos consulta las tareas desde la empresa propietaria/de tareas de cada proyecto interno (VOURA y empresas del grupo) y corrige tareas históricas asociadas al tenant incorrecto.
- Trabajo preselecciona al usuario conectado al filtrar y crear tareas/subtareas; los hitos económicos impiden repetir mes y siempre ofrecen 36 meses.
- Las tareas en Validación dejan de contarse como vencidas del responsable; el Kanban mantiene seis columnas visibles/desplazables, altura uniforme y cabeceras adherentes.
- Editar el teléfono propio actualiza la disponibilidad de WhatsApp QR al instante; las subidas a Google Drive muestran el documento arriba y limpian el selector al terminar; el resumen WhatsApp excluye registros sin fecha válida.

### Migration & Ops notes

- **PostgreSQL y browser store:** las migraciones del esquema PostgreSQL y del almacenamiento local se aplican automáticamente al iniciar; en PostgreSQL se crean perfiles fiscales y ajustes por defecto para todas las empresas activas.
- **Cloudflare D1 (`crm.nix-0.com`):** esta versión mantiene el despliegue estático + Worker D1 existente para salud, operador, usuarios y TPV/ventas básicas; los comandos RPC de `/proyectos`, `/trabajo`, facturación, gastos, personal y WhatsApp aún no están implementados en `workers/cloudflare/src/index.ts` (operan en modo local y Node+PostgreSQL central).
- **VERI\*FACTU:** el módulo incluido es exclusivamente preparación local (encadenado SHA-256 y QR de pruebas) y **no** sustituye una certificación ni realiza remisión automática a la AEAT.

---

## [0.3.3] — 2026-11-22

### Changed

- Actualiza Marked, Svelte Check, los tipos de Node y Wrangler, junto con las versiones de Tauri, su plugin de apertura, Rand, Rusqlite y Thiserror fijadas para escritorio.

## [0.3.2] — 2026-08-04

### Fixed

- En Ajustes web, la comprobación opcional de Ollama ya no bloquea el listado de usuarios administradores cuando el Worker no expone `ollama_health`.

## [0.3.1] — 2026-08-04

### Fixed

- El Worker Cloudflare/D1 ya implementa el acceso de operador y la administración de usuarios: listado, alta, edición, membresías de empresa y contraseñas temporales de 14 caracteres con cambio obligatorio en menos de 24 horas.
- El flujo de release estable inicializa recursivamente los submódulos de plugins antes de construir el bundle Cloudflare.

## [0.3.0] — 2026-07-30

### Added

- Módulo multiempresa Trabajo (fase 1): bandeja persistente y categorizada (`/trabajo`), migración browser store v6, esquema e índices PostgreSQL con RLS por tenant, captura de avisos desde el Dashboard y flag centralizado `supportsWorkManagement()`.

- Gestión de plugins por tenant en Ajustes, con activación y configuración independientes por empresa.
- Plugin de conexión PostgreSQL externa mediante referencias seguras a variables de entorno.
- Plugin Stripe MCP para el asistente, con lista cerrada de herramientas, auditoría y confirmación humana obligatoria para escrituras.
- Perfil Maestro con vista normal de empresas asignadas y despliegue explícito y autorizado de todos los tenants.
- Selector de proveedores guardados al crear o editar artículos, con alta rápida sin perder el formulario y conservación de proveedores históricos.
- Landing pública editorial y hero original para presentar el CRM antes del acceso.
- Shell: accesos rápidos con deep-link `?nuevo=1` (producto, cliente, caja, TPV) (#12).
- **Onboarding guiado** 1ª sesión: tienda → producto → CTA primera venta; se puede saltar (#11).
- **Cobertura de stock** (~días a ritmo de 14 d) en inventario y alertas del dashboard (#22).
- Tauri/SQLite: `return_sale_lines` con migración de devoluciones parciales, stock y caja netos (#24).
- Documentado el contrato de paridad RPC/Tauri para ventas y devoluciones (#24).
- Carga diferida de `AiDrawer` y `marked`: el shell no descarga IA antes de abrirla (#20).
- Bloqueo de sesión por inactividad configurable (15 min por defecto; 0 lo desactiva) y ajustes restringidos por rol (#21).
- Recordatorio de copia en dashboard, fecha persistente y validación de checksum antes de restaurar en modo local (#19).
- Modo claro persistente, tokens de contraste, movimiento reducido y guía del design system (#18).
- Vista local de reposición con cálculo por ventas, cantidades editables y CSV para proveedor (#16).
- TPV express con hasta ocho favoritos persistentes, chips táctiles y atajos F2/Esc (#15).
- Ficha de cliente con valor neto, frecuencia, última compra, segmento e inicio de venta preseleccionado (#17).
- Dashboard con deltas diarios, tendencia de siete días y alertas enlazadas (#13).
- Copiloto local con herramientas de ventas, stock y reposición basadas en datos reales (#14).
- Base de API central v1 con OpenAPI, health/readiness y receta PostgreSQL 18 + pgvector (#26).
- Índice semántico privado por tenant, sin clientes ni ventas, preparado para embeddings locales (#32).
- Catálogo central con estado de publicación y metadatos de producto para el tenant Meiga (#28).
- El despliegue central ya no inserta datos demo al migrar (#26).

### Changed
- Extraído e integrado el plugin `stripe_mcp` desde `vendor/hexa-crm-plugins` -> `plugins/stripe`, ambos pinneados por SHA de commit inmutable; `database_bridge` permanece in-tree (`src/lib/plugins/`). Se requiere `git submodule update --init --recursive` al sincronizar.
- Documentada la arquitectura de separación Host-plugins y la especificación del agregador `hexa-crm-plugins` compuesto por submódulos de Git pinneados a versiones estables.
- Cabecera autenticada adaptada al lenguaje editorial de la landing: contexto de área, selector de empresa custom, identidad de sesión y acciones responsive.
- Rediseño editorial completo del área autenticada: Pulso, Inventario, TPV e historial, Caja, Clientes, Impuestos y Ajustes comparten la jerarquía y estética de la landing.
- Onboarding, cambio forzado de contraseña, modales, estados vacíos, toasts y asistente IA se alinean con el mismo sistema visual y responsive.
- Rediseño integral del shell, navegación, login, tarjetas y sistema visual inspirado en una experiencia retail editorial.
- **Cerrar sesión** explícito en header y sidebar (sustituye «Bloquear»); toast al salir (#9).
- Navegación en **español de comercio** (#12).
- Naming comercial **Hexa** + tagline «Asistente de tienda · IA local opcional» en login/shell (#23). Package npm sigue `hexa-crm`.
- CI queda orientado a `main`; la protección documentada exige squash, revisión y el check `quality` (#1).

### Fixed
- El selector de empresa de la cabecera permanece por encima del contenido y permite pulsar todas las opciones del desplegable.

### Pendiente / backlog
- Dashboard de mando completo (#13) y copiloto IA con tools (#14)
- CRM valor cliente (#17), TPV favoritos (#15), reposición sugerida (#16)
- Settings por empresa (M1b)
- Design system light (#18); idle timeout (#21)


---

## [0.2.1-rc.2] — 2026-07-24

### Fixed
- **Aislamiento multiempresa crítico de productos en PostgreSQL/RPC:** Se corrigió un fallo por el cual `upsert_product()` no resolvía la empresa activa (`active_company_id`) de la sesión. Los `INSERT` no incluían `company_id` cayendo en el valor por defecto `1`, y los `UPDATE` filtraban exclusivamente por `id`. Con este fix, la creación, edición y ajuste de stock de productos operan siempre sobre el tenant activo de la sesión del usuario, rechazando modificaciones sobre productos de otros tenants e ignorando cualquier `company_id` recibido en el payload.


---

## [0.2.1-rc.1] - 2026-07-23

### Added
- Integración del agregador Stripe.

### Fixed
- Arreglo de Plugins en modo local.


---

## [0.2.0] — 2026-07-19

Primera release semántica completa del producto bajo el nombre canónico **hexa-crm**
(antes “Nix-C”). Incluye multi-empresa P0, devoluciones parciales, arqueo de caja,
reorganización de Ajustes y actualizaciones vía GitHub Releases.

### Added
- **Multi-empresa (Company Tenant P0):** empresas SHOP/DEV, membresías, switcher de empresa activa, filtrado de ventas/productos y helper de billing por empresa.
- **Devolución parcial de líneas** en historial de ventas (`return_sale_lines`): stock, caja e IVA netos; anular resto unificado.
- **Arqueo de caja:** contado físico vs saldo del sistema, descuadre (sobrante/faltante) y registro de movimiento categoría `arqueo`.
- **Actualizaciones desde GitHub** en Ajustes (buscar / abrir descarga de Releases).
- **Ajustes por categorías** (nav Cuenta → Tienda → Equipo → IA → Actualizaciones → Sistema) con zona de peligro separada.
- Servidor **MCP** `@hexa-nix/hexa-crm-mcp` con env `HEXA_CRM_*` (y legado `NIX_C_*`).
- Catálogo de producto `PRODUCT_NAME` / branding **hexa-crm**.
- Docs: `docs/UPDATE_FROM_GITHUB.md`, análisis multi-empresa, memoria de mejora continua (ciclos 7–9).

### Changed
- Nombre de producto y package npm: **hexa-crm** (UI, Tauri `productName`, MCP, backups `hexa-crm-backup`).
- Cierre de caja del día: incluye `partially_returned`, ventas netas en display y neto de caja sin doble restar reembolsos.
- `cancel_sale` devuelve unidades restantes (compatible con devoluciones parciales previas).
- Storage keys `hexa-crm-*` con lectura de legado `nix-c-*`.

### Fixed
- Integridad de totales/IVA/dashboard tras devoluciones parciales (browser-store y Postgres).
- Carga cognitiva de Ajustes (ya no es un monobloque de todos los paneles).

### Security / ops
- Identifier Tauri se mantiene `com.hexa.nixc` (no romper installs desktop).
- DB Postgres `nix_crm` y contenedor Docker `nix-c-postgres` se mantienen como alias operativos.
- Contenedores Incus `nix-c-web` / `nix-c-srv` (remoto `voura`) actualizados a este build.

### Migration notes
- Claves localStorage antiguas `nix-c-store-*` se migran al vuelo.
- Formato backup `nix-c-backup` sigue siendo restorable.
- Variables MCP: preferir `HEXA_CRM_URL` / `HEXA_CRM_AGENT_TOKEN`.

---

## [0.1.0] — 2026-07-19

Primera release pública (tag `v0.1.0`).

### Added
- CRM/TPV local-first: inventario, ventas, caja, clientes, IVA ES, IA Ollama.
- Auth con sesión/token y contraseñas temporales.
- Artefacto servidor `Nix-C-0.1.0-server.tgz` + `SHA256SUMS.txt` en GitHub Releases.
- Licencia MIT, docs de comunidad y aviso fiscal (no Veri*Factu homologado).

---

[Unreleased]: https://github.com/HEXA-NIX/hexa-crm/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/HEXA-NIX/hexa-crm/compare/v0.3.3...v0.4.0
[0.3.3]: https://github.com/HEXA-NIX/hexa-crm/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/HEXA-NIX/hexa-crm/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/HEXA-NIX/hexa-crm/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/HEXA-NIX/hexa-crm/compare/v0.2.1-rc.2...v0.3.0
[0.2.1-rc.2]: https://github.com/HEXA-NIX/hexa-crm/compare/v0.2.1-rc.1...v0.2.1-rc.2
[0.2.1-rc.1]: https://github.com/HEXA-NIX/hexa-crm/compare/v0.2.0...v0.2.1-rc.1
[0.2.0]: https://github.com/HEXA-NIX/hexa-crm/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/HEXA-NIX/hexa-crm/releases/tag/v0.1.0
