<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api/client";
  import type { PluginAuditLogEntry, PluginConfig, PluginKey, TenantPlugin } from "$lib/types";
  import Badge from "./Badge.svelte";
  import Button from "./Button.svelte";
  import Select from "./Select.svelte";
  import { showToast } from "$lib/stores/ui";
  import { isAdmin } from "$lib/stores/session";
  import { connectGoogleDrive, disconnectGoogleDrive, googleDriveStatus, testGoogleDriveConnection } from "$lib/storage/google-drive-client";

  let plugins = $state<TenantPlugin[]>([]);
  let busy = $state<PluginKey | null>(null);
  let testing = $state<PluginKey | null>(null);
  let loading = $state(true);
  let googleConnected = $state(false);
  let googleConnecting = $state(false);
  let whatsappStatus = $state<{ connected: boolean; logged_in: boolean; user_phone?: string; configured_phone?: string; shared_from_company_name?: string | null } | null>(null);
  let whatsappLinks = $state<{ company_id: number; trade_name: string; phone: string }[]>([]);
  let selectedWhatsAppCompany = $state("");
  let whatsappQr = $state("");
  let whatsappBusy = $state(false);
  let whatsappError = $state("");
  let whatsappExpanded = $state(false);
  let whatsappForm = $state({ phone: "", message: "", confirmed: false });
  let credentialInputs = $state<Record<PluginKey, string>>({
    database_bridge: "",
    stripe_mcp: "",
    google_drive: "",
  });

  let logsMap = $state<Record<PluginKey, PluginAuditLogEntry[]>>({
    database_bridge: [],
    stripe_mcp: [],
    google_drive: [],
  });
  let logsOpen = $state<Record<PluginKey, boolean>>({
    database_bridge: false,
    stripe_mcp: false,
    google_drive: false,
  });
  let loadingLogs = $state<Record<PluginKey, boolean>>({
    database_bridge: false,
    stripe_mcp: false,
    google_drive: false,
  });

  const statusLabel = (plugin: TenantPlugin) => plugin.plugin_key === "google_drive" && plugin.enabled
    ? (googleConnected ? "Preparado" : "Sin conectar")
    : ({
    inactive: "Inactivo",
    needs_secret: "Falta secreto",
    ready: "Preparado",
    error: "Con error",
  })[plugin.status];

  const statusTone = (plugin: TenantPlugin): "ok" | "warn" | "danger" | "neutral" => plugin.plugin_key === "google_drive" && plugin.enabled
    ? (googleConnected ? "ok" : "warn")
    : ({
    inactive: "neutral",
    needs_secret: "warn",
    ready: "ok",
    error: "danger",
  })[plugin.status] as "ok" | "warn" | "danger" | "neutral";

  /** Brand marks are inline so the settings screen works offline and in Tauri. */
  function pluginLogo(key: PluginKey | "whatsapp_gowa") {
    if (key === "whatsapp_gowa") {
      return `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><circle cx="16" cy="15" r="10" fill="#25d366"/><path d="m10.2 24 1.3-3.5A9.8 9.8 0 1 1 16 25.2c-1.1 0-2.2-.2-3.2-.5L10.2 24Z" fill="#25d366"/><path d="M12.2 11.5c.3-.6.6-.6 1.1-.6h.5c.3 0 .5.1.7.5l.8 1.9c.1.3.1.5-.1.7l-.6.8c-.1.2-.2.3 0 .6.4.7 1.1 1.4 1.8 1.8.3.2.5.2.7 0l.8-.9c.2-.2.4-.2.7-.1l1.9.9c.3.1.4.3.4.6 0 .7-.3 1.3-.8 1.7-.5.4-1.1.5-1.8.3-1.2-.4-2.4-1.2-3.5-2.2-1-.9-1.8-2-2.3-3.2-.3-.8-.4-1.6-.1-2.3Z" fill="white"/></svg>`;
    }
    if (key === "stripe_mcp") {
      return `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="8" fill="#635bff"/><path d="M9 12.2c0-2.2 1.8-3.5 4.7-3.5 2.1 0 3.7.5 4.9 1.1v3.1c-1.3-.7-2.8-1.2-4.4-1.2-1 0-1.6.3-1.6.9 0 .5.5.7 2.1 1.1 3.1.7 4.7 1.8 4.7 4.3 0 2.5-2 3.7-4.9 3.7-2.1 0-4.2-.6-5.5-1.4v-3.2c1.6.9 3.5 1.5 5.3 1.5 1 0 1.6-.3 1.6-.9 0-.5-.5-.8-2.1-1.2C10.4 15.8 9 14.8 9 12.2Z" fill="white"/></svg>`;
    }
    if (key === "google_drive") {
      return `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M12 5h7l8 14h-7L12 5Z" fill="#0f9d58"/><path d="M12 5 5 17l3.5 6L16 11l3-6h-7Z" fill="#f4b400"/><path d="M8.5 23h14l4.5-4H10.8L8.5 23Z" fill="#4285f4"/></svg>`;
    }
    return `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M7 23c-.8-3.4.5-7.1 3.8-8.9-.3-4.5 2.4-7.6 6.5-7.6 3.7 0 6.2 2.1 6.8 5.4 2.1.5 3.7 2.2 3.7 4.6 0 2.9-2.2 5-5.2 5H12c-2.1 0-3.9.6-5 1.5Z" fill="#336791"/><circle cx="20.7" cy="12.2" r="1.3" fill="white"/><path d="M10.2 16.5c1.4 1.3 2.2 3.1 2 5.2M23.6 16.3c-1 1-1.5 2.4-1.4 4" fill="none" stroke="#d7e9f5" stroke-width="1.4" stroke-linecap="round"/></svg>`;
  }

  const actionLabel = (action: string) => {
    switch (action) {
      case "enabled_or_updated":
      case "enabled":
        return "Configuración activada / guardada";
      case "disabled":
        return "Plugin desactivado";
      case "secret_removed":
        return "Credencial eliminada";
      case "connection_test_ok":
      case "test_ok":
        return "Prueba de conexión correcta";
      case "connection_test_failed":
      case "test_failed":
        return "Prueba de conexión fallida";
      case "tool_requested":
        return "Solicitud de herramienta";
      case "tool_blocked_permission":
        return "Bloqueado por permisos";
      case "tool_blocked_approval":
        return "Bloqueado por confirmación";
      case "tool_write":
        return "Escritura por herramienta";
      case "tool_read":
      case "tool_success":
        return "Lectura por herramienta";
      case "tool_error":
        return "Error en herramienta";
      default:
        return action;
    }
  };

  const resultTone = (result: string): "ok" | "warn" | "danger" | "neutral" => {
    switch (result) {
      case "ok":
        return "ok";
      case "blocked":
        return "warn";
      case "error":
        return "danger";
      default:
        return "neutral";
    }
  };

  const resultLabel = (result: string) => {
    switch (result) {
      case "ok":
        return "Éxito";
      case "blocked":
        return "Bloqueado";
      case "error":
        return "Error";
      default:
        return result;
    }
  };

  function formatDate(iso: string | null | undefined): string {
    if (!iso) return "Sin datos";
    try {
      const d = new Date(iso);
      return d.toLocaleString("es-ES", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return String(iso);
    }
  }

  async function loadLogs(key: PluginKey) {
    loadingLogs[key] = true;
    try {
      logsMap[key] = await api.listPluginLogs(key, 20);
    } catch {
      logsMap[key] = [];
    } finally {
      loadingLogs[key] = false;
    }
  }

  function toggleLogs(key: PluginKey) {
    logsOpen[key] = !logsOpen[key];
    if (logsOpen[key]) {
      loadLogs(key);
    }
  }

  async function load() {
    loading = true;
    try {
      plugins = await api.listPlugins();
      try {
        googleConnected = (await googleDriveStatus()).connected;
      } catch {
        googleConnected = false;
      }
      for (const p of plugins) {
        if (logsOpen[p.plugin_key]) {
          await loadLogs(p.plugin_key);
        }
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudieron cargar los plugins", "err");
    } finally {
      loading = false;
    }
  }

  async function connectDrive() {
    googleConnecting = true;
    try {
      await connectGoogleDrive();
      googleConnected = true;
      showToast("Google Drive conectado");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudo conectar Google Drive", "err");
    } finally {
      googleConnecting = false;
    }
  }

  async function disconnectDrive() {
    googleConnecting = true;
    try {
      await disconnectGoogleDrive();
      googleConnected = false;
      showToast("Google Drive desconectado");
    } finally {
      googleConnecting = false;
    }
  }

  async function persist(plugin: TenantPlugin, enabled = plugin.enabled) {
    busy = plugin.plugin_key;
    try {
      const saved = await api.updatePlugin(plugin.plugin_key, enabled, plugin.config);
      plugins = plugins.map((item) => item.plugin_key === saved.plugin_key ? saved : item);
      showToast(enabled ? "Plugin guardado para esta empresa" : "Plugin desactivado para esta empresa");
      if (logsOpen[plugin.plugin_key]) {
        await loadLogs(plugin.plugin_key);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudo guardar", "err");
      await load();
    } finally {
      busy = null;
    }
  }

  async function handleSecretAction(plugin: TenantPlugin, action: "save" | "replace" | "remove") {
    if (action !== "remove" && !credentialInputs[plugin.plugin_key].trim()) {
      showToast("Debes ingresar una credencial válida", "err");
      return;
    }
    busy = plugin.plugin_key;
    try {
      const saved = await api.updatePlugin(
        plugin.plugin_key,
        plugin.enabled,
        plugin.config,
        action,
        action === "remove" ? undefined : credentialInputs[plugin.plugin_key].trim(),
      );
      credentialInputs[plugin.plugin_key] = "";
      plugins = plugins.map((item) => (item.plugin_key === saved.plugin_key ? saved : item));
      const msg =
        action === "remove"
          ? "Credencial quitada con éxito"
          : action === "replace"
            ? "Credencial reemplazada con éxito"
            : "Credencial guardada con éxito";
      showToast(msg);
      if (logsOpen[plugin.plugin_key]) {
        await loadLogs(plugin.plugin_key);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudo actualizar la credencial", "err");
    } finally {
      busy = null;
    }
  }

  async function toggle(plugin: TenantPlugin) {
    await persist(plugin, !plugin.enabled);
  }

  async function test(plugin: TenantPlugin) {
    testing = plugin.plugin_key;
    try {
      const result = plugin.plugin_key === "google_drive"
        ? await testGoogleDriveConnection()
        : await api.testPlugin(plugin.plugin_key);
      showToast(result.message);
      await load();
      if (logsOpen[plugin.plugin_key]) {
        await loadLogs(plugin.plugin_key);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "La conexión falló", "err");
      await load();
      if (logsOpen[plugin.plugin_key]) {
        await loadLogs(plugin.plugin_key);
      }
    } finally {
      testing = null;
    }
  }

  function updateConfig(plugin: TenantPlugin, patch: PluginConfig) {
    plugin.config = { ...plugin.config, ...patch };
  }

  async function loadWhatsAppStatus() {
    try {
      const [status, links] = await Promise.all([api.whatsappStatus(), api.whatsappAvailableLinks()]);
      whatsappStatus = status;
      whatsappLinks = links;
      if (!links.some((link) => String(link.company_id) === selectedWhatsAppCompany)) {
        selectedWhatsAppCompany = links[0] ? String(links[0].company_id) : "";
      }
    } catch {
      whatsappStatus = null;
      whatsappLinks = [];
    }
  }

  async function connectWhatsApp() {
    whatsappBusy = true;
    whatsappError = "";
    try {
      const result = await api.whatsappLoginQr();
      whatsappQr = result.qr_data || result.qr_url;
      whatsappExpanded = true;
    } catch (error) {
      whatsappError = error instanceof Error ? error.message : "No se pudo generar el QR";
    } finally {
      whatsappBusy = false;
    }
  }

  async function disconnectWhatsApp() {
    whatsappBusy = true;
    whatsappError = "";
    try {
      await api.whatsappLogout();
      whatsappQr = "";
      await loadWhatsAppStatus();
    } catch (error) {
      whatsappError = error instanceof Error ? error.message : "No se pudo desconectar WhatsApp";
    } finally {
      whatsappBusy = false;
    }
  }

  async function useSharedWhatsApp() {
    const sourceCompanyId = Number(selectedWhatsAppCompany);
    if (!Number.isInteger(sourceCompanyId) || whatsappBusy) return;
    whatsappBusy = true;
    whatsappError = "";
    try {
      await api.whatsappUseSharedLink(sourceCompanyId);
      await loadWhatsAppStatus();
    } catch (error) {
      whatsappError = error instanceof Error ? error.message : "No se pudo usar ese número";
    } finally {
      whatsappBusy = false;
    }
  }

  async function sendWhatsApp() {
    whatsappBusy = true;
    whatsappError = "";
    try {
      await api.whatsappSend(whatsappForm.phone, whatsappForm.message, whatsappForm.confirmed);
      whatsappForm = { phone: "", message: "", confirmed: false };
    } catch (error) {
      whatsappError = error instanceof Error ? error.message : "No se pudo enviar el WhatsApp";
    } finally {
      whatsappBusy = false;
    }
  }

  onMount(() => {
    load();
    loadWhatsAppStatus();
  });
</script>

<section class="space-y-4" data-plugin-manager>
  <div class="rounded-2xl border border-purple-400/20 bg-purple-500/[0.06] px-4 py-3">
    <p class="text-sm font-medium text-[var(--color-purple-bright)]">Plugins por empresa</p>
    <p class="mt-1 text-xs leading-relaxed text-[var(--color-muted)]">
      La activación y la configuración pertenecen únicamente a la empresa seleccionada. Las credenciales de Stripe y Google Drive se cifran con AES-256-GCM en el servidor y nunca se devuelven a la interfaz. En modo navegador local, el token de Drive solo permanece en la sesión de la pestaña.
    </p>
  </div>

  {#if loading}
    <div class="rounded-2xl border border-[var(--color-border)] bg-black/20 px-5 py-10 text-center text-sm text-[var(--color-muted)]">
      Cargando plugins…
    </div>
  {:else}
    <div class="grid gap-4 xl:grid-cols-2">
      <article
        class="relative overflow-hidden rounded-2xl border p-5 transition {whatsappStatus?.connected || whatsappStatus?.logged_in
          ? 'border-emerald-400/30 bg-emerald-500/[0.06] shadow-[0_0_28px_rgba(16,185,129,0.08)]'
          : 'border-[var(--color-border)] bg-black/20'}"
        data-plugin-key="whatsapp_gowa"
        data-plugin-enabled={whatsappStatus?.connected || whatsappStatus?.logged_in}
      >
        <div class="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-emerald-500/10 blur-3xl"></div>
        <div class="relative">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="mb-2 flex flex-wrap items-center gap-2">
                <span class="plugin-logo flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-1.5">
                  {@html pluginLogo("whatsapp_gowa")}
                </span>
                <div>
                  <h3 class="font-semibold text-[var(--color-text)]">WhatsApp</h3>
                  <p class="text-[0.65rem] uppercase tracking-[0.16em] text-[var(--color-muted-dim)]">mensajería</p>
                </div>
                <Badge tone={whatsappStatus?.connected || whatsappStatus?.logged_in ? "ok" : "warn"}>
                  {whatsappStatus?.connected || whatsappStatus?.logged_in ? "Preparado" : "Sin conectar"}
                </Badge>
              </div>
              <p class="max-w-xl text-sm leading-relaxed text-[var(--color-muted)]">Recibe tickets y facturas, envía avisos y comparte un número entre empresas sin mezclar sus datos.</p>
            </div>
            <Button variant="secondary" class="shrink-0" onclick={() => (whatsappExpanded = !whatsappExpanded)}>
              {whatsappExpanded ? "Ocultar" : "Configurar"}
            </Button>
          </div>
          {#if whatsappStatus?.connected || whatsappStatus?.logged_in}
            <div class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] px-3 py-2.5 text-sm">
              <span class="text-emerald-100">Número conectado: <strong>{whatsappStatus.user_phone || "detectado por WhatsApp"}</strong></span>
              <Button variant="danger" disabled={whatsappBusy} onclick={disconnectWhatsApp}>Desconectar</Button>
            </div>
          {:else if whatsappStatus?.configured_phone}
            <div class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.05] px-3 py-2.5 text-sm">
              <span class="text-amber-100">Número configurado: <strong>{whatsappStatus.configured_phone}</strong><span class="ml-2 text-amber-200/70">Sesión desconectada</span></span>
              <Button disabled={whatsappBusy} onclick={connectWhatsApp}>{whatsappBusy ? "Preparando…" : "Reconectar con QR"}</Button>
            </div>
          {:else}
            <div class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.05] px-3 py-2.5 text-sm">
              <span class="text-amber-100">No hay un número conectado ahora mismo.</span>
              <Button disabled={whatsappBusy} onclick={connectWhatsApp}>{whatsappBusy ? "Preparando…" : "Conectar con QR"}</Button>
            </div>
          {/if}
          {#if whatsappExpanded}
            <div class="mt-4 space-y-3 border-t border-[var(--color-border)] pt-4" data-whatsapp-inline-settings>
              {#if !(whatsappStatus?.connected || whatsappStatus?.logged_in) && whatsappLinks.length > 0}
                <Select
                  label="Usar un número ya vinculado en otra empresa"
                  bind:value={selectedWhatsAppCompany}
                  options={whatsappLinks.map((link) => ({ value: String(link.company_id), label: `${link.trade_name} · ${link.phone}` }))}
                  placeholder="Seleccionar empresa…"
                  disabled={whatsappBusy}
                />
                <Button variant="secondary" disabled={whatsappBusy || !selectedWhatsAppCompany} onclick={useSharedWhatsApp}>Usar este número</Button>
              {/if}
              {#if whatsappQr}
                <div class="rounded-xl border border-emerald-400/25 bg-white p-3 text-center">
                  <img src={whatsappQr} alt="Código QR para vincular WhatsApp" class="mx-auto h-56 w-56 object-contain" />
                  <p class="mt-2 text-xs text-slate-700">WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
                </div>
              {/if}
              {#if whatsappStatus?.connected || whatsappStatus?.logged_in}
                <form class="grid gap-2" onsubmit={(event) => { event.preventDefault(); sendWhatsApp(); }}>
                  <input class="field w-full" bind:value={whatsappForm.phone} placeholder="Destinatario +34…" required />
                  <textarea class="field min-h-20 w-full" maxlength="4000" bind:value={whatsappForm.message} placeholder="Mensaje" required></textarea>
                  <label class="flex items-start gap-2 text-xs text-[var(--color-muted)]"><input class="mt-0.5" type="checkbox" bind:checked={whatsappForm.confirmed} /> Confirmo el envío desde el WhatsApp de la empresa.</label>
                  <div><Button type="submit" disabled={whatsappBusy || !whatsappForm.confirmed}>{whatsappBusy ? "Enviando…" : "Enviar WhatsApp"}</Button></div>
                </form>
              {/if}
              {#if whatsappError}<p class="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-200" role="alert">{whatsappError}</p>{/if}
            </div>
          {/if}
          <div class="mt-4 flex flex-wrap gap-2 text-xs text-[var(--color-muted)]">
            <span class="rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] px-2.5 py-1">Conectar por QR</span>
            <span class="rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] px-2.5 py-1">Recepción documental</span>
            <span class="rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] px-2.5 py-1">Números compartidos</span>
          </div>
        </div>
      </article>
      {#each plugins as plugin (plugin.plugin_key)}
        <article
          class="relative overflow-hidden rounded-2xl border p-5 transition {plugin.enabled
            ? 'border-purple-400/30 bg-purple-500/[0.07] shadow-[0_0_28px_rgba(147,51,234,0.08)]'
            : 'border-[var(--color-border)] bg-black/20'}"
          data-plugin-key={plugin.plugin_key}
          data-plugin-enabled={plugin.enabled}
        >
          <div class="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-fuchsia-500/10 blur-3xl"></div>
          <div class="relative">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <div class="mb-2 flex flex-wrap items-center gap-2">
                  <span class="plugin-logo flex h-9 w-9 items-center justify-center rounded-xl border p-1.5 text-lg text-[var(--color-purple-bright)] {plugin.plugin_key === 'database_bridge' ? 'border-[#336791]/50 bg-[#336791]/15' : 'border-purple-400/25 bg-purple-500/15'}" title={plugin.plugin_key === "database_bridge" ? "PostgreSQL" : plugin.name}>
                    {@html pluginLogo(plugin.plugin_key)}
                  </span>
                  <div>
                    <h3 class="font-semibold text-[var(--color-text)]">{plugin.name}</h3>
                    <p class="text-[0.65rem] uppercase tracking-[0.16em] text-[var(--color-muted-dim)]">{plugin.plugin_key === "database_bridge" ? "PostgreSQL" : plugin.category}</p>
                  </div>
                  <Badge tone={statusTone(plugin)}>{statusLabel(plugin)}</Badge>
                </div>
                <p class="max-w-xl text-sm leading-relaxed text-[var(--color-muted)]">{plugin.description}</p>
              </div>
              <button
                type="button"
                class="relative h-7 w-12 shrink-0 rounded-full border transition {plugin.enabled
                  ? 'border-purple-400/50 bg-purple-500/60'
                  : 'border-white/15 bg-black/40'} disabled:opacity-50"
                role="switch"
                aria-checked={plugin.enabled}
                aria-label={`Activar ${plugin.name}`}
                disabled={busy === plugin.plugin_key}
                onclick={() => toggle(plugin)}
              >
                <span class="absolute top-1 h-[18px] w-[18px] rounded-full bg-white shadow transition-all {plugin.enabled ? 'left-[25px]' : 'left-1'}"></span>
              </button>
            </div>

            <!-- Panel de Estado Operativo y Parámetros del Plugin -->
            <div class="mt-4 rounded-xl border border-white/[0.06] bg-black/30 p-3 text-xs space-y-2" data-plugin-status-info>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <span class="text-[var(--color-muted-dim)] block text-[10px] uppercase font-semibold">Estado de salud</span>
                  <span class="font-medium text-[var(--color-text)]">{statusLabel(plugin)}</span>
                </div>
                <div>
                  <span class="text-[var(--color-muted-dim)] block text-[10px] uppercase font-semibold">Última actualización</span>
                  <span class="font-mono text-[var(--color-muted)]">{formatDate(plugin.updated_at || plugin.last_check)}</span>
                </div>
                <div>
                  <span class="text-[var(--color-muted-dim)] block text-[10px] uppercase font-semibold">Bóveda de credenciales</span>
                  <span class="font-mono font-semibold {plugin.secret_configured ? 'text-emerald-400' : 'text-amber-300'}">
                    {plugin.plugin_key === "database_bridge"
                      ? (plugin.config.database_url_env || "HEXA_PLUGIN_DATABASE_SHOP_URL")
                      : plugin.secret_configured
                        ? "Bóveda activada (AES-256-GCM)"
                        : "Sin credencial"}
                  </span>
                </div>
                <div>
                  <span class="text-[var(--color-muted-dim)] block text-[10px] uppercase font-semibold">Entorno / Alcance</span>
                  <span class="font-medium text-[var(--color-text)]">
                    {plugin.plugin_key === "database_bridge"
                      ? (plugin.config.access_mode === "read_write" ? "Lectura y escritura" : "Solo lectura")
                      : plugin.plugin_key === "google_drive"
                        ? (plugin.config.folder_id ? "Carpeta configurada" : "Mi unidad")
                      : (plugin.config.environment === "live" ? "Producción (Live)" : "Sandbox / Pruebas")}
                  </span>
                </div>
              </div>
              <div class="border-t border-white/5 pt-2 flex items-center justify-between text-[11px]">
                <span class="text-[var(--color-muted)]">Permisos de escritura:</span>
                <span class="font-medium {plugin.plugin_key === 'database_bridge'
                  ? (plugin.config.access_mode === 'read_write' ? 'text-amber-300' : 'text-emerald-400')
                  : (plugin.config.allow_write_tools ? 'text-amber-300' : 'text-emerald-400')}">
                  {plugin.plugin_key === "database_bridge"
                    ? (plugin.config.access_mode === "read_write" ? "Permitidos" : "Bloqueados (solo lectura)")
                    : plugin.plugin_key === "google_drive"
                      ? "Subida de archivos"
                    : (plugin.config.allow_write_tools ? "Permitidos (requiere confirmación humana)" : "Bloqueados (solo lectura)")}
                </span>
              </div>
            </div>

            <!-- Advertencia explícita para Stripe MCP -->
            {#if plugin.plugin_key === "stripe_mcp"}
              <div class="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/[0.08] p-3 text-xs leading-relaxed text-amber-200/90" data-stripe-policy-notice>
                <div class="flex items-center gap-1.5 font-semibold text-amber-100 mb-1">
                  <span>ℹ️</span>
                  <span>Política del Plugin Stripe MCP: Sin sincronización automática</span>
                </div>
                <p>
                  Stripe MCP se encuentra <strong>desactivado por defecto</strong> y en <strong>modo solo lectura por defecto</strong>.
                  No realiza sincronización automática ni <strong>creación, migración o sincronización de clientes</strong> en Stripe para evitar duplicados y desajustes de sincronización bidireccional opaca.
                </p>
                {#if plugin.config.environment === "live"}
                  <p class="mt-2 text-amber-300 font-medium">
                    💡 En producción (Live), se recomienda utilizar únicamente una clave restringida (<code>rk_live_...</code>) con permisos mínimos auditados.
                  </p>
                {/if}
              </div>
            {/if}

            <ul class="mt-4 flex flex-wrap gap-1.5">
              {#each plugin.capabilities as capability}
                <li class="rounded-full border border-white/[0.08] bg-black/20 px-2.5 py-1 text-[11px] text-[var(--color-muted)]">{capability}</li>
              {/each}
            </ul>

            {#if plugin.enabled}
              <div class="mt-5 border-t border-[var(--color-border)] pt-4" data-plugin-config>
                {#if plugin.plugin_key === "database_bridge"}
                  <div class="grid gap-3 sm:grid-cols-2">
                    <label class="flex flex-col gap-1.5 text-sm">
                      <span class="font-medium text-[var(--color-muted)]">Nombre visible</span>
                      <input class="field" value={plugin.config.display_name ?? ""} oninput={(event) => updateConfig(plugin, { display_name: event.currentTarget.value })} />
                    </label>
                    <Select
                      label="Acceso"
                      value={plugin.config.access_mode ?? "read_only"}
                      onvaluechange={(value) => updateConfig(plugin, { access_mode: value === "read_write" ? "read_write" : "read_only" })}
                      options={[
                        { value: "read_only", label: "Solo lectura", hint: "Recomendado para centralización" },
                        { value: "read_write", label: "Lectura y escritura", hint: "Solo para integraciones controladas" },
                      ]}
                    />
                  </div>
                  <label class="mt-3 flex flex-col gap-1.5 text-sm">
                    <span class="font-medium text-[var(--color-muted)]">Variable de entorno con la URL PostgreSQL</span>
                    <input class="field font-mono text-xs" value={plugin.config.database_url_env ?? ""} oninput={(event) => updateConfig(plugin, { database_url_env: event.currentTarget.value })} />
                    <span class="text-[11px] text-[var(--color-muted-dim)]">Indica únicamente el nombre de la variable de entorno. Nunca ingreses URLs ni contraseñas reales.</span>
                  </label>
                  {#if !plugin.secret_configured}
                    <div class="mt-3 rounded-xl border border-amber-400/25 bg-amber-500/[0.08] p-3 text-xs leading-relaxed text-amber-100">
                      <p class="font-semibold">Falta configurar la conexión en el servidor</p>
                      <p class="mt-1">Define <code class="font-mono">{plugin.config.database_url_env || "HEXA_PLUGIN_DATABASE_SHOP_URL"}</code> con la URL de PostgreSQL de esta empresa y reinicia el backend. Por seguridad, la URL no se introduce ni se guarda en esta pantalla.</p>
                    </div>
                  {/if}
                {:else if plugin.plugin_key === "google_drive"}
                  <div class="grid gap-3 sm:grid-cols-2">
                    <label class="flex flex-col gap-1.5 text-sm">
                      <span class="font-medium text-[var(--color-muted)]">Nombre de la carpeta</span>
                      <input class="field" value={plugin.config.folder_name ?? ""} oninput={(event) => updateConfig(plugin, { folder_name: event.currentTarget.value })} />
                    </label>
                    <label class="flex flex-col gap-1.5 text-sm">
                      <span class="font-medium text-[var(--color-muted)]">ID de carpeta de Drive</span>
                      <input class="field font-mono text-xs" value={plugin.config.folder_id ?? ""} oninput={(event) => updateConfig(plugin, { folder_id: event.currentTarget.value })} placeholder="1AbC…" />
                    </label>
                  </div>
                  <p class="mt-2 text-[11px] text-[var(--color-muted-dim)]">Deja el ID vacío para subir a «Mi unidad». El ID aparece en la URL de la carpeta después de <code>/folders/</code>.</p>
                  <div class="mt-3 rounded-xl border border-white/[0.08] bg-black/40 p-3.5 space-y-3" data-google-drive-oauth-box>
                    <div class="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p class="text-xs font-semibold text-[var(--color-text)]">Cuenta de Google</p>
                        <p class="mt-1 text-[11px] {googleConnected ? 'text-emerald-300' : 'text-[var(--color-muted-dim)]'}">{googleConnected ? "Conectada · renovación automática" : "Sin conectar"}</p>
                      </div>
                      {#if googleConnected}
                        <Button variant="danger" disabled={googleConnecting} onclick={disconnectDrive}>Desconectar</Button>
                      {:else}
                        <Button disabled={googleConnecting} onclick={connectDrive}>{googleConnecting ? "Conectando…" : "Conectar con Google"}</Button>
                      {/if}
                    </div>
                    <p class="text-[10px] text-[var(--color-muted-dim)]">Solo tendrás que autorizar Google una vez. Hexa renueva el acceso automáticamente; nunca muestra ni solicita tokens.</p>
                  </div>
                {:else}
                  <div class="grid gap-3 sm:grid-cols-2">
                    <Select
                      label="Entorno Stripe"
                      value={plugin.config.environment ?? "sandbox"}
                      onvaluechange={(value) => updateConfig(plugin, { environment: value === "live" ? "live" : "sandbox" })}
                      options={[
                        { value: "sandbox", label: "Sandbox / pruebas" },
                        { value: "live", label: "Producción", hint: "Usa una clave restringida" },
                      ]}
                    />
                    <div class="flex flex-col justify-end text-xs">
                      <span class="font-medium text-[var(--color-muted)]">Estado del Secreto</span>
                      <span class="mt-2 font-mono font-semibold {plugin.secret_configured ? 'text-emerald-400' : 'text-amber-300'}">
                        {plugin.secret_configured ? "✓ Credencial guardada (Bóveda AES-256-GCM)" : "⚠️ Falta ingresar credencial"}
                      </span>
                    </div>
                  </div>

                  <!-- Gestión segura de credencial de Stripe (Requisitos 1, 3 y 7) -->
                  <div class="mt-3 rounded-xl border border-white/[0.08] bg-black/40 p-3.5 space-y-3" data-stripe-credential-box>
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-semibold text-[var(--color-text)]">Credencial de Stripe MCP</span>
                      <span class="text-[10px] text-[var(--color-muted-dim)]">Bóveda del servidor</span>
                    </div>

                    {#if $isAdmin}
                      <label class="flex flex-col gap-1 text-xs">
                        <span class="text-[var(--color-muted-dim)] font-medium">
                          {plugin.secret_configured ? "Nuevo token restringido de Stripe (para reemplazar el actual)" : "Token restringido de Stripe (sk_... o rk_...)"}
                        </span>
                        <input
                          type="password"
                          class="field font-mono text-xs"
                          placeholder={plugin.secret_configured ? "••••••••••••••••••••••••" : "rk_test_... o sk_test_..."}
                          bind:value={credentialInputs.stripe_mcp}
                          autocomplete="off"
                        />
                        <span class="text-[10px] text-[var(--color-muted-dim)]">
                          El valor se cifra con AES-256-GCM antes de guardarse en base de datos. La UI nunca revelará su contenido.
                        </span>
                      </label>

                      <div class="flex flex-wrap gap-2 pt-1">
                        {#if plugin.secret_configured}
                          <Button
                            variant="secondary"
                            disabled={busy === plugin.plugin_key || !credentialInputs.stripe_mcp.trim()}
                            onclick={() => handleSecretAction(plugin, "replace")}
                          >
                            Reemplazar credencial
                          </Button>
                          <Button
                            variant="danger"
                            disabled={busy === plugin.plugin_key}
                            onclick={() => handleSecretAction(plugin, "remove")}
                          >
                            Quitar credencial
                          </Button>
                        {:else}
                          <Button
                            disabled={busy === plugin.plugin_key || !credentialInputs.stripe_mcp.trim()}
                            onclick={() => handleSecretAction(plugin, "save")}
                          >
                            Guardar credencial
                          </Button>
                        {/if}
                      </div>
                    {:else}
                      <p class="text-xs text-amber-200/80">Solo los administradores pueden guardar, reemplazar o quitar la credencial.</p>
                    {/if}
                  </div>

                  <label class="mt-3 flex items-start gap-3 rounded-xl border border-amber-400/15 bg-amber-500/[0.05] px-3 py-3 text-sm">
                    <input type="checkbox" class="mt-0.5 accent-purple-500" checked={plugin.config.allow_write_tools === true} onchange={(event) => updateConfig(plugin, { allow_write_tools: event.currentTarget.checked })} />
                    <span>
                      <span class="block font-medium text-[var(--color-text)]">Permitir herramientas de escritura</span>
                      <span class="mt-0.5 block text-xs text-[var(--color-muted)]">Crear cobros, facturas o reembolsos seguirá requiriendo confirmación humana obligatoria de un administrador.</span>
                    </span>
                  </label>
                {/if}

                {#if plugin.last_error}
                  <p class="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{plugin.last_error}</p>
                {:else if plugin.plugin_key === "google_drive" && !googleConnected}
                  <p class="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-100/80">Conecta una cuenta de Google para activar las subidas.</p>
                {:else if !plugin.secret_configured}
                  <p class="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-100/80">Guarda la credencial de {plugin.plugin_key === "google_drive" ? "Google Drive" : "Stripe"} para activar las funciones.</p>
                {/if}

                <div class="mt-4 flex flex-wrap justify-end gap-2">
                  <Button variant="secondary" disabled={testing === plugin.plugin_key || busy === plugin.plugin_key} onclick={() => test(plugin)}>
                    {testing === plugin.plugin_key ? "Probando…" : "Probar conexión"}
                  </Button>
                  <Button disabled={busy === plugin.plugin_key} onclick={() => persist(plugin)}>
                    {busy === plugin.plugin_key ? "Guardando…" : "Guardar configuración"}
                  </Button>
                </div>
              </div>
            {/if}

            <!-- Panel Plegable de Historial de Actividad -->
            <div class="mt-5 border-t border-[var(--color-border)] pt-4" data-plugin-audit-panel>
              <button
                type="button"
                class="flex items-center justify-between w-full text-xs font-semibold text-[var(--color-muted)] hover:text-[var(--color-text)] transition py-1"
                onclick={() => toggleLogs(plugin.plugin_key)}
                data-toggle-audit-logs={plugin.plugin_key}
              >
                <span class="flex items-center gap-2">
                  <span>📋 Historial de actividad (auditoría por empresa)</span>
                  {#if logsMap[plugin.plugin_key]?.length > 0}
                    <span class="rounded-full bg-purple-500/20 px-2 py-0.5 text-[10px] text-purple-300 font-mono">
                      {logsMap[plugin.plugin_key].length}
                    </span>
                  {/if}
                </span>
                <span>{logsOpen[plugin.plugin_key] ? "▲ Ocultar" : "▼ Ver registros"}</span>
              </button>

              {#if logsOpen[plugin.plugin_key]}
                <div class="mt-3 space-y-2" data-audit-logs-list={plugin.plugin_key}>
                  {#if loadingLogs[plugin.plugin_key]}
                    <p class="text-xs text-[var(--color-muted-dim)] py-2 text-center">Cargando registros de auditoría…</p>
                  {:else if logsMap[plugin.plugin_key].length === 0}
                    <div class="rounded-xl border border-white/5 bg-black/30 p-3 text-xs text-center text-[var(--color-muted-dim)]" data-audit-logs-empty>
                      No hay registros de actividad auditables para este plugin en esta empresa. Las acciones de configuración, pruebas y uso de herramientas quedarán registradas aquí de forma segura.
                    </div>
                  {:else}
                    <div class="max-h-60 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                      {#each logsMap[plugin.plugin_key] as entry (entry.id)}
                        <div class="rounded-xl border border-white/5 bg-black/40 p-2.5 text-xs flex flex-col gap-1" data-audit-log-item={entry.id}>
                          <div class="flex flex-wrap items-center justify-between gap-1.5">
                            <div class="flex items-center gap-2">
                              <Badge tone={resultTone(entry.result)}>{resultLabel(entry.result)}</Badge>
                              <span class="font-medium text-[var(--color-text)]">{actionLabel(entry.action)}</span>
                              {#if entry.tool_name}
                                <span class="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-mono text-purple-200">{entry.tool_name}</span>
                              {/if}
                            </div>
                            <span class="text-[10px] font-mono text-[var(--color-muted-dim)]">{formatDate(entry.created_at)}</span>
                          </div>
                          {#if entry.summary}
                            <p class="text-[11px] text-[var(--color-muted)] leading-tight font-mono break-all">{entry.summary}</p>
                          {/if}
                          <div class="text-[10px] text-[var(--color-muted-dim)] flex items-center justify-between">
                            <span>Actor: <strong class="text-[var(--color-muted)]">{entry.actor_name || "Sistema"}</strong></span>
                          </div>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>

          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>

<style>
  .plugin-logo :global(svg) { width: 100%; height: 100%; display: block; }
</style>
