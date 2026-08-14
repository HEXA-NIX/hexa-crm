<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api/client";
  import type { FiscalProfile } from "$lib/types";
  import { deriveTaxModels, normalizeTaxSetup } from "$lib/taxes/models";
  import { showToast } from "$lib/stores/ui";
  import Card from "$lib/components/Card.svelte";
  import Button from "$lib/components/Button.svelte";
  import Badge from "$lib/components/Badge.svelte";

  const emptyProfile = (): FiscalProfile => ({
    company_id: 0,
    invoice_series: "F",
    regime: "general",
    period: "quarterly",
    entity_type: "autonomo",
    tax_setup: normalizeTaxSetup(),
    tax_models: [],
    profile_completed: false,
    irpf_enabled: false,
    default_irpf_rate: 0,
    sii_enabled: false,
    updated_at: "",
  });

  let profile = $state<FiscalProfile>(emptyProfile());
  let loading = $state(true);
  let saving = $state(false);
  const models = $derived(deriveTaxModels(profile));

  function updateTaxSetup<K extends keyof NonNullable<FiscalProfile["tax_setup"]>>(
    key: K,
    value: NonNullable<FiscalProfile["tax_setup"]>[K],
  ) {
    profile = { ...profile, tax_setup: { ...normalizeTaxSetup(profile.tax_setup), [key]: value } };
  }

  async function load() {
    loading = true;
    try {
      const profiles = await api.listFiscalProfiles();
      profile = profiles[0]
        ? { ...emptyProfile(), ...profiles[0], tax_setup: normalizeTaxSetup(profiles[0].tax_setup) }
        : emptyProfile();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudo cargar la configuración fiscal", "err");
    } finally {
      loading = false;
    }
  }

  async function saveProfile() {
    saving = true;
    try {
      profile = await api.upsertFiscalProfile({
        ...profile,
        profile_completed: true,
        tax_setup: normalizeTaxSetup(profile.tax_setup),
      });
      showToast("Configuración fiscal guardada");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudo guardar la configuración fiscal", "err");
    } finally {
      saving = false;
    }
  }

  onMount(load);
</script>

{#if loading}
  <div class="skeleton h-48"></div>
{:else}
  <div class="space-y-4">
    <Card lift={false} class="border border-[var(--color-border)] !p-5">
      <div class="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="section-label mb-1">Obligaciones</p>
          <h2 class="text-lg font-semibold text-[var(--color-text)]">Cuestionario fiscal</h2>
          <p class="mt-1 text-sm text-[var(--color-muted)]">Las respuestas determinan qué modelos se muestran en Impuestos para la empresa activa.</p>
        </div>
        <Badge tone={profile.profile_completed ? "ok" : "warn"}>{profile.profile_completed ? `${models.length} modelos identificados` : "Pendiente"}</Badge>
      </div>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Tipo de contribuyente</span><select bind:value={profile.entity_type} class="field w-full" onchange={(event) => { if (event.currentTarget.value !== "autonomo") updateTaxSetup("income_regime", "none"); }}><option value="autonomo">Autónomo / persona física</option><option value="sociedad">Sociedad mercantil</option><option value="otra">Otra entidad</option></select></label>
        <label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Régimen de IVA</span><select bind:value={profile.regime} class="field w-full"><option value="general">General</option><option value="simplified">Simplificado</option><option value="recargo_equivalencia">Recargo de equivalencia</option><option value="other">Otro</option></select></label>
        <label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Periodicidad fiscal</span><select bind:value={profile.period} class="field w-full"><option value="quarterly">Trimestral</option><option value="monthly">Mensual</option></select></label>
        <label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Residencia fiscal</span><select class="field w-full" value={profile.tax_setup?.tax_residency ?? "spain"} onchange={(event) => updateTaxSetup("tax_residency", event.currentTarget.value as "spain" | "non_resident")}><option value="spain">España</option><option value="non_resident">No residente</option></select></label>
        {#if profile.entity_type === "autonomo"}<label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">IRPF del autónomo</span><select class="field w-full" value={profile.tax_setup?.income_regime ?? "none"} onchange={(event) => updateTaxSetup("income_regime", event.currentTarget.value as "direct_estimation" | "objective_estimation" | "none")}><option value="direct_estimation">Estimación directa</option><option value="objective_estimation">Estimación objetiva (módulos)</option><option value="none">No aplica / pendiente</option></select></label>{/if}
        <label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Actividad a efectos de IVA</span><select class="field w-full" value={profile.tax_setup?.vat_activity ?? "not_applicable"} onchange={(event) => updateTaxSetup("vat_activity", event.currentTarget.value as "taxable" | "mixed" | "exempt" | "not_applicable")}><option value="taxable">Sujeta y no exenta</option><option value="mixed">Mixta (sujeta y exenta)</option><option value="exempt">Exenta</option><option value="not_applicable">No aplica</option></select></label>
      </div>

      <div class="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <label class="flex items-start gap-2 rounded-xl border border-[var(--color-border)] bg-black/20 p-3 text-sm"><input class="mt-1" type="checkbox" checked={profile.tax_setup?.census_changes ?? false} onchange={(e) => updateTaxSetup("census_changes", e.currentTarget.checked)} /><span>Tiene un alta o cambio censal pendiente</span></label>
        <label class="flex items-start gap-2 rounded-xl border border-[var(--color-border)] bg-black/20 p-3 text-sm"><input class="mt-1" type="checkbox" checked={profile.tax_setup?.vat_registered ?? false} onchange={(e) => updateTaxSetup("vat_registered", e.currentTarget.checked)} /><span>Está dado de alta en IVA</span></label>
        <label class="flex items-start gap-2 rounded-xl border border-[var(--color-border)] bg-black/20 p-3 text-sm"><input class="mt-1" type="checkbox" checked={profile.tax_setup?.annual_vat_summary ?? false} onchange={(e) => updateTaxSetup("annual_vat_summary", e.currentTarget.checked)} /><span>Presenta resumen anual de IVA</span></label>
        <label class="flex items-start gap-2 rounded-xl border border-[var(--color-border)] bg-black/20 p-3 text-sm"><input class="mt-1" type="checkbox" checked={profile.tax_setup?.intra_community_operations ?? false} onchange={(e) => updateTaxSetup("intra_community_operations", e.currentTarget.checked)} /><span>Opera con empresas de la UE</span></label>
        <label class="flex items-start gap-2 rounded-xl border border-[var(--color-border)] bg-black/20 p-3 text-sm"><input class="mt-1" type="checkbox" checked={profile.tax_setup?.imports_exports ?? false} onchange={(e) => updateTaxSetup("imports_exports", e.currentTarget.checked)} /><span>Importa o exporta fuera de la UE</span></label>
        <label class="flex items-start gap-2 rounded-xl border border-[var(--color-border)] bg-black/20 p-3 text-sm"><input class="mt-1" type="checkbox" checked={profile.tax_setup?.third_party_operations ?? false} onchange={(e) => updateTaxSetup("third_party_operations", e.currentTarget.checked)} /><span>Supera el umbral anual con terceros</span></label>
        <label class="flex items-start gap-2 rounded-xl border border-[var(--color-border)] bg-black/20 p-3 text-sm"><input class="mt-1" type="checkbox" checked={profile.tax_setup?.has_employees ?? false} onchange={(e) => updateTaxSetup("has_employees", e.currentTarget.checked)} /><span>Tiene empleados</span></label>
        {#if profile.tax_setup?.has_employees}<label class="flex items-start gap-2 rounded-xl border border-[var(--color-border)] bg-black/20 p-3 text-sm"><input class="mt-1" type="checkbox" checked={profile.tax_setup?.withholds_employees ?? false} onchange={(e) => updateTaxSetup("withholds_employees", e.currentTarget.checked)} /><span>Practica retenciones a trabajadores</span></label>{/if}
        <label class="flex items-start gap-2 rounded-xl border border-[var(--color-border)] bg-black/20 p-3 text-sm"><input class="mt-1" type="checkbox" checked={profile.tax_setup?.withholds_professionals ?? false} onchange={(e) => updateTaxSetup("withholds_professionals", e.currentTarget.checked)} /><span>Practica retenciones a profesionales</span></label>
        <label class="flex items-start gap-2 rounded-xl border border-[var(--color-border)] bg-black/20 p-3 text-sm"><input class="mt-1" type="checkbox" checked={profile.tax_setup?.withholds_rent ?? false} onchange={(e) => updateTaxSetup("withholds_rent", e.currentTarget.checked)} /><span>Retiene por alquileres</span></label>
        <label class="flex items-start gap-2 rounded-xl border border-[var(--color-border)] bg-black/20 p-3 text-sm"><input class="mt-1" type="checkbox" checked={profile.tax_setup?.withholds_capital ?? false} onchange={(e) => updateTaxSetup("withholds_capital", e.currentTarget.checked)} /><span>Retiene sobre capital mobiliario</span></label>
        {#if profile.entity_type !== "autonomo"}<label class="flex items-start gap-2 rounded-xl border border-[var(--color-border)] bg-black/20 p-3 text-sm"><input class="mt-1" type="checkbox" checked={profile.tax_setup?.corporate_tax ?? false} onchange={(e) => updateTaxSetup("corporate_tax", e.currentTarget.checked)} /><span>Está sujeta a Sociedades</span></label><label class="flex items-start gap-2 rounded-xl border border-[var(--color-border)] bg-black/20 p-3 text-sm"><input class="mt-1" type="checkbox" checked={profile.tax_setup?.corporate_tax_installments ?? false} onchange={(e) => updateTaxSetup("corporate_tax_installments", e.currentTarget.checked)} /><span>Hace pagos fraccionados de Sociedades</span></label>{/if}
        <label class="flex items-start gap-2 rounded-xl border border-[var(--color-border)] bg-black/20 p-3 text-sm"><input class="mt-1" type="checkbox" checked={profile.tax_setup?.foreign_assets ?? false} onchange={(e) => updateTaxSetup("foreign_assets", e.currentTarget.checked)} /><span>Tiene bienes declarables en el extranjero</span></label>
        <label class="flex items-start gap-2 rounded-xl border border-[var(--color-border)] bg-black/20 p-3 text-sm"><input class="mt-1" type="checkbox" checked={profile.tax_setup?.crypto_assets ?? false} onchange={(e) => updateTaxSetup("crypto_assets", e.currentTarget.checked)} /><span>Tiene criptoactivos en el extranjero</span></label>
      </div>
    </Card>

    <Card lift={false} class="border border-[var(--color-border)] !p-5">
      <div class="mb-5"><p class="section-label mb-1">Facturación</p><h2 class="text-lg font-semibold text-[var(--color-text)]">Retenciones y VERI*FACTU</h2><p class="mt-1 text-sm text-[var(--color-muted)]">Configuración técnica para emitir facturas. No cambia por sí sola las obligaciones del cuestionario.</p></div>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Serie de facturación</span><input maxlength="8" bind:value={profile.invoice_series} class="field w-full" placeholder="F" /></label>
        <label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">IRPF por defecto (%)</span><input type="number" min="0" max="100" step="0.01" bind:value={profile.default_irpf_rate} class="field w-full" /></label>
        <label class="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" bind:checked={profile.irpf_enabled} /> Aplicar retenciones en facturas</label>
        <label class="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" bind:checked={profile.sii_enabled} /> SII activo (mensual)</label>
        <label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">VERI*FACTU</span><select bind:value={profile.verifactu_mode} class="field w-full"><option value="disabled">Desactivado</option><option value="test">Pruebas AEAT</option><option value="production">Producción (pendiente de conexión)</option></select></label>
        <label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">NIF emisor</span><input bind:value={profile.verifactu_producer_nif} class="field w-full" placeholder="B12345678" /></label>
        <label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Identificador del sistema</span><input bind:value={profile.verifactu_software_id} class="field w-full" placeholder="hexa-crm" /></label>
        <label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Versión del sistema</span><input bind:value={profile.verifactu_software_version} class="field w-full" placeholder="0.3.2" /></label>
      </div>
    </Card>

    <div class="flex justify-end"><Button onclick={saveProfile} disabled={saving}>{saving ? "Guardando…" : "Guardar configuración fiscal"}</Button></div>
  </div>
{/if}
