<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api/client";
  import type { FiscalProfile, Model303Draft, VatSummary } from "$lib/types";
  import { formatEUR } from "$lib/money";
  import { vatLabel, type VatRate } from "$lib/vat";
  import Card from "$lib/components/Card.svelte";
  import KpiCard from "$lib/components/KpiCard.svelte";
  import Badge from "$lib/components/Badge.svelte";
  import Button from "$lib/components/Button.svelte";
  import { showToast } from "$lib/stores/ui";
  import { downloadCsv, vatSummaryToCsv } from "$lib/export/csv";

  function monthRange(d = new Date()) {
    const y = d.getFullYear();
    const m = d.getMonth();
    const from = new Date(y, m, 1);
    const to = new Date(y, m + 1, 0);
    const fmt = (x: Date) => x.toISOString().slice(0, 10);
    return { from: fmt(from), to: fmt(to) };
  }

  let range = $state(monthRange());
  let summary = $state<VatSummary | null>(null);
  let draft = $state<Model303Draft | null>(null);
  let profile = $state<FiscalProfile>({ company_id: 0, regime: "general", period: "quarterly", irpf_enabled: false, default_irpf_rate: 0, sii_enabled: false, updated_at: "" });
  let loading = $state(true);
  let savingProfile = $state(false);

  async function load() {
    loading = true;
    try {
      const [vat, model, profiles] = await Promise.all([
        api.vatSummary(range.from, range.to),
        api.model303Draft(range.from, range.to),
        api.listFiscalProfiles(),
      ]);
      summary = vat;
      draft = model;
      if (profiles[0]) profile = { ...profile, ...profiles[0] };
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "err");
    } finally {
      loading = false;
    }
  }

  async function saveProfile() {
    savingProfile = true;
    try {
      profile = await api.upsertFiscalProfile(profile);
      await load();
      showToast("Perfil fiscal guardado");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "No se pudo guardar el perfil", "err");
    } finally {
      savingProfile = false;
    }
  }

  function exportDraft() {
    if (!draft) return;
    const rows = [
      ["Borrador modelo 303", `${draft.from} - ${draft.to}`],
      ["IVA repercutido - base", String(draft.output_base_cents / 100)],
      ["IVA repercutido - cuota", String(draft.output_vat_cents / 100)],
      ["IVA soportado - base", String(draft.input_base_cents / 100)],
      ["IVA soportado - cuota", String(draft.input_vat_cents / 100)],
      ["Resultado IVA", String(draft.net_vat_cents / 100)],
      ["Retenciones", String(draft.withholding_cents / 100)],
      ...draft.warnings.map((warning) => ["Aviso", warning]),
    ];
    downloadCsv(`borrador-modelo-303-${draft.from}_${draft.to}.csv`, rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n"));
    showToast("Borrador 303 exportado a CSV");
  }

  onMount(load);

  function exportCsv() {
    if (!summary) {
      showToast("No hay datos de IVA", "info");
      return;
    }
    const csv = vatSummaryToCsv(summary.from, summary.to, summary.buckets);
    downloadCsv(`libro-iva-${summary.from}_${summary.to}.csv`, csv);
    showToast("Libro IVA exportado a CSV");
  }
</script>

<section class="tax-page workspace-page">
<div class="workspace-intro workspace-intro-compact">
  <p class="workspace-index">06 / IMPUESTOS</p>
  <div class="workspace-intro-row">
    <h2>Las cuentas,<br /><em>sin ruido.</em></h2>
    <p>Una lectura interna del IVA repercutido, preparada para revisar y exportar.</p>
  </div>
</div>

<div class="workspace-toolbar mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
  <label class="text-sm w-full sm:w-auto">
    <span class="mb-1 block text-[var(--color-muted)]">Desde</span>
    <input type="date" bind:value={range.from} class="field w-full sm:w-auto" />
  </label>
  <label class="text-sm w-full sm:w-auto">
    <span class="mb-1 block text-[var(--color-muted)]">Hasta</span>
    <input type="date" bind:value={range.to} class="field w-full sm:w-auto" />
  </label>
  <Button class="w-full sm:w-auto" onclick={load}>Actualizar</Button>
  <Button variant="secondary" class="w-full sm:w-auto" onclick={exportCsv}>Exportar CSV</Button>
  <Button variant="secondary" class="w-full sm:w-auto" onclick={exportDraft}>Exportar borrador 303</Button>
</div>

<div class="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/90">
  Control interno de IVA repercutido (PVP con IVA incluido). <strong>No sustituye</strong> un software de
  facturación homologado AEAT / Verifactu.
</div>

{#if loading || !summary}
  <div class="skeleton h-48"></div>
{:else}
  <Card lift={false} class="mb-4 p-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div><h3 class="text-base font-semibold">Perfil fiscal de la empresa</h3><p class="text-xs text-slate-400">Se guarda por empresa y se usa para preparar revisiones.</p></div>
      <Button onclick={saveProfile} disabled={savingProfile}>{savingProfile ? "Guardando…" : "Guardar perfil"}</Button>
    </div>
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <label class="text-sm"><span class="mb-1 block text-slate-400">Régimen</span><select bind:value={profile.regime} class="field w-full"><option value="general">General</option><option value="simplified">Simplificado</option><option value="recargo_equivalencia">Recargo de equivalencia</option><option value="other">Otro</option></select></label>
      <label class="text-sm"><span class="mb-1 block text-slate-400">Periodicidad</span><select bind:value={profile.period} class="field w-full"><option value="quarterly">Trimestral</option><option value="monthly">Mensual</option></select></label>
      <label class="text-sm"><span class="mb-1 block text-slate-400">IRPF por defecto (%)</span><input type="number" min="0" max="100" step="0.01" bind:value={profile.default_irpf_rate} class="field w-full" /></label>
      <label class="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" bind:checked={profile.irpf_enabled} /> Aplicar retenciones</label>
      <label class="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" bind:checked={profile.sii_enabled} /> SII activo</label>
    </div>
  </Card>

  <div class="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
    <KpiCard label="IVA repercutido" value={formatEUR(draft?.output_vat_cents ?? summary.vat_cents)} accent="cyan" />
    <KpiCard label="IVA soportado" value={formatEUR(draft?.input_vat_cents ?? 0)} accent="amber" />
    <KpiCard label="Resultado estimado" value={formatEUR(draft?.net_vat_cents ?? summary.vat_cents)} accent="emerald" />
  </div>

  {#if draft}
    <Card lift={false} class="mb-4 p-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 class="text-base font-semibold">Borrador modelo 303 · revisión</h3><Badge tone="vat">No presentado</Badge></div>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-3"><div><p class="text-xs text-slate-400">Bases repercutidas</p><p class="text-lg tabular">{formatEUR(draft.output_base_cents)}</p></div><div><p class="text-xs text-slate-400">Bases soportadas</p><p class="text-lg tabular">{formatEUR(draft.input_base_cents)}</p></div><div><p class="text-xs text-slate-400">Retenciones detectadas</p><p class="text-lg tabular">{formatEUR(draft.withholding_cents)}</p></div></div>
      <ul class="mt-4 space-y-1 text-xs text-amber-100/80">{#each draft.warnings as warning}<li>• {warning}</li>{/each}</ul>
    </Card>
  {/if}

  <Card lift={false} class="overflow-hidden p-0">
    <table class="w-full text-left text-sm">
      <thead class="border-b border-white/10 text-xs uppercase text-slate-500">
        <tr>
          <th class="px-4 py-3">Tipo</th>
          <th class="px-4 py-3">Base</th>
          <th class="px-4 py-3">Cuota</th>
          <th class="px-4 py-3">Total</th>
        </tr>
      </thead>
      <tbody>
        {#each summary.buckets as b}
          <tr class="border-b border-white/5">
            <td class="px-4 py-3">
              <Badge tone="vat">{vatLabel(b.vat_rate as VatRate)}</Badge>
            </td>
            <td class="px-4 py-3 tabular">{formatEUR(b.base_cents)}</td>
            <td class="px-4 py-3 tabular text-amber-200">{formatEUR(b.vat_cents)}</td>
            <td class="px-4 py-3 tabular font-medium">{formatEUR(b.total_cents)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </Card>
{/if}

</section>
