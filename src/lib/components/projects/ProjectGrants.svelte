<script lang="ts">
  import { api } from "$lib/api/client";
  import { formatEUR, parseEurosInput } from "$lib/money";
  import { isAdmin, session } from "$lib/stores/session";
  import { showToast } from "$lib/stores/ui";
  import type { ProjectGrant, WorkProject } from "$lib/types";
  import { normalizeProjectManagement } from "$lib/projects/management";
  import Badge from "$lib/components/Badge.svelte";
  import Button from "$lib/components/Button.svelte";
  import DatePicker from "$lib/components/DatePicker.svelte";
  import MoneyInput from "$lib/components/MoneyInput.svelte";
  import Select from "$lib/components/Select.svelte";

  let { project, onsaved, readonly = false }: { project: WorkProject; onsaved?: (project: WorkProject) => void; readonly?: boolean } = $props();
  let saving = $state(false);
  let open = $state(false);
  let editingId = $state<string | null>(null);
  let form = $state(blank());
  const management = $derived(normalizeProjectManagement(project.management));
  const grants = $derived(management.grants);
  const awarded = $derived(grants.filter((item) => ["awarded","received","closed"].includes(item.status)).reduce((sum,item) => sum + item.awarded_cents, 0));
  const received = $derived(grants.reduce((sum,item) => sum + item.received_cents, 0));
  const repayable = $derived(grants.filter((item) => item.funding_type === "repayable").reduce((sum,item) => sum + item.repayable_cents, 0));
  const managementFees = $derived(grants.reduce((sum,item) => sum + feeCents(item), 0));
  const netAwarded = $derived(Math.max(0, awarded - managementFees));

  function blank() { return { name:"", authority:"", beneficiary_company_id:String(project.task_company_id ?? project.company_id), managing_company:"", management_fee_percent:"", status:"negotiating" as ProjectGrant["status"], funding_type:"non_repayable" as ProjectGrant["funding_type"], requested:"", awarded:"", received:"", repayable:"", application_date:"", resolution_date:"", received_date:"", repayment_date:"", reference:"", notes:"" }; }
  const uid = () => `grant-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  const date = (value: string | null) => value ? value.slice(0,10).split("-").reverse().join("-") : "Sin fecha";
  const statusLabel = (value: ProjectGrant["status"]) => ({preparing:"Preparando",negotiating:"En negociación",awarded:"Adjudicada",received:"Cobrada",rejected:"Rechazada",closed:"Cerrada"})[value];
  const tone = (value: ProjectGrant["status"]) => value === "rejected" ? "danger" : ["awarded","received","closed"].includes(value) ? "ok" : "warn";
  const feeCents = (grant: ProjectGrant) => Math.round(grant.awarded_cents * Math.min(100, Math.max(0, grant.management_fee_percent || 0)) / 100);
  const recognizedCents = (grant: ProjectGrant) => ["awarded","received","closed"].includes(grant.status) ? (grant.received_cents || grant.awarded_cents || grant.requested_cents) : 0;
  const eurosInput = (cents: number) => cents ? (cents / 100).toLocaleString("es-ES", { maximumFractionDigits: 2 }) : "";

  function closeForm() { open=false; editingId=null; form=blank(); }
  function newGrant() { editingId=null; form=blank(); open=true; }
  function edit(grant: ProjectGrant) {
    editingId=grant.id;
    form={ name:grant.name, authority:grant.authority, beneficiary_company_id:String(grant.beneficiary_company_id ?? project.task_company_id ?? project.company_id), managing_company:grant.managing_company, management_fee_percent:String(grant.management_fee_percent || ""), status:grant.status, funding_type:grant.funding_type, requested:eurosInput(grant.requested_cents), awarded:eurosInput(grant.awarded_cents), received:eurosInput(grant.received_cents), repayable:eurosInput(grant.repayable_cents), application_date:grant.application_date ?? "", resolution_date:grant.resolution_date ?? "", received_date:grant.received_date ?? "", repayment_date:grant.repayment_date ?? "", reference:grant.reference, notes:grant.notes };
    open=true;
  }

  async function persist(next: ProjectGrant[], message: string) {
    saving = true;
    try { const saved = await api.upsertWorkProject({ id:project.id, name:project.name, management:{...management,grants:next} }); onsaved?.(saved); showToast(message,"ok"); return true; }
    catch (error) { showToast(error instanceof Error ? error.message : "No se pudo guardar la subvención","err"); return false; }
    finally { saving = false; }
  }
  async function save() {
    if (!form.name.trim()) return showToast("Indica el nombre de la subvención","err");
    const requestedCents = parseEurosInput(form.requested) ?? 0;
    const enteredAwardedCents = parseEurosInput(form.awarded) ?? 0;
    const awardedCents = ["awarded","received","closed"].includes(form.status) ? (enteredAwardedCents || requestedCents) : enteredAwardedCents;
    const enteredReceivedCents = parseEurosInput(form.received) ?? 0;
    const receivedCents = form.status === "received" ? (enteredReceivedCents || awardedCents || requestedCents) : enteredReceivedCents;
    const grant: ProjectGrant = { id:editingId ?? uid(), name:form.name.trim(), authority:form.authority.trim(), beneficiary_company_id:Number(form.beneficiary_company_id) || project.task_company_id || project.company_id, managing_company:form.managing_company.trim(), management_fee_percent:Math.min(100,Math.max(0,Number(form.management_fee_percent.replace(",","."))||0)), status:form.status, funding_type:form.funding_type, requested_cents:requestedCents, awarded_cents:awardedCents, received_cents:receivedCents, repayable_cents:form.funding_type === "repayable" ? (parseEurosInput(form.repayable) ?? awardedCents) : 0, application_date:form.application_date || null, resolution_date:form.resolution_date || null, received_date:receivedCents > 0 ? form.received_date || new Date().toISOString().slice(0,10) : null, repayment_date:form.funding_type === "repayable" ? form.repayment_date || null : null, reference:form.reference.trim(), notes:form.notes.trim() };
    const next = editingId ? grants.map((item)=>item.id===editingId?grant:item) : [...grants,grant];
    if (await persist(next,editingId?"Subvención actualizada":"Subvención registrada")) {
      try { await api.syncProjectGrantIncome({ project_id:project.id, beneficiary_company_id:grant.beneficiary_company_id!, grant_id:grant.id, amount_cents:recognizedCents(grant), description:`[${project.name}] Subvención: ${grant.name}`, occurred_at:grant.received_date || grant.resolution_date || grant.application_date }); }
      catch (error) { showToast(error instanceof Error ? `Subvención guardada, pero no se pudo actualizar Caja: ${error.message}` : "Subvención guardada, pero no se pudo actualizar Caja","err"); }
      closeForm();
    }
  }
  async function changeStatus(grant: ProjectGrant, status: ProjectGrant["status"]) {
    const amount = grant.received_cents || grant.awarded_cents || grant.requested_cents;
    const updated = { ...grant, status, awarded_cents:["awarded","received","closed"].includes(status) ? (grant.awarded_cents || grant.requested_cents) : grant.awarded_cents, received_cents:status === "received" ? amount : grant.received_cents, received_date:status === "received" ? (grant.received_date || new Date().toISOString().slice(0,10)) : grant.received_date };
    if (await persist(grants.map((item)=>item.id===grant.id?updated:item),"Subvención actualizada")) {
      try { await api.syncProjectGrantIncome({ project_id:project.id, beneficiary_company_id:updated.beneficiary_company_id ?? project.task_company_id ?? project.company_id, grant_id:grant.id, amount_cents:recognizedCents(updated), description:`[${project.name}] Subvención: ${grant.name}`, occurred_at:updated.received_date || updated.resolution_date || updated.application_date }); }
      catch (error) { showToast(error instanceof Error ? `No se pudo actualizar Caja: ${error.message}` : "No se pudo actualizar Caja","err"); }
    }
  }
  async function remove(id:string) {
    if (await persist(grants.filter((item)=>item.id!==id),"Subvención eliminada")) {
      try { const grant=grants.find((item)=>item.id===id); await api.syncProjectGrantIncome({ project_id:project.id, beneficiary_company_id:grant?.beneficiary_company_id ?? project.task_company_id ?? project.company_id, grant_id:id, amount_cents:0, description:"", occurred_at:null }); }
      catch (error) { showToast(error instanceof Error ? `No se pudo retirar su entrada de Caja: ${error.message}` : "No se pudo retirar su entrada de Caja","err"); }
    }
  }
</script>

<section class="mt-5 rounded-xl border border-amber-300/20 bg-amber-500/[0.035] p-4 {readonly ? 'project-grants-readonly' : ''}" data-project-grants>
  <div class="flex flex-wrap items-start justify-between gap-3"><div><span class="section-label">SUBVENCIONES</span><p class="mt-1 text-xs text-[var(--color-muted)]">{readonly ? "Vista de las subvenciones vinculadas. La gestión se realiza desde Finanzas." : "Seguimiento de negociación, adjudicación, cobro y posible devolución."}</p></div>{#if $isAdmin && !readonly}<Button variant="secondary" onclick={() => open ? closeForm() : newGrant()}>{open?"Cancelar":"+ Añadir subvención"}</Button>{/if}</div>
  <div class="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5"><div class="rounded-lg bg-black/15 p-3"><p class="text-[10px] uppercase text-[var(--color-muted)]">Adjudicado</p><strong class="text-amber-200">{formatEUR(awarded)}</strong></div><div class="rounded-lg bg-black/15 p-3"><p class="text-[10px] uppercase text-[var(--color-muted)]">Comisión gestora</p><strong class="text-rose-200">{formatEUR(managementFees)}</strong></div><div class="rounded-lg bg-black/15 p-3"><p class="text-[10px] uppercase text-[var(--color-muted)]">Neto disponible</p><strong class="text-cyan-200">{formatEUR(netAwarded)}</strong></div><div class="rounded-lg bg-black/15 p-3"><p class="text-[10px] uppercase text-[var(--color-muted)]">Cobrado</p><strong class="text-emerald-200">{formatEUR(received)}</strong></div><div class="rounded-lg bg-black/15 p-3"><p class="text-[10px] uppercase text-[var(--color-muted)]">A devolver</p><strong class={repayable?"text-rose-200":"text-[var(--color-text)]"}>{formatEUR(repayable)}</strong></div></div>
  {#if open}<div class="mt-4 grid gap-3 rounded-xl border border-white/[0.08] bg-black/15 p-3 md:grid-cols-2"><p class="text-sm font-semibold text-purple-200 md:col-span-2">{editingId ? "Editar subvención" : "Nueva subvención"}</p><input class="field md:col-span-2" bind:value={form.name} placeholder="Nombre o convocatoria"/><input class="field" bind:value={form.authority} placeholder="Organismo concedente"/><input class="field" bind:value={form.reference} placeholder="Referencia / expediente"/><Select options={[{value:"preparing",label:"Preparando"},{value:"negotiating",label:"En negociación"},{value:"awarded",label:"Adjudicada"},{value:"received",label:"Cobrada"},{value:"rejected",label:"Rechazada"},{value:"closed",label:"Cerrada"}]} bind:value={form.status}/><Select options={[{value:"non_repayable",label:"A fondo perdido"},{value:"repayable",label:"Reembolsable"}]} bind:value={form.funding_type}/><MoneyInput bind:value={form.requested} placeholder="Importe solicitado (€)"/><MoneyInput bind:value={form.awarded} placeholder="Importe adjudicado (€)"/><MoneyInput bind:value={form.received} placeholder="Importe cobrado (€)"/>{#if form.funding_type === "repayable"}<MoneyInput bind:value={form.repayable} placeholder="Importe a devolver (€)"/>{/if}<input class="field" bind:value={form.managing_company} placeholder="Empresa gestora"/><input class="field" inputmode="decimal" bind:value={form.management_fee_percent} placeholder="Comisión gestora (%)"/><label class="grid gap-1 text-xs text-[var(--color-muted)]">Solicitud<DatePicker bind:value={form.application_date}/></label><label class="grid gap-1 text-xs text-[var(--color-muted)]">Resolución<DatePicker bind:value={form.resolution_date}/></label>{#if (parseEurosInput(form.received) ?? 0) > 0 || form.status === "received"}<label class="grid gap-1 text-xs text-[var(--color-muted)]">Fecha de cobro<DatePicker bind:value={form.received_date}/></label>{/if}{#if form.funding_type === "repayable"}<label class="grid gap-1 text-xs text-[var(--color-muted)]">Fecha límite de devolución<DatePicker bind:value={form.repayment_date}/></label>{/if}<textarea class="field min-h-16 md:col-span-2" bind:value={form.notes} placeholder="Condiciones, justificación, hitos y observaciones"></textarea><div class="md:col-span-2 flex justify-end"><Button variant="primary" disabled={saving} onclick={save}>{editingId ? "Guardar cambios" : "Guardar subvención"}</Button></div></div>{/if}
  <div class="mt-4 space-y-2">{#each grants as grant (grant.id)}<article class="rounded-xl border border-white/[0.07] bg-black/10 p-3"><div class="flex flex-wrap items-start justify-between gap-3"><div><p class="text-sm font-semibold">{grant.name}</p><p class="mt-1 text-xs text-[var(--color-muted)]">{grant.authority||"Sin organismo"}{grant.reference?` · ${grant.reference}`:""} · {grant.funding_type==="non_repayable"?"A fondo perdido":"Reembolsable"}</p>{#if grant.managing_company}<p class="mt-1 text-xs text-purple-200">Gestiona {grant.managing_company} · {grant.management_fee_percent}% ({formatEUR(feeCents(grant))}) · neto {formatEUR(Math.max(0,grant.awarded_cents-feeCents(grant)))}</p>{/if}{#if grant.status === "received" && grant.received_cents <= 0}<p class="mt-1 text-xs font-semibold text-amber-300">Falta indicar el importe cobrado para registrarlo en Caja.</p>{/if}</div><div class="flex items-center gap-2"><Badge tone={tone(grant.status)}>{statusLabel(grant.status)}</Badge>{#if $isAdmin}<Button variant="ghost" onclick={()=>edit(grant)}>Editar</Button><Select class="w-40 text-xs" options={[{value:"preparing",label:"Preparando"},{value:"negotiating",label:"En negociación"},{value:"awarded",label:"Adjudicada"},{value:"received",label:"Cobrada"},{value:"rejected",label:"Rechazada"},{value:"closed",label:"Cerrada"}]} value={grant.status} onvaluechange={(value)=>changeStatus(grant,value as ProjectGrant["status"])}/><Button variant="ghost" onclick={()=>remove(grant.id)}>Eliminar</Button>{/if}</div></div><div class="mt-3 grid gap-2 text-xs sm:grid-cols-3 lg:grid-cols-5"><span>Solicitado <strong>{formatEUR(grant.requested_cents)}</strong></span><span>Adjudicado <strong>{formatEUR(grant.awarded_cents)}</strong></span><span>Cobrado <strong>{formatEUR(grant.received_cents)}</strong></span>{#if grant.funding_type === "repayable"}<span class="text-rose-200">A devolver <strong>{formatEUR(grant.repayable_cents)}</strong></span><span>Vence <strong>{date(grant.repayment_date)}</strong></span>{:else}<span class="text-emerald-200">Sin devolución</span>{/if}</div>{#if grant.notes}<p class="mt-2 text-xs text-[var(--color-muted)]">{grant.notes}</p>{/if}</article>{/each}{#if !grants.length}<p class="rounded-lg border border-dashed border-white/10 p-3 text-xs text-[var(--color-muted)]">No hay subvenciones vinculadas a este proyecto.</p>{/if}</div>
</section>

<style>
  .project-grants-readonly article :global(button) { display: none; }
</style>
