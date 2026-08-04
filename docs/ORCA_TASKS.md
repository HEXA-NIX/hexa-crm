# Integración de tareas con Orca

Hexa puede entregar tareas principales a un worker local que crea un worktree en Orca, lanza Codex y devuelve el resultado al CRM mediante la API RPC autenticada.

## Alcance del MVP

El flujo está disponible en los dos modos web:

- PostgreSQL/RPC: el worker reclama una cola central autenticada.
- Browser/localStorage: la página se empareja con un puente HTTP limitado a `127.0.0.1`, envía el encargo y sincroniza el resultado con el navegador.

Tauri queda fuera del MVP.

Estados utilizados en `work_items.source_type`:

| Estado Hexa | `source_type` | Significado |
|---|---|---|
| Planificado | `orca_queued` | Pendiente de ser reclamada |
| En progreso | `orca_running` | Worktree y agente iniciados |
| Hecho | `orca_completed` | Tests, build y commit verificados |
| Bloqueado | `orca_failed` | Orca, el agente o una verificación fallaron |

`source_href` conserva el identificador completo del worktree de Orca. Durante la cola y ejecución, `source_key` identifica la ejecución; al completar contiene el SHA del commit y, al fallar, un resumen del error.

## Requisitos

- Hexa CRM web accesible desde el equipo local.
- Orca instalado y con el repositorio registrado.
- Rama local `dev` actualizada.
- Dependencias del proyecto instaladas o setup de Orca configurado.
- Token de una sesión administrativa de Hexa limitado a la empresa que ejecutará el worker.

## Configuración

Define las variables en un archivo local no versionado o en el gestor de servicios del sistema:

```bash
HEXA_CRM_URL=https://crm.example.com
HEXA_CRM_AGENT_TOKEN=token_de_sesion
HEXA_ORCA_COMPANY_ID=1
HEXA_ORCA_REPO_PATH=/ruta/absoluta/hexa-crm
HEXA_ORCA_BASE_BRANCH=dev
```

Opcionales:

```bash
HEXA_ORCA_POLL_MS=10000
HEXA_ORCA_TIMEOUT_MS=3600000
HEXA_ORCA_ONCE=1
ORCA_CLI_COMMAND=orca
```

No guardes `HEXA_CRM_AGENT_TOKEN` en Git. Para producción se recomienda crear un usuario técnico administrador dedicado y rotar su sesión periódicamente. El siguiente paso de endurecimiento es sustituir esta sesión por una credencial de servicio con permisos exclusivos sobre la cola Orca.

### Modo localStorage

En `Ajustes → Orca`:

1. Comprueba la ruta local del repositorio.
2. Pulsa «Generar» para crear una clave de emparejamiento de sesión.
3. Pulsa «Guardar en este equipo».
4. Pulsa «Copiar y arrancar» y ejecuta el comando copiado en un terminal.

El comando local tiene esta forma:

```bash
HEXA_ORCA_BRIDGE_TOKEN=clave_emparejada \
HEXA_ORCA_BRIDGE_PORT=4765 \
HEXA_ORCA_REPO_PATH=/ruta/absoluta/hexa-crm \
HEXA_ORCA_BASE_BRANCH=dev \
npm run orca:worker
```

La clave se conserva solo en `sessionStorage`. El puente escucha exclusivamente en loopback, valida el origen del navegador y exige la cabecera de emparejamiento en cada petición.

## Ejecución

```bash
npm run orca:worker
```

El worker:

1. Consulta tareas `orca_queued` mediante `/api/rpc`.
2. Cambia la tarea a `in_progress`.
3. Abre Orca si es necesario.
4. Crea un worktree independiente desde `dev` y lanza Codex con el encargo completo.
5. Espera a que el agente quede inactivo.
6. Ejecuta `npm test` y `npm run build` dentro del worktree.
7. Comprueba que el worktree esté limpio y exista al menos un commit nuevo respecto a `dev`.
8. Marca tarea y subtareas como `done`, o deja la principal en `blocked` si falla cualquier paso.

El worker nunca hace push ni merge. El worktree queda disponible en Orca para revisión humana y posterior PR hacia `dev`.

## Operación segura

- Ejecuta una sola instancia del worker por empresa o navegador en este MVP.
- El título y la descripción se pasan como argumentos al CLI, nunca mediante un shell.
- No se ejecutan comandos suministrados desde la tarea; las verificaciones están fijadas a `npm test` y `npm run build`.
- Un final de respuesta del agente no basta para completar: se exige verificación y commit.
- Si Orca no arranca, expira el tiempo o Codex deja cambios sin confirmar, la tarea queda bloqueada.

## Recuperación

Una tarea bloqueada puede editarse y volver a enviarse con «Enviar a Orca». Esto crea un identificador de ejecución nuevo. Antes de reintentar, revisa el worktree indicado en `source_href` y elimina o conserva ese trabajo manualmente desde Orca.
