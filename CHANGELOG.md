# Changelog

Todos los cambios relevantes del producto **hexa-crm** se documentan aquí.
El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y este proyecto usa [Versionado Semántico](https://semver.org/lang/es/).

> **Regla de equipo (desde 0.2.0):** ninguna release se publica sin entrada en este archivo.
> Ver proceso en [`docs/RELEASES.md`](./docs/RELEASES.md).

## [Unreleased]

### Added

- Primera base de la bandeja de gastos y facturas recibidas: adjuntos PDF/imagen, revisión, proyecto asociado y aprobación que genera el movimiento de Caja.
- Webhook firmado de WhatsApp para convertir mensajes con documentos en borradores de gastos por empresa y usuario.
- Botón «Leer WhatsApp» para consultar multimedia de GOWA, descargar la última foto/documento y extraer sus datos mediante un modelo de visión Ollama antes de crear el borrador.
- Primera fase fiscal: perfil fiscal por empresa, IVA repercutido y soportado, retenciones y borrador revisable del modelo 303 con exportación CSV. No realiza presentación ante la AEAT.

### Fixed

- La página Trabajo selecciona inicialmente al usuario conectado en el filtro de responsable, sin impedir cambiar después a otro usuario o a todos.
- Los hitos económicos no permiten repetir mes y, después de elegir uno, los siguientes selectores solo ofrecen meses posteriores disponibles.
- Las tareas entregadas en Validación dejan de contarse como pendientes o vencidas del responsable y no aparecen en sus avisos operativos; permanecen separadas como trabajo pendiente de revisión.

- El Kanban de proyectos distribuye correctamente sus seis columnas; «Hecho» permanece visible en escritorio y accesible mediante desplazamiento horizontal en pantallas más estrechas.

- El resumen de tareas por WhatsApp excluye estrictamente registros sin fecha o con fechas no válidas.
- Al editar el teléfono del usuario que tiene la sesión iniciada, la sección WhatsApp actualiza inmediatamente el perfil y habilita la conexión QR sin exigir volver a iniciar sesión.
- La subida de documentación de proyectos a Google Drive muestra ahora la ficha recién creada al principio, permite editar inmediatamente su título, limpia el selector al finalizar y presenta los errores dentro del formulario.

### Added

- Las zonas de subida de documentos, logos de proyecto y fotos de usuario aceptan ahora arrastrar y soltar, con realce visual y las mismas validaciones de formato y tamaño.
- Cada proyecto incorpora un registro de solicitudes y sugerencias con tipo, solicitante, impacto, prioridad, responsable, estados de revisión, conversación y conversión trazable a tarea.
- Al crear tareas, subtareas, capturas rápidas o importaciones, se preselecciona como responsable al usuario que mantiene la sesión iniciada.
- El stack de cada proyecto usa un catálogo visual con logos, selección rápida y valores personalizados; añade categorías específicas para App móvil/escritorio y Plugins/streaming, incluyendo Twitch, YouTube y OBS.
- El flujo de tareas incorpora una columna de Validación entre En progreso y Hecho, con historial de comentarios, solicitud de cambios y aprobación; no se permite completar una tarea sin pasar antes por revisión.
- Los usuarios del equipo pueden tener una foto de perfil propia, editable desde Ajustes → Equipo y visible en el listado de miembros.
- Cada proyecto admite una imagen/logo propia (PNG, JPG o WebP) y el resumen semanal por WhatsApp agrupa el avance por proyecto, muestra actividad de los últimos siete días y enlaza directamente a sus tareas pendientes.

- El panel de proyectos permite enviar al WhatsApp del admin un resumen confirmado de tareas vencidas y de los próximos siete días, dividido en mensajes legibles con fecha, prioridad, proyecto y enlace a Hexa CRM.
- Integración inicial de WhatsApp mediante GOWA: teléfono internacional por usuario, sesión QR aislada por empresa/usuario, estado, desconexión y envío individual con confirmación y auditoría; el modo local incorpora un puente de pruebas sin PostgreSQL.
- Cada proyecto puede reunir documentación mediante enlaces, rutas de archivos y notas internas, con gestión administrativa y persistencia local/PostgreSQL.
- La ficha de proyecto incorpora un PRD con formato y un stack tecnológico estructurado para centralizar la definición funcional y técnica.
- La definición de proyecto se amplía con resumen, problema, objetivos, usuarios, alcance, requisitos, aceptación, riesgos, dependencias y métricas; la vista rápida agrupa frontend, backend, datos, infraestructura, despliegue, integraciones, IA y herramientas, con accesos a repositorio y entornos.
- Los modales de edición de proyectos, tareas, definición, documentación e importación usan anchos amplios adaptados a formularios complejos.
- Capa extensible de almacenamiento documental con Google Drive como primer proveedor: conexión OAuth de un solo clic, renovación automática, credencial cifrada, carpeta configurable y subida de ficheros de hasta 20 MB desde la ficha del proyecto.

- Integración inicial de tareas con Orca: despacho desde la ficha, cola RPC autenticada, worker local con worktree Codex y cierre automático condicionado a tests, build y commit.
- Ajustes incorpora una sección administrativa de Orca para guardar la configuración local no sensible y copiar el comando de arranque sin persistir el token de sesión.
- El worker Orca admite tareas del modo browser/localStorage mediante un puente emparejado en loopback, con origen restringido y sincronización automática del resultado en la página de proyecto.
- La economía de cada proyecto incorpora una gráfica mensual acumulada y compacta que compara la facturación prevista con la registrada, ofrece detalle al pasar el cursor y sitúa los hitos junto a la gráfica.
- Cada tarea principal puede copiarse junto con su descripción y subtareas como un encargo Markdown listo para enviar a una IA.
- El detalle de un proyecto permite pegar listas de ChatGPT en Markdown, incluir descripciones, previsualizar su estructura y crear de una vez todas las tareas y subtareas detectadas.
- Al pegar tareas se puede asignar una fecha de entrega común; las subtareas la heredan y cada elemento puede sobrescribirla con `Fecha: AAAA-MM-DD`.
- Home y Proyectos permiten definir un objetivo económico por empresa y mes, seguir el porcentaje alcanzado con ingresos reales y consultar más indicadores de avance de la cartera.
- El portafolio de Proyectos incorpora indicadores de salud, resumen de riesgos, bloqueos y entregas próximas, además de búsqueda y orden por atención, fecha, progreso o valor.
- El detalle de cada proyecto muestra señales operativas de tareas vencidas, urgentes, próximas y sin responsable.
- Las descripciones de proyectos, tareas y subtareas admiten negrita, cursiva y listas mediante un editor ligero con vista previa y renderizado seguro.
- Las subtareas se presentan agrupadas bajo su tarea padre, con expansión, progreso agregado y filas compactas tanto en lista como en kanban.
- En kanban, las subtareas vuelven a ser arrastrables entre estados, muestran título y descripción al pasar el cursor y comparten el código de color de las columnas.
- Las acciones compactas de las tarjetas Kanban se colocan bajo el título para no desbordar las columnas en anchos responsive.
- Caja permite indicar la fecha de un nuevo movimiento para registrar ingresos y gastos pasados, también en PostgreSQL.
- El panel central incluye en «Gastado» todos los gastos de Caja, aunque no estén vinculados a un proyecto, y los descuenta del margen facturado.
- Los márgenes negativos se muestran con signo y color rojo; el gráfico mensual representa los gastos como barras rojas bajo una línea de cero proporcional al rango real.

### Changed

- Las tarjetas del listado de proyectos muestran un logo compacto y usan la inicial del proyecto cuando todavía no se ha cargado una imagen.
- Las tareas que vencen en siete días o menos se destacan en amarillo; las vencidas permanecen en rojo y la tarea principal hereda la alerta más grave de cualquiera de sus subtareas.
- Una tarea principal se marca visualmente en peligro cuando cualquiera de sus subtareas está bloqueada o vencida, mostrando el origen del riesgo en la propia tarjeta.
- El estado técnico `inbox` se presenta como «Backlog», siguiendo la nomenclatura habitual de Kanban, y Validación adopta una identidad visual azul en columna, etiquetas, chat y avatares.
- Las subtareas aparecen plegadas por defecto al entrar en un proyecto y se despliegan bajo demanda mediante la flecha de su tarea principal.
- Las tareas se ordenan consistentemente desde la fecha de vencimiento más próxima hasta la más lejana, dejando las que no tienen fecha al final; las tareas y subtareas abiertas que ya han vencido se resaltan en rojo.
- Las tareas y subtareas muestran el avatar del responsable en lugar de su nombre; cuando no existe una foto se utiliza su inicial y el nombre permanece disponible como ayuda accesible.

- El progreso de proyectos y del portafolio excluye las tareas archivadas del total para no penalizar artificialmente los porcentajes.
- El portafolio excluye proyectos archivados de sus indicadores operativos; los formularios validan fechas e importes, y la planificación económica ofrece siempre 36 meses.
- Proyectos conserva filtros y vista preferida, permite limpiar filtros, muestra archivados correctamente y adapta el Kanban a móvil y navegación sin arrastre.
- El detalle de proyecto permite ocultar o mostrar todas las subtareas de una vez y plegar cada tarea padre individualmente tanto en Lista como en Kanban.
- La barra de tareas separa los controles de visualización y las acciones de edición en dos filas responsive para acompañar mejor a los filtros.
- La ficha muestra inicialmente las estadísticas de economía y salud, permite plegarlas manualmente y diferencia valor contratado, cobros, gastos y resultado de caja.
- El detalle de proyecto deja de mostrar la acción de archivado para evitar confundirla con una eliminación definitiva.
- Los administradores pueden seleccionar y eliminar varias tareas o todas las tareas de un proyecto, con confirmación previa y sin borrar el proyecto.
- Las columnas del kanban de proyecto igualan su altura con la columna más larga para facilitar el movimiento de tareas entre estados.
- Las cabeceras de estado del kanban permanecen visibles durante el desplazamiento vertical.

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

[Unreleased]: https://github.com/HEXA-NIX/hexa-crm/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/HEXA-NIX/hexa-crm/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/HEXA-NIX/hexa-crm/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/HEXA-NIX/hexa-crm/compare/v0.2.1-rc.2...v0.3.0
[0.2.1-rc.2]: https://github.com/HEXA-NIX/hexa-crm/compare/v0.2.1-rc.1...v0.2.1-rc.2
[0.2.1-rc.1]: https://github.com/HEXA-NIX/hexa-crm/compare/v0.2.0...v0.2.1-rc.1
[0.2.0]: https://github.com/HEXA-NIX/hexa-crm/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/HEXA-NIX/hexa-crm/releases/tag/v0.1.0
