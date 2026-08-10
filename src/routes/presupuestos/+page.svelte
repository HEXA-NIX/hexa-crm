<script lang="ts">
  import { onMount } from "svelte";
  import Button from "$lib/components/Button.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import { api } from "$lib/api/client";
  import { formatEUR } from "$lib/money";
  import type { Budget, BudgetStatus, Customer } from "$lib/types";
  import type { VatRate } from "$lib/vat";

  type EditorLine = { concept: string; description: string; quantity: string; price: string; vat: VatRate };
  const emptyLine = (): EditorLine => ({ concept: "", description: "", quantity: "1", price: "0", vat: 21 });
  const statusLabels: Record<BudgetStatus, string> = { draft: "Borrador", sent: "Enviado", accepted: "Aceptado", rejected: "Rechazado", expired: "Vencido", invoiced: "Facturado", cancelled: "Cancelado" };

  let budgets = $state<Budget[]>([]);
  let customers = $state<Customer[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let converting = $state(false);
  let notice = $state("");
  let error = $state("");
  let search = $state("");
  let statusFilter = $state<BudgetStatus | "all">("all");
  let editorOpen = $state(false);
  let previewOpen = $state(false);
  let detailOpen = $state(false);
  let actionId = $state<number | null>(null);
  let selected = $state<Budget | null>(null);
  let editingId = $state<number | null>(null);
  let series = $state("E");
  let number = $state("");
  let clientId = $state("");
  let operationDate = $state(new Date().toISOString().slice(0, 10));
  let dueDate = $state("");
  let projectExplanation = $state("");
  let paymentMethod = $state("");
  let account = $state("");
  let tags = $state("");
  let notes = $state("");
  let irpfRate = $state("0");
  let lines = $state<EditorLine[]>([emptyLine()]);

  const visibleBudgets = $derived(budgets.filter((budget) => {
    const haystack = `${budget.series}${budget.number} ${budget.customer_name} ${budget.project_explanation}`.toLocaleLowerCase();
    return (statusFilter === "all" || budget.status === statusFilter) && haystack.includes(search.trim().toLocaleLowerCase());
  }));
  const editorTotals = $derived.by(() => {
    let base = 0; let vat = 0;
    for (const line of lines) {
      const quantity = Number(line.quantity) || 0;
      const price = Math.round((Number(line.price) || 0) * 100);
      const rowBase = Math.round(quantity * price);
      base += rowBase; vat += Math.round(rowBase * line.vat / 100);
    }
    const irpf = Math.round(base * (Number(irpfRate) || 0) / 100);
    return { base, vat, irpf, total: base + vat - irpf };
  });

  function flash(message: string, isError = false) {
    if (isError) error = message; else notice = message;
    window.setTimeout(() => { if (isError) error = ""; else notice = ""; }, 3500);
  }

  async function load() {
    loading = true; error = "";
    try {
      [budgets, customers] = await Promise.all([api.listBudgets(), api.listCustomers()]);
    } catch (e) { error = e instanceof Error ? e.message : "No se pudieron cargar los presupuestos"; }
    finally { loading = false; }
  }

  function resetEditor() {
    editingId = null; series = "E"; number = ""; clientId = ""; operationDate = new Date().toISOString().slice(0, 10); dueDate = "";
    projectExplanation = ""; paymentMethod = ""; account = ""; tags = ""; notes = ""; irpfRate = "0"; lines = [emptyLine()];
  }

  function openNew() { resetEditor(); editorOpen = true; }
  function openEdit(budget: Budget) {
    if (!["draft", "sent"].includes(budget.status)) { flash("Solo se pueden editar presupuestos en borrador o enviados", true); return; }
    editingId = budget.id; series = budget.series; number = budget.number; clientId = budget.customer_id == null ? "" : String(budget.customer_id); operationDate = budget.operation_date; dueDate = budget.due_at ?? "";
    projectExplanation = budget.project_explanation; paymentMethod = budget.payment_method; account = budget.account; tags = budget.tags.join(", "); notes = budget.notes; irpfRate = String(budget.irpf_rate);
    lines = budget.lines.map((line) => ({ concept: line.description.split(" — ")[0], description: line.description.split(" — ").slice(1).join(" — "), quantity: String(line.quantity), price: String(line.unit_price_cents / 100), vat: line.vat_rate }));
    if (!lines.length) lines = [emptyLine()];
    editorOpen = true;
  }

  function updateLine(index: number, key: keyof EditorLine, value: string) { lines = lines.map((line, i) => i === index ? { ...line, [key]: key === "vat" ? Number(value) as VatRate : value } : line); }
  function addLine() { lines = [...lines, emptyLine()]; }
  function removeLine(index: number) { if (lines.length > 1) lines = lines.filter((_, i) => i !== index); }

  async function save(status: "draft" | "sent") {
    if (saving) return;
    if (!projectExplanation.trim()) { flash("Explica primero el proyecto y su alcance", true); return; }
    const normalized = lines.filter((line) => line.concept.trim() || line.description.trim() || Number(line.price) > 0).map((line) => ({ description: [line.concept.trim(), line.description.trim()].filter(Boolean).join(" — "), quantity: Number(line.quantity), unit_price_cents: Math.round((Number(line.price) || 0) * 100), vat_rate: line.vat }));
    if (!normalized.length) { flash("Añade al menos una línea al presupuesto", true); return; }
    saving = true;
    try {
      const saved = await api.upsertBudget({ id: editingId, series, number: number || undefined, status, operation_date: operationDate, due_at: dueDate || null, customer_id: clientId ? Number(clientId) : null, project_explanation: projectExplanation, lines: normalized, irpf_rate: Number(irpfRate) || 0, payment_method: paymentMethod, account, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean), notes });
      await load(); selected = saved; editorOpen = false; flash(status === "draft" ? "Borrador guardado en PostgreSQL" : "Presupuesto enviado y guardado en PostgreSQL");
    } catch (e) { flash(e instanceof Error ? e.message : "No se pudo guardar el presupuesto", true); }
    finally { saving = false; }
  }

  async function changeStatus(budget: Budget, status: BudgetStatus) {
    actionId = null;
    try { const updated = await api.updateBudgetStatus(budget.id, status); budgets = budgets.map((row) => row.id === updated.id ? updated : row); selected = updated; flash(`Estado actualizado: ${statusLabels[status]}`); }
    catch (e) { flash(e instanceof Error ? e.message : "No se pudo actualizar el estado", true); }
  }

  async function convert(budget: Budget | null) {
    if (!budget) return;
    if (converting) return;
    converting = true; actionId = null;
    try { const result = await api.convertBudgetToInvoice(budget.id); budgets = budgets.map((row) => row.id === result.budget.id ? result.budget : row); selected = result.budget; flash(`Factura ${result.invoice.series}-${result.invoice.number} creada y vinculada`); }
    catch (e) { flash(e instanceof Error ? e.message : "No se pudo convertir el presupuesto", true); }
    finally { converting = false; }
  }

  async function remove(budget: Budget) {
    actionId = null;
    if (!window.confirm(`¿Eliminar el borrador ${budget.series}-${budget.number}?`)) return;
    try { await api.deleteBudget(budget.id); budgets = budgets.filter((row) => row.id !== budget.id); if (selected?.id === budget.id) selected = null; flash("Borrador eliminado de PostgreSQL"); }
    catch (e) { flash(e instanceof Error ? e.message : "No se pudo eliminar", true); }
  }

  function duplicate(budget: Budget) { actionId = null; selected = null; editingId = null; series = budget.series; number = ""; clientId = budget.customer_id == null ? "" : String(budget.customer_id); operationDate = new Date().toISOString().slice(0, 10); dueDate = budget.due_at ?? ""; projectExplanation = budget.project_explanation; paymentMethod = budget.payment_method; account = budget.account; tags = budget.tags.join(", "); notes = budget.notes; irpfRate = String(budget.irpf_rate); lines = budget.lines.map((line) => ({ concept: line.description, description: "", quantity: String(line.quantity), price: String(line.unit_price_cents / 100), vat: line.vat_rate })); editorOpen = true; }
  function printBudget(budget: Budget) { selected = budget; detailOpen = true; window.setTimeout(() => window.print(), 50); }
  function openDetail(budget: Budget) { selected = budget; detailOpen = true; actionId = null; }

  onMount(() => { void load(); const close = (event: MouseEvent) => { if (!(event.target as HTMLElement)?.closest(".budget-actions, .budget-more")) actionId = null; }; document.addEventListener("click", close); return () => document.removeEventListener("click", close); });
</script>

<section class="workspace-page">
  {#if notice}<div class="notice success" role="status">{notice}</div>{/if}
  {#if error}<div class="notice error" role="alert">{error}</div>{/if}
  <div class="page-heading"><div><p class="eyebrow">Ventas</p><h2>Presupuestos <span class="info">ⓘ</span></h2></div><Button onclick={openNew}>Nuevo presupuesto</Button></div>
  <div class="toolbar"><select class="field" aria-label="Filtrar por estado" bind:value={statusFilter}><option value="all">Todos</option>{#each Object.entries(statusLabels) as [value, label]}<option value={value}>{label}</option>{/each}</select><div class="search-wrap"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.6" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><input class="field" placeholder="Buscar número, cliente o proyecto…" aria-label="Buscar presupuestos" bind:value={search} /></div></div>
  {#if loading}<div class="panel state">Cargando presupuestos desde PostgreSQL…</div>{:else if visibleBudgets.length === 0}<div class="panel state"><strong>{budgets.length ? "No hay resultados" : "Todavía no hay presupuestos"}</strong><span>{budgets.length ? "Cambia la búsqueda o el estado." : "Crea el primer presupuesto; quedará guardado en la empresa activa."}</span>{#if !budgets.length}<Button variant="secondary" onclick={openNew}>Crear presupuesto</Button>{/if}</div>{:else}
    <div class="table-card"><div class="table-scroll"><table><thead><tr><th>Fecha</th><th>Nº</th><th>Vencimiento</th><th>Cliente</th><th>Proyecto / alcance</th><th class="num">Subtotal</th><th class="num">IVA</th><th class="num">Total</th><th>Estado</th><th>Facturado</th><th></th></tr></thead><tbody>{#each visibleBudgets as budget (budget.id)}<tr class="clickable" onclick={() => openDetail(budget)}><td>{budget.operation_date}</td><td class="strong">{budget.series}-{budget.number}</td><td>{budget.due_at ?? "—"}</td><td>{budget.customer_name || "Sin cliente"}</td><td class="description">{budget.project_explanation}</td><td class="num">{formatEUR(budget.base_cents)}</td><td class="num">{formatEUR(budget.vat_cents)}</td><td class="num strong">{formatEUR(budget.total_cents)}</td><td><span class="status status-{budget.status}">{statusLabels[budget.status]}</span></td><td>{budget.invoice_id ? "Facturado" : "—"}</td><td class="actions-cell"><button class="budget-more" aria-label="Acciones" onclick={(event) => { event.stopPropagation(); actionId = actionId === budget.id ? null : budget.id; }}>⋮</button>{#if actionId === budget.id}<div class="budget-actions"><button onclick={() => openEdit(budget)} disabled={!['draft','sent'].includes(budget.status)}>Editar</button>{#if budget.status === "draft"}<button onclick={() => void changeStatus(budget, "sent")}>Marcar como enviado</button>{/if}{#if ["draft", "sent"].includes(budget.status)}<button onclick={() => void changeStatus(budget, "accepted")}>Aceptar</button><button onclick={() => void changeStatus(budget, "rejected")}>Rechazar</button><button onclick={() => void changeStatus(budget, "cancelled")}>Cancelar presupuesto</button>{/if}{#if budget.status === "sent"}<button onclick={() => void changeStatus(budget, "expired")}>Marcar vencido</button>{/if}{#if budget.status === "accepted"}<button onclick={() => void convert(budget)}>Convertir en factura</button>{/if}<button onclick={() => printBudget(budget)}>Imprimir</button><button onclick={() => duplicate(budget)}>Duplicar</button>{#if budget.status === "draft"}<button class="danger" onclick={() => void remove(budget)}>Eliminar borrador</button>{/if}</div>{/if}</td></tr>{/each}</tbody><tfoot><tr><td colspan="5">{visibleBudgets.length} presupuesto{visibleBudgets.length === 1 ? "" : "s"}</td><td class="num">{formatEUR(visibleBudgets.reduce((sum, row) => sum + row.base_cents, 0))}</td><td class="num">{formatEUR(visibleBudgets.reduce((sum, row) => sum + row.vat_cents, 0))}</td><td class="num">{formatEUR(visibleBudgets.reduce((sum, row) => sum + row.total_cents, 0))}</td><td colspan="3"></td></tr></tfoot></table></div></div>
  {/if}
</section>

  {#if editorOpen}
  <section class="workspace-page editor"><div class="editor-head"><div><button class="back" onclick={() => (editorOpen = false)}>‹ Volver</button><h2>{editingId ? "Editar presupuesto" : "Nuevo presupuesto"}</h2></div><div class="editor-actions"><Button variant="ghost" onclick={() => (previewOpen = true)}>Vista previa</Button><Button variant="secondary" disabled={saving} onclick={() => void save("draft")}>Guardar borrador</Button><Button disabled={saving} onclick={() => void save("sent")}>{saving ? "Guardando…" : "Guardar y enviar"}</Button></div></div><div class="surface"><div class="explanation"><h3>Primero: explica el proyecto</h3><p>Esta introducción abre el documento y ayuda al cliente a entender el valor, alcance, fases y condiciones antes de ver los importes.</p><textarea class="field" rows="5" bind:value={projectExplanation} placeholder="Qué problema resolvemos, qué entregamos, fases, límites y condiciones…"></textarea></div><div class="meta-grid"><label>Contacto<select class="field" bind:value={clientId}><option value="">Seleccionar contacto</option>{#each customers as customer}<option value={customer.id}>{customer.name}{customer.nif ? ` · ${customer.nif}` : ""}</option>{/each}</select></label><label>Serie<input class="field" bind:value={series} maxlength="8" /></label><label>Número<input class="field" bind:value={number} placeholder="Automático" /></label><label>Fecha<input class="field" type="date" bind:value={operationDate} /></label><label>Vencimiento<input class="field" type="date" bind:value={dueDate} /></label></div><div class="line-head"><span>Concepto</span><span>Descripción</span><span>Cantidad</span><span>Precio</span><span>IVA</span><span>Total</span><span></span></div>{#each lines as line, index}<div class="line-row"><input class="field" placeholder="Servicio o concepto" value={line.concept} oninput={(event) => updateLine(index, "concept", event.currentTarget.value)} /><input class="field" placeholder="Detalle" value={line.description} oninput={(event) => updateLine(index, "description", event.currentTarget.value)} /><input class="field" type="number" min="0.01" step="0.01" value={line.quantity} oninput={(event) => updateLine(index, "quantity", event.currentTarget.value)} /><input class="field" type="number" min="0" step="0.01" value={line.price} oninput={(event) => updateLine(index, "price", event.currentTarget.value)} /><select class="field" value={line.vat} onchange={(event) => updateLine(index, "vat", event.currentTarget.value)}><option value={21}>21%</option><option value={10}>10%</option><option value={4}>4%</option><option value={0}>0%</option></select><span class="num">{formatEUR(Math.round((Number(line.quantity) || 0) * (Number(line.price) || 0) * 100 * (1 + line.vat / 100)))} </span><button class="remove" aria-label="Eliminar línea" onclick={() => removeLine(index)}>×</button></div>{/each}<Button class="Button" variant="secondary" onclick={addLine}>＋ Añadir línea</Button><div class="totals"><span>Subtotal <strong>{formatEUR(editorTotals.base)}</strong></span><span>IVA <strong>{formatEUR(editorTotals.vat)}</strong></span><label>Retención %<input class="field small" type="number" min="0" max="100" step="0.01" bind:value={irpfRate} /></label><span>Total <strong>{formatEUR(editorTotals.total)}</strong></span></div><div class="bottom-grid"><label>Método de pago<input class="field" bind:value={paymentMethod} placeholder="Transferencia bancaria…" /></label><label>Cuenta contable<input class="field" bind:value={account} placeholder="70000000 Ventas…" /></label><label>Etiquetas<input class="field" bind:value={tags} placeholder="servicio, proyecto…" /></label><label>Notas<input class="field" bind:value={notes} placeholder="Condiciones internas…" /></label></div></div></section>
{/if}

<Modal open={detailOpen && !!selected} title={selected ? `${selected.customer_name || "Presupuesto"} · ${selected.series}-${selected.number}` : "Presupuesto"} size="fluid" onclose={() => (detailOpen = false)}>
  {#if selected}<div class="detail-layout"><article class="document"><header><div><strong>HEXA</strong><p>Presupuesto {selected.series}-{selected.number}</p></div><div class="right">Fecha: {selected.operation_date}<br />Vencimiento: {selected.due_at ?? "—"}</div></header><div class="client"><strong>Cliente</strong><br />{selected.customer_name || "Sin cliente"}{#if selected.customer_nif}<br />NIF: {selected.customer_nif}{/if}{#if selected.customer_email}<br />{selected.customer_email}{/if}</div><section class="document-explanation"><h3>PROYECTO Y ALCANCE</h3><p>{selected.project_explanation}</p></section><h3>CONCEPTOS</h3>{#each selected.lines as line}<div class="document-line"><strong>{line.description}</strong><span>{line.quantity} × {formatEUR(line.unit_price_cents)} · IVA {line.vat_rate}%</span><b>{formatEUR(line.total_cents)}</b></div>{/each}<div class="document-total"><span>Base imponible <strong>{formatEUR(selected.base_cents)}</strong></span><span>IVA <strong>{formatEUR(selected.vat_cents)}</strong></span>{#if selected.irpf_cents}<span>Retención <strong>−{formatEUR(selected.irpf_cents)}</strong></span>{/if}<span>Total <strong>{formatEUR(selected.total_cents)}</strong></span></div></article><aside class="detail-panel"><div class="detail-tabs"><span class="active">General</span></div><section><small>Estado</small><strong><span class="status status-{selected.status}">{statusLabels[selected.status]}</span></strong></section><section><small>Total</small><strong class="large">{formatEUR(selected.total_cents)}</strong></section><section><small>Facturación</small>{#if selected.invoice_id}<span>Factura vinculada #{selected.invoice_id}</span>{:else}<span>No facturado</span>{#if selected.status === "accepted"}<button class="link" onclick={() => void convert(selected)}>Convertir en factura</button>{/if}{/if}</section><section><small>Acciones</small><div class="detail-buttons">{#if ["draft", "sent"].includes(selected.status)}<Button variant="secondary" onclick={() => { detailOpen = false; openEdit(selected!); }}>Editar</Button>{/if}{#if selected.status === "draft"}<Button variant="secondary" onclick={() => void changeStatus(selected!, "sent")}>Marcar enviado</Button>{/if}{#if ["draft", "sent"].includes(selected.status)}<Button variant="secondary" onclick={() => void changeStatus(selected!, "accepted")}>Aceptar</Button>{/if}<Button variant="ghost" onclick={() => printBudget(selected!)}>Imprimir</Button></div></section></aside></div>{/if}
</Modal>

<Modal open={previewOpen} title={`Vista previa · ${series}-${number || "automático"}`} size="xl" onclose={() => (previewOpen = false)}><article class="document preview"><header><div><strong>HEXA</strong><p>Presupuesto {series}-{number || "automático"}</p></div><div class="right">Fecha: {operationDate}<br />Vencimiento: {dueDate || "—"}</div></header><div class="client"><strong>Cliente</strong><br />{customers.find((customer) => String(customer.id) === clientId)?.name || "Sin cliente"}</div><section class="document-explanation"><h3>PROYECTO Y ALCANCE</h3><p>{projectExplanation || "Añade la explicación del proyecto para mostrarla aquí."}</p></section><h3>CONCEPTOS</h3>{#each lines.filter((line) => line.concept || line.description || Number(line.price) > 0) as line}<div class="document-line"><strong>{line.concept || line.description}</strong><span>{line.description} · {line.quantity} × {formatEUR(Math.round((Number(line.price) || 0) * 100))}</span></div>{/each}<div class="document-total"><span>Base imponible <strong>{formatEUR(editorTotals.base)}</strong></span><span>IVA <strong>{formatEUR(editorTotals.vat)}</strong></span><span>Total <strong>{formatEUR(editorTotals.total)}</strong></span></div></article></Modal>

<style>
  .page-heading,.editor-head{display:flex;align-items:flex-end;justify-content:space-between;gap:1rem;margin-bottom:1.25rem}.eyebrow{color:var(--color-muted-dim);font-size:.7rem;text-transform:uppercase;letter-spacing:.18em}.page-heading h2,.editor-head h2{margin-top:.25rem;font-size:1.5rem;font-weight:700}.info{font-size:.75rem;color:var(--color-muted)}
  .toolbar{display:flex;align-items:center;gap:.75rem;padding:.5rem;border:1px solid var(--color-border);border-radius:.7rem;background:var(--color-obsidian-panel);margin-bottom:1rem}.toolbar select{min-width:10rem}.search-wrap{position:relative;margin-left:auto;width:min(28rem,42vw)}.search-wrap svg{position:absolute;left:.75rem;top:50%;width:1.15rem;transform:translateY(-50%);color:var(--color-muted);pointer-events:none}.search-wrap input{width:100%;padding-left:2.5rem}.panel.state{display:flex;min-height:14rem;flex-direction:column;align-items:center;justify-content:center;gap:.65rem;color:var(--color-muted);text-align:center}.panel.state strong{color:var(--color-text);font-size:1.05rem}.table-card{overflow:hidden;border:1px solid var(--color-border);border-radius:.7rem;background:var(--color-obsidian-panel)}.table-scroll{overflow-x:auto}.table-card table{width:100%;min-width:1120px;border-collapse:separate;border-spacing:0;text-align:left;font-size:.8rem}.table-card th{background:var(--color-obsidian-elevated);color:var(--color-muted-dim);font-size:.66rem;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap}.table-card th,.table-card td{padding:.72rem .7rem}.table-card td{border-top:1px solid var(--color-border-soft);white-space:nowrap}.table-card tfoot td{border-top:1px solid var(--color-border);font-weight:700}.clickable{cursor:pointer}.clickable:hover{background:rgba(168,85,247,.06)}.num{text-align:right;font-variant-numeric:tabular-nums}.strong{font-weight:700}.description{max-width:20rem;overflow:hidden;text-overflow:ellipsis}.status{display:inline-block;border-radius:.3rem;padding:.2rem .45rem;font-size:.68rem;font-weight:600}.status-draft{background:rgba(148,163,184,.14);color:#cbd5e1}.status-sent{background:rgba(96,165,250,.14);color:#93c5fd}.status-accepted{background:rgba(52,211,153,.14);color:#6ee7b7}.status-rejected,.status-cancelled{background:rgba(244,63,94,.14);color:#fda4af}.status-expired{background:rgba(251,191,36,.14);color:#fcd34d}.status-invoiced{background:rgba(167,139,250,.18);color:#c4b5fd}.actions-cell{position:relative;text-align:right}.budget-more{border:0;background:transparent;color:var(--color-muted);font-size:1.2rem;cursor:pointer}.budget-actions{position:absolute;right:.4rem;top:calc(100% - .1rem);z-index:30;min-width:12rem;padding:.3rem;border:1px solid var(--color-border);border-radius:.55rem;background:var(--color-obsidian-elevated);box-shadow:0 16px 34px rgba(0,0,0,.4)}.budget-actions button{display:block;width:100%;padding:.55rem .6rem;border:0;border-radius:.3rem;background:transparent;color:var(--color-text);text-align:left;cursor:pointer}.budget-actions button:hover{background:var(--color-purple-soft)}.budget-actions button:disabled{opacity:.4;cursor:not-allowed}.budget-actions .danger{color:#fda4af}.notice{position:fixed;right:1.5rem;top:1.5rem;z-index:10000;max-width:min(30rem,calc(100vw - 3rem));padding:.75rem 1rem;border-radius:.55rem;border:1px solid}.notice.success{border-color:rgba(52,211,153,.3);background:rgba(6,78,59,.92);color:#d1fae5}.notice.error{border-color:rgba(244,63,94,.35);background:rgba(76,5,25,.94);color:#ffe4e6}.editor{margin-top:1.5rem}.back{border:0;background:transparent;color:var(--color-purple);cursor:pointer;font-size:.85rem}.editor-actions{display:flex;flex-wrap:wrap;gap:.5rem}.surface{overflow:hidden;border:1px solid var(--color-border);border-radius:.7rem;background:var(--color-obsidian-panel)}.explanation{padding:1.2rem;border-bottom:1px solid var(--color-border);background:linear-gradient(135deg,rgba(124,58,237,.14),transparent 60%)}.explanation h3{font-weight:700}.explanation p{margin:.25rem 0 .7rem;color:var(--color-muted);font-size:.78rem}.explanation textarea{width:100%;resize:vertical}.meta-grid{display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr;gap:.75rem;padding:1rem;border-bottom:1px solid var(--color-border)}.meta-grid label,.bottom-grid label{display:grid;gap:.3rem;color:var(--color-muted-dim);font-size:.7rem}.line-head,.line-row{display:grid;grid-template-columns:minmax(11rem,1.4fr) minmax(12rem,2fr) 6rem 7rem 6rem 8rem 2rem;align-items:center;gap:.55rem;padding:.6rem .75rem}.line-head{background:var(--color-obsidian-elevated);color:var(--color-muted-dim);font-size:.66rem;text-transform:uppercase}.line-row{border-top:1px solid var(--color-border-soft)}.line-row .field{min-width:0}.remove{border:0;background:transparent;color:#fda4af;font-size:1.1rem;cursor:pointer}.surface :global(button.Button){margin:1rem}.totals{display:flex;align-items:center;justify-content:flex-end;gap:1.4rem;border-top:1px solid var(--color-border);padding:1rem;font-size:.8rem}.totals span{display:flex;gap:.45rem}.totals label{display:flex;align-items:center;gap:.4rem;color:var(--color-muted)}.small{width:5rem!important}.bottom-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:.75rem;border-top:1px solid var(--color-border);padding:1rem}.detail-layout{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(18rem,.7fr);gap:1rem}.document{border-radius:.35rem;background:#fff;color:#1f2937;padding:2rem;box-shadow:0 10px 30px rgba(0,0,0,.2)}.document header{display:flex;justify-content:space-between;border-bottom:2px solid #8cc9ec;padding-bottom:1rem;color:#2b9dcc}.document header strong{font-size:1.4rem;color:#111827}.document header p{margin-top:.15rem}.document .right{text-align:right}.client{margin:1.4rem 0;padding:1rem;background:#f1f3f5;font-size:.8rem}.document h3{border-bottom:1px solid #111827;padding:.5rem;font-size:.75rem}.document-explanation{margin:1rem 0;padding:1rem;background:#f7f7f7}.document-explanation p{white-space:pre-wrap;font-size:.82rem;line-height:1.5}.document-line{position:relative;padding:1rem;background:#f4f4f4;font-size:.8rem}.document-line:nth-of-type(odd){background:#fff}.document-line span{display:block;margin-top:.3rem;color:#4b5563}.document-line b{position:absolute;right:1rem;top:1rem}.document-total{display:grid;justify-content:end;gap:.5rem;margin-top:2rem;font-size:.8rem}.document-total span{display:flex;justify-content:space-between;gap:2rem}.detail-panel{border:1px solid var(--color-border);border-radius:.55rem;background:var(--color-obsidian-panel);padding:1rem}.detail-tabs{display:flex;gap:.4rem;border-bottom:1px solid var(--color-border);padding-bottom:.65rem}.detail-tabs span{padding:.45rem .6rem;color:var(--color-muted)}.detail-tabs .active{border-radius:.3rem;background:var(--color-purple-soft);color:var(--color-purple-bright)}.detail-panel section{display:grid;gap:.4rem;border-bottom:1px solid var(--color-border-soft);padding:1rem 0}.detail-panel small{color:var(--color-muted-dim);font-size:.68rem;text-transform:uppercase}.detail-panel .large{font-size:1.35rem}.link{justify-self:end;border:0;background:transparent;color:var(--color-purple);cursor:pointer}.detail-buttons{display:flex;flex-wrap:wrap;gap:.4rem}.preview{max-width:52rem;margin:auto}@media(max-width:900px){.meta-grid{grid-template-columns:repeat(2,1fr)}.bottom-grid{grid-template-columns:repeat(2,1fr)}.detail-layout{grid-template-columns:1fr}}@media(max-width:650px){.page-heading,.editor-head{align-items:flex-start;flex-direction:column}.toolbar{flex-wrap:wrap}.search-wrap{order:2;width:100%;margin-left:0}.meta-grid,.bottom-grid{grid-template-columns:1fr}.editor-actions{width:100%}.totals{align-items:flex-end;flex-direction:column;gap:.5rem}}
  @media print{:global(body > *:not(.modal-editorial)){display:none!important}.detail-panel{display:none}.document{box-shadow:none}.modal-editorial{border:0!important;max-height:none!important}.modal-body{overflow:visible!important}}
</style>
