<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api/client";
  import type { FiscalProfile, Model303Draft, VatSummary, VerifactuRecord } from "$lib/types";
  import { deriveTaxModels, normalizeTaxSetup } from "$lib/taxes/models";
  import { formatEUR } from "$lib/money";
  import { vatLabel, type VatRate } from "$lib/vat";
  import Card from "$lib/components/Card.svelte";
  import KpiCard from "$lib/components/KpiCard.svelte";
  import Badge from "$lib/components/Badge.svelte";
  import Button from "$lib/components/Button.svelte";
  import { showToast } from "$lib/stores/ui";
  import { downloadCsv, vatSummaryToCsv } from "$lib/export/csv";
  import SortableHeader from "$lib/components/SortableHeader.svelte";
  import { sortedCopy, type SortDirection } from "$lib/list-sort";

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
  let profile = $state<FiscalProfile>({ company_id: 0, invoice_series: "F", regime: "general", period: "quarterly", entity_type: "autonomo", tax_setup: normalizeTaxSetup(), tax_models: [], profile_completed: false, irpf_enabled: false, default_irpf_rate: 0, sii_enabled: false, updated_at: "" });
  let verifactuRecords = $state<VerifactuRecord[]>([]);
  let verifactuChain = $state<{ ok: boolean; error?: string }>({ ok: true });
  let loading = $state(true);
  let selectedYear = $state(new Date().getFullYear());
  let periodRows = $state<Array<{ label: string; output: number; input: number; result: number; status: "pending" | "review" }>>([]);
  let verifactuSortKey = $state<"type" | "invoice" | "generated" | "hash" | "status">("generated");
  let verifactuSortDirection = $state<SortDirection>("desc");
  let vatSortKey = $state<"type" | "base" | "vat" | "total">("type");
  let vatSortDirection = $state<SortDirection>("asc");
  const displayedVerifactuRecords = $derived(sortedCopy(verifactuRecords.slice(0, 10), (record) => verifactuSortKey === "type" ? record.record_type : verifactuSortKey === "invoice" ? `${record.invoice_series}-${record.invoice_number}` : verifactuSortKey === "generated" ? record.generated_at : verifactuSortKey === "hash" ? record.hash : record.status, verifactuSortDirection));
  const displayedVatBuckets = $derived(summary ? sortedCopy(summary.buckets, (bucket) => vatSortKey === "type" ? bucket.vat_rate : vatSortKey === "base" ? bucket.base_cents : vatSortKey === "vat" ? bucket.vat_cents : bucket.base_cents + bucket.vat_cents, vatSortDirection) : []);
  const availableModels = $derived(deriveTaxModels(profile));
  function yearRange(year: number, quarter: number) { const fromMonth = (quarter - 1) * 3; const from = `${year}-${String(fromMonth + 1).padStart(2, "0")}-01`; const toDate = new Date(year, fromMonth + 3, 0); return { from, to: `${year}-${String(toDate.getMonth() + 1).padStart(2, "0")}-${String(toDate.getDate()).padStart(2, "0")}` }; }
  function sortVerifactu(key: typeof verifactuSortKey) { if (verifactuSortKey === key) verifactuSortDirection = verifactuSortDirection === "asc" ? "desc" : "asc"; else { verifactuSortKey = key; verifactuSortDirection = key === "generated" ? "desc" : "asc"; } }
  function sortVat(key: typeof vatSortKey) { if (vatSortKey === key) vatSortDirection = vatSortDirection === "asc" ? "desc" : "asc"; else { vatSortKey = key; vatSortDirection = "asc"; } }

  async function load() {
    loading = true;
    try {
      const [vat, profiles, records, chain] = await Promise.all([
        api.vatSummary(range.from, range.to),
        api.listFiscalProfiles(),
        api.listVerifactuRecords(),
        api.verifyVerifactuChain(),
      ]);
      summary = vat;
      const loadedProfile = profiles[0] ? { ...profile, ...profiles[0], tax_setup: normalizeTaxSetup(profiles[0].tax_setup) } : profile;
      profile = loadedProfile;
      verifactuRecords = records;
      verifactuChain = chain;
      const modelCodes = deriveTaxModels(loadedProfile).map((model) => model.code);
      if (modelCodes.includes("303")) {
        draft = await api.model303Draft(range.from, range.to);
        periodRows = await Promise.all([1, 2, 3, 4].map(async (quarter) => { const q = yearRange(selectedYear, quarter); const qDraft = await api.model303Draft(q.from, q.to); return { label: `${quarter} Trimestre`, output: qDraft.output_vat_cents, input: qDraft.input_vat_cents, result: qDraft.net_vat_cents, status: qDraft.output_vat_cents || qDraft.input_vat_cents ? "review" as const : "pending" as const }; }));
      } else {
        draft = null;
        periodRows = [];
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "err");
    } finally {
      loading = false;
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

  function exportVerifactu() {
    const blob = new Blob([JSON.stringify(verifactuRecords, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `registros-verifactu-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("Registros VERI*FACTU exportados");
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

<Card lift={false} class="mb-4 p-4">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div><p class="text-xs uppercase tracking-wide text-slate-500">Modelos fiscales</p><h3 class="mt-1 text-lg font-semibold">Solo los que corresponden a esta empresa</h3><p class="mt-1 text-xs text-slate-400">No damos por supuesto que un autónomo y una sociedad tengan las mismas obligaciones.</p></div>
    {#if profile.profile_completed}<Badge tone="ok">{availableModels.length} modelos identificados</Badge>{:else}<Badge tone="warn">Cuestionario pendiente</Badge>{/if}
  </div>
  {#if !profile.profile_completed}
    <div class="mt-4 flex flex-col gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100/90 sm:flex-row sm:items-center sm:justify-between">
      <div><strong>Falta configurar la fiscalidad de esta empresa.</strong><p class="mt-1 text-xs text-amber-100/70">Completa el cuestionario en Ajustes para identificar sus modelos y activar los cálculos correspondientes.</p></div>
      <a class="btn btn-primary shrink-0 text-center" href="/ajustes?seccion=fiscal">Configurar en Ajustes</a>
    </div>
  {:else if availableModels.length === 0}
    <div class="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">No hay modelos periódicos identificados con las respuestas actuales. Revisa el cuestionario o consulta con tu asesoría.</div>
  {:else}
    <div class="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">{#each availableModels as model}<div class="rounded-xl border border-white/10 bg-white/[0.03] p-3"><div class="flex items-center justify-between gap-2"><strong>{model.label}</strong><Badge tone="vat">{model.frequency === "annual" ? "Anual" : model.frequency === "monthly" ? "Mensual" : model.frequency === "quarterly" ? "Trimestral" : "Eventual"}</Badge></div><p class="mt-1 text-xs text-slate-400">{model.reason}</p></div>{/each}</div>
    {#if availableModels.some((model) => model.code === "303")}
      <div class="mt-5 flex flex-wrap items-end justify-between gap-3 border-t border-white/10 pt-4"><div><h4 class="font-semibold">Revisión del modelo 303</h4><p class="text-xs text-slate-400">Este es el único modelo que calculamos actualmente con los libros de IVA. Los demás quedan identificados para su preparación específica.</p></div><div class="flex gap-2"><label class="text-sm"><span class="mb-1 block text-slate-400">Ejercicio</span><select class="field" bind:value={selectedYear} onchange={load}><option value={new Date().getFullYear()}>{new Date().getFullYear()}</option><option value={new Date().getFullYear() - 1}>{new Date().getFullYear() - 1}</option></select></label></div></div>
      <div class="mt-4 overflow-x-auto"><table class="w-full min-w-[44rem] text-left text-sm"><thead class="border-b border-white/10 text-xs uppercase text-slate-500"><tr><th class="px-3 py-3">Período</th><th class="px-3 py-3 text-right">IVA soportado</th><th class="px-3 py-3 text-right">IVA repercutido</th><th class="px-3 py-3 text-right">Resultado</th><th class="px-3 py-3">Estado</th><th></th></tr></thead><tbody>{#each periodRows as row}<tr class="border-b border-white/5"><td class="px-3 py-3">{row.label}</td><td class="px-3 py-3 text-right tabular">{formatEUR(row.input)}</td><td class="px-3 py-3 text-right tabular text-cyan-200">{formatEUR(row.output)}</td><td class="px-3 py-3 text-right tabular font-semibold">{formatEUR(row.result)}</td><td class="px-3 py-3"><Badge tone={row.status === "review" ? "ok" : "warn"}>{row.status === "review" ? "Listo para revisar" : "Pendiente"}</Badge></td><td class="px-3 py-3 text-right"><button type="button" class="text-radiant" onclick={() => { const q = periodRows.indexOf(row) + 1; const next = yearRange(selectedYear, q); range = next; load(); }}>Ver →</button></td></tr>{/each}<tr class="font-semibold"><td class="px-3 py-3">Total</td><td class="px-3 py-3 text-right tabular">{formatEUR(periodRows.reduce((sum, row) => sum + row.input, 0))}</td><td class="px-3 py-3 text-right tabular">{formatEUR(periodRows.reduce((sum, row) => sum + row.output, 0))}</td><td class="px-3 py-3 text-right tabular">{formatEUR(periodRows.reduce((sum, row) => sum + row.result, 0))}</td><td colspan="2"></td></tr></tbody></table></div>
    {/if}
  {/if}
</Card>

<div class="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/90">
  Control interno de IVA repercutido (PVP con IVA incluido). <strong>No sustituye</strong> un software de
  facturación homologado AEAT / Verifactu.
</div>

{#if loading || !summary}
  <div class="skeleton h-48"></div>
{:else}
  <Card lift={false} class="mb-4 p-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 class="text-base font-semibold">Registro VERI*FACTU</h3><p class="text-xs text-slate-400">Cada factura emitida o anulada genera una huella encadenada y queda disponible para exportación. La remisión a AEAT todavía no se ejecuta automáticamente.</p></div><div class="flex items-center gap-2"><Badge tone={verifactuChain.ok ? "ok" : "danger"}>{verifactuChain.ok ? "Cadena íntegra" : "Revisar cadena"}</Badge><Button variant="secondary" onclick={exportVerifactu} disabled={!verifactuRecords.length}>Exportar JSON</Button></div></div>
    {#if verifactuRecords.length === 0}<p class="text-sm text-slate-400">Activa «Pruebas AEAT» y emite una factura para generar el primer registro.</p>{:else}<div class="overflow-x-auto"><table class="w-full text-left text-xs"><thead class="border-b border-white/10 uppercase text-slate-500"><tr><SortableHeader label="Tipo" class="px-2 py-2" active={verifactuSortKey === "type"} direction={verifactuSortDirection} onclick={() => sortVerifactu("type")} /><SortableHeader label="Factura" class="px-2 py-2" active={verifactuSortKey === "invoice"} direction={verifactuSortDirection} onclick={() => sortVerifactu("invoice")} /><SortableHeader label="Generado" class="px-2 py-2" active={verifactuSortKey === "generated"} direction={verifactuSortDirection} onclick={() => sortVerifactu("generated")} /><SortableHeader label="Huella" class="px-2 py-2" active={verifactuSortKey === "hash"} direction={verifactuSortDirection} onclick={() => sortVerifactu("hash")} /><SortableHeader label="Estado" class="px-2 py-2" active={verifactuSortKey === "status"} direction={verifactuSortDirection} onclick={() => sortVerifactu("status")} /></tr></thead><tbody>{#each displayedVerifactuRecords as record}<tr class="border-b border-white/5"><td class="px-2 py-2">{record.record_type === "alta" ? "Alta" : "Anulación"}</td><td class="px-2 py-2">{record.invoice_series}-{record.invoice_number}</td><td class="px-2 py-2">{record.generated_at.slice(0, 19).replace("T", " ")}</td><td class="max-w-[180px] truncate px-2 py-2 font-mono text-[10px]" title={record.hash}>{record.hash}</td><td class="px-2 py-2"><Badge tone={record.status === "rejected" ? "danger" : record.status === "accepted" ? "ok" : "warn"}>{record.status}</Badge></td></tr>{/each}</tbody></table></div>{/if}
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
          <SortableHeader label="Tipo" active={vatSortKey === "type"} direction={vatSortDirection} onclick={() => sortVat("type")} />
          <SortableHeader label="Base" active={vatSortKey === "base"} direction={vatSortDirection} onclick={() => sortVat("base")} />
          <SortableHeader label="Cuota" active={vatSortKey === "vat"} direction={vatSortDirection} onclick={() => sortVat("vat")} />
          <SortableHeader label="Total" active={vatSortKey === "total"} direction={vatSortDirection} onclick={() => sortVat("total")} />
        </tr>
      </thead>
      <tbody>
        {#each displayedVatBuckets as b}
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
