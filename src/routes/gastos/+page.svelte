<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api/client";
  import type { ExpenseDocument, ExpenseAttachment, WorkProject } from "$lib/types";
  import { showToast } from "$lib/stores/ui";
  import Button from "$lib/components/Button.svelte";
  import Card from "$lib/components/Card.svelte";
  import Badge from "$lib/components/Badge.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import Select from "$lib/components/Select.svelte";
  import Input from "$lib/components/Input.svelte";
  import { formatEUR } from "$lib/money";

  let expenses = $state<ExpenseDocument[]>([]);
  let projects = $state<WorkProject[]>([]);
  let loading = $state(true);
  let modalOpen = $state(false);
  let saving = $state(false);
  let dropActive = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);
  let editing = $state<ExpenseDocument | null>(null);
  let attachment = $state<ExpenseAttachment | null>(null);
  let form = $state({ title: "", supplier_name: "", supplier_tax_id: "", invoice_number: "", issued_at: "", category: "otros", base: "", vat: "", total: "", notes: "", project_id: "", kind: "invoice" as ExpenseDocument["kind"] });
  const statusLabels: Record<ExpenseDocument["status"], string> = { draft: "Borrador", review: "Pendiente de revisión", approved: "Aprobada", paid: "Pagada", rejected: "Rechazada" };
  const kindOptions = [{ value: "invoice", label: "Factura" }, { value: "ticket", label: "Ticket" }, { value: "simplified_invoice", label: "Factura simplificada" }, { value: "credit_note", label: "Abono" }, { value: "receipt", label: "Justificante" }];

  async function load() { loading = true; try { [expenses, projects] = await Promise.all([api.listExpenseDocuments(), api.listWorkProjects()]); } catch (error) { showToast(error instanceof Error ? error.message : "No se pudieron cargar los gastos", "err"); } finally { loading = false; } }
  onMount(load);
  function reset() { editing = null; attachment = null; form = { title: "", supplier_name: "", supplier_tax_id: "", invoice_number: "", issued_at: "", category: "otros", base: "", vat: "", total: "", notes: "", project_id: "", kind: "invoice" }; modalOpen = true; }
  function edit(item: ExpenseDocument) { editing = item; attachment = item.attachments[0] ?? null; form = { title: item.title, supplier_name: item.supplier_name, supplier_tax_id: item.supplier_tax_id, invoice_number: item.invoice_number, issued_at: item.issued_at?.slice(0, 10) ?? "", category: item.category, base: String(item.base_cents / 100), vat: String(item.vat_cents / 100), total: String(item.total_cents / 100), notes: item.notes, project_id: item.project_id ? String(item.project_id) : "", kind: item.kind }; modalOpen = true; }
  function readFile(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); }); }
  async function selectFile(file?: File) { if (!file) return; if (file.size > 20 * 1024 * 1024) { showToast("El archivo supera el límite de 20 MB", "err"); return; } if (!file.type.startsWith("image/") && file.type !== "application/pdf") { showToast("Solo se admiten imágenes o PDF", "err"); return; } attachment = { id: crypto.randomUUID(), name: file.name, mime_type: file.type || "application/octet-stream", size: file.size, data_url: await readFile(file) }; if (!form.title) form.title = file.name.replace(/\.[^.]+$/, ""); }
  async function save() { if (!form.title.trim() || saving) return; saving = true; try { await api.upsertExpenseDocument({ id: editing?.id, title: form.title.trim(), supplier_name: form.supplier_name, supplier_tax_id: form.supplier_tax_id, invoice_number: form.invoice_number, issued_at: form.issued_at || null, category: form.category, base_cents: Math.round(Number(form.base || 0) * 100), vat_cents: Math.round(Number(form.vat || 0) * 100), total_cents: Math.round(Number(form.total || 0) * 100), project_id: form.project_id ? Number(form.project_id) : null, kind: form.kind, notes: form.notes, attachments: attachment ? [attachment] : [], source: "upload" }); modalOpen = false; showToast("Factura guardada para revisión"); await load(); } catch (error) { showToast(error instanceof Error ? error.message : "No se pudo guardar la factura", "err"); } finally { saving = false; } }
  async function approve(item: ExpenseDocument) { try { await api.approveExpenseDocument(item.id); showToast("Gasto aprobado y añadido a Caja"); await load(); } catch (error) { showToast(error instanceof Error ? error.message : "No se pudo aprobar el gasto", "err"); } }
  function statusTone(status: ExpenseDocument["status"]): "neutral" | "ok" | "warn" | "danger" { return status === "approved" || status === "paid" ? "ok" : status === "rejected" ? "danger" : status === "review" ? "warn" : "neutral"; }
</script>

<section class="workspace-page space-y-6">
  <div class="flex flex-wrap items-end justify-between gap-4"><div><p class="workspace-index">GASTOS Y FACTURAS</p><h1 class="text-3xl font-semibold text-[var(--color-text)]">Bandeja de facturas recibidas</h1><p class="mt-1 text-sm text-[var(--color-muted)]">Sube una factura o ticket, revísalo y apruébalo antes de incorporarlo a Caja.</p></div><Button variant="primary" onclick={reset}>+ Nueva factura</Button></div>
  {#if loading}<p class="py-12 text-center text-sm text-[var(--color-muted-dim)]">Cargando documentos…</p>{:else if expenses.length === 0}<Card lift={false} class="border-dashed p-10 text-center"><p class="text-sm text-[var(--color-muted)]">Todavía no hay facturas recibidas.</p><Button class="mt-4" variant="secondary" onclick={reset}>Subir primera factura</Button></Card>{:else}<div class="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">{#each expenses as item (item.id)}<Card lift={false} class="p-4"><div class="flex items-start justify-between gap-3"><div class="min-w-0"><p class="truncate font-semibold text-[var(--color-text)]">{item.title}</p><p class="mt-1 text-xs text-[var(--color-muted)]">{item.supplier_name || "Proveedor pendiente"}{item.invoice_number ? ` · ${item.invoice_number}` : ""}</p></div><Badge tone={statusTone(item.status)}>{statusLabels[item.status]}</Badge></div><div class="mt-4 flex items-end justify-between"><div><p class="text-xs text-[var(--color-muted-dim)]">Total</p><p class="text-xl font-semibold tabular text-[var(--color-text)]">{formatEUR(item.total_cents)}</p></div><div class="flex gap-2">{#if item.status === "review"}<Button variant="secondary" class="text-xs" onclick={() => approve(item)}>Aprobar</Button>{/if}<Button variant="ghost" class="text-xs" onclick={() => edit(item)}>Revisar</Button></div></div>{#if item.attachments.length}<p class="mt-3 truncate text-[11px] text-purple-200">📎 {item.attachments[0].name}</p>{/if}</Card>{/each}</div>{/if}
</section>

<Modal open={modalOpen} title={editing ? "Revisar factura" : "Nueva factura o ticket"} size="xl" onclose={() => !saving && (modalOpen = false)}>
  <form class="space-y-4" onsubmit={(event) => { event.preventDefault(); save(); }}>
    <div class="grid gap-3 sm:grid-cols-2"><Input label="Título" bind:value={form.title} required placeholder="Factura proveedor…" /><Select label="Tipo" options={kindOptions} bind:value={form.kind} /></div>
    <div class="grid gap-3 sm:grid-cols-2"><Input label="Proveedor" bind:value={form.supplier_name} /><Input label="NIF del proveedor" bind:value={form.supplier_tax_id} /><Input label="Número de factura" bind:value={form.invoice_number} /><label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Fecha</span><input class="field w-full" type="date" bind:value={form.issued_at} /></label></div>
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Input label="Base imponible (€)" bind:value={form.base} /><Input label="IVA (€)" bind:value={form.vat} /><Input label="Total (€)" bind:value={form.total} /><Input label="Categoría" bind:value={form.category} /></div>
    <Select label="Proyecto" options={[{ value: "", label: "Sin proyecto" }, ...projects.map((project) => ({ value: String(project.id), label: project.name }))]} bind:value={form.project_id} />
    <label class="block text-sm"><span class="mb-1 block text-[var(--color-muted)]">Documento original</span><div class="rounded-xl border border-dashed p-5 text-center transition {dropActive ? 'border-purple-400 bg-purple-500/10' : 'border-[var(--color-border)]'}" role="button" tabindex="0" onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") fileInput?.click(); }} ondragover={(event) => { event.preventDefault(); dropActive = true; }} ondragleave={() => (dropActive = false)} ondrop={(event) => { event.preventDefault(); dropActive = false; selectFile(event.dataTransfer?.files?.[0]); }} onclick={() => fileInput?.click()}><input bind:this={fileInput} class="sr-only" type="file" accept="image/*,application/pdf" onchange={(event) => selectFile(event.currentTarget.files?.[0])} /><p class="text-sm text-[var(--color-text)]">Arrastra una imagen o PDF aquí</p><p class="mt-1 text-xs text-[var(--color-muted-dim)]">Hasta 20 MB · también puedes hacer clic para seleccionarlo</p>{#if attachment}<p class="mt-3 text-xs text-emerald-300">📎 {attachment.name}</p>{/if}</div></label>
    <label class="block text-sm"><span class="mb-1 block text-[var(--color-muted)]">Notas</span><textarea class="field min-h-20 w-full" bind:value={form.notes} placeholder="Contexto, pago, proyecto…"></textarea></label>
    <div class="flex justify-end gap-2 border-t border-[var(--color-border)] pt-4"><Button type="button" variant="ghost" onclick={() => (modalOpen = false)}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar para revisión"}</Button></div>
  </form>
</Modal>
