<script lang="ts">
  import { onMount } from "svelte";
  import QRCode from "qrcode";
  import { api } from "$lib/api/client";
  import type { Customer, Invoice, Product, Sale, VerifactuRecord } from "$lib/types";
  import { formatEUR } from "$lib/money";
  import Card from "$lib/components/Card.svelte";
  import Button from "$lib/components/Button.svelte";
  import Badge from "$lib/components/Badge.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import { showToast } from "$lib/stores/ui";

  type ManualLine = { product_id: string; description: string; quantity: string | number; unit_price: string | number; vat_rate: string | number };

  function numberValue(value: string | number | null | undefined): number {
    return Number(String(value ?? "").replace(",", "."));
  }

  let invoices = $state<Invoice[]>([]);
  let sales = $state<Sale[]>([]);
  let verifactuRecords = $state<VerifactuRecord[]>([]);
  let loading = $state(true);
  let issuing = $state<number | null>(null);
  let invoiceSeries = $state("F");
  let operationDate = $state(new Date().toISOString().slice(0, 10));
  let dueDate = $state("");
  let irpfRate = $state("");
  let selectedInvoice = $state<Invoice | null>(null);
  let paymentAmount = $state("");
  let paymentMethod = $state<"cash" | "bank_transfer" | "card" | "other">("bank_transfer");
  let paying = $state(false);
  let invoiceSearch = $state("");
  let invoiceStatusFilter = $state<"all" | "issued" | "cancelled">("all");
  let paymentFilter = $state<"all" | "pending" | "partial" | "paid">("all");
  let customerFilter = $state("");
  let seriesFilter = $state("");
  let datePreset = $state<"all" | "month" | "quarter" | "previous_quarter" | "year" | "previous_year" | "custom">("all");
  let fromFilter = $state("");
  let toFilter = $state("");
  let customers = $state<Customer[]>([]);
  let products = $state<Product[]>([]);
  let manualOpen = $state(false);
  let manualSaving = $state(false);
  let creatingCustomer = $state(false);
  let previewOpen = $state(false);
  let previewInvoice = $state<Invoice | null>(null);
  let manualForm = $state({ kind: "complete" as "complete" | "simplified", customer_id: "", customer_name: "", customer_nif: "", customer_email: "", operation_date: new Date().toISOString().slice(0, 10), due_at: "", irpf_rate: "", notes: "" });
  let manualLines = $state<ManualLine[]>([{ product_id: "", description: "", quantity: "1", unit_price: "", vat_rate: "21" }]);

  const availableSales = $derived(sales.filter((sale) => sale.status !== "cancelled" && !invoices.some((invoice) => invoice.sale_id === sale.id && invoice.status !== "cancelled")));
  const pendingCents = $derived(invoices.filter((invoice) => invoice.status === "issued").reduce((sum, invoice) => sum + Math.max(0, invoice.total_cents - invoice.paid_cents), 0));
  const overdueCents = $derived(invoices.filter((invoice) => isOverdue(invoice)).reduce((sum, invoice) => sum + Math.max(0, invoice.total_cents - invoice.paid_cents), 0));
  const invoiceSeriesOptions = $derived([...new Set(invoices.map((invoice) => invoice.series))].sort());
  const filteredInvoices = $derived(invoices.filter((invoice) => {
    const query = invoiceSearch.trim().toLocaleLowerCase();
    const haystack = `${invoice.series}-${invoice.number} ${invoice.customer_name} ${invoice.customer_nif}`.toLocaleLowerCase();
    return (!query || haystack.includes(query))
      && (invoiceStatusFilter === "all" || invoice.status === invoiceStatusFilter)
      && (paymentFilter === "all" || invoice.payment_status === paymentFilter)
      && (!customerFilter || String(invoice.customer_id ?? "") === customerFilter)
      && (!seriesFilter || invoice.series === seriesFilter)
      && (!fromFilter || invoice.issued_at.slice(0, 10) >= fromFilter)
      && (!toFilter || invoice.issued_at.slice(0, 10) <= toFilter);
  }));

  function clearInvoiceFilters() {
    invoiceSearch = ""; invoiceStatusFilter = "all"; paymentFilter = "all"; customerFilter = ""; seriesFilter = ""; datePreset = "all"; fromFilter = ""; toFilter = "";
  }

  function setDatePreset(value: typeof datePreset) {
    datePreset = value;
    if (value === "all") { fromFilter = ""; toFilter = ""; return; }
    if (value === "custom") return;
    const today = new Date();
    let from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let to = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (value === "month") { from = new Date(today.getFullYear(), today.getMonth(), 1); to = new Date(today.getFullYear(), today.getMonth() + 1, 0); }
    if (value === "quarter") { const quarterMonth = Math.floor(today.getMonth() / 3) * 3; from = new Date(today.getFullYear(), quarterMonth, 1); to = new Date(today.getFullYear(), quarterMonth + 3, 0); }
    if (value === "previous_quarter") { const quarterMonth = Math.floor(today.getMonth() / 3) * 3 - 3; from = new Date(today.getFullYear(), quarterMonth, 1); to = new Date(today.getFullYear(), quarterMonth + 3, 0); }
    if (value === "year") { from = new Date(today.getFullYear(), 0, 1); to = new Date(today.getFullYear(), 11, 31); }
    if (value === "previous_year") { from = new Date(today.getFullYear() - 1, 0, 1); to = new Date(today.getFullYear() - 1, 11, 31); }
    const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    fromFilter = iso(from); toFilter = iso(to);
  }

  function isOverdue(invoice: Invoice) {
    return invoice.status === "issued" && invoice.payment_status !== "paid" && !!invoice.due_at && invoice.due_at.slice(0, 10) < new Date().toISOString().slice(0, 10);
  }

  async function load() {
    loading = true;
    try {
      const [loadedInvoices, loadedSales, loadedRecords, loadedCustomers, loadedProducts, profiles] = await Promise.all([api.listInvoices(), api.listSales(), api.listVerifactuRecords(), api.listCustomers(), api.listProducts(true), api.listFiscalProfiles()]);
      invoices = loadedInvoices; sales = loadedSales; verifactuRecords = loadedRecords; customers = loadedCustomers; products = loadedProducts; invoiceSeries = profiles[0]?.invoice_series || "F";
    }
    catch (error) { showToast(error instanceof Error ? error.message : "No se pudieron cargar las facturas", "err"); }
    finally { loading = false; }
  }
  onMount(load);

  function openManualInvoice() {
    manualForm = { kind: "complete", customer_id: "", customer_name: "", customer_nif: "", customer_email: "", operation_date: new Date().toISOString().slice(0, 10), due_at: "", irpf_rate: irpfRate, notes: "" };
    manualLines = [{ product_id: "", description: "", quantity: "1", unit_price: "", vat_rate: "21" }];
    manualOpen = true;
  }

  function selectManualCustomer(id: string) {
    const customer = customers.find((item) => String(item.id) === id);
    manualForm.customer_id = id;
    if (customer) { manualForm.customer_name = customer.name; manualForm.customer_nif = customer.nif; manualForm.customer_email = customer.email; }
  }

  async function createManualCustomer() {
    if (!manualForm.customer_name.trim()) { showToast("Escribe el nombre del cliente", "err"); return; }
    creatingCustomer = true;
    try {
      const customer = await api.upsertCustomer({ id: manualForm.customer_id ? Number(manualForm.customer_id) : null, name: manualForm.customer_name.trim(), nif: manualForm.customer_nif.trim(), email: manualForm.customer_email.trim() });
      manualForm.customer_id = String(customer.id);
      customers = [...customers.filter((item) => item.id !== customer.id), customer].sort((a, b) => a.name.localeCompare(b.name));
      showToast("Cliente guardado");
    } catch (error) { showToast(error instanceof Error ? error.message : "No se pudo guardar el cliente", "err"); }
    finally { creatingCustomer = false; }
  }

  function selectManualProduct(index: number, productId: string) {
    const product = products.find((item) => String(item.id) === productId);
    manualLines = manualLines.map((line, lineIndex) => lineIndex === index && product ? { ...line, product_id: productId, description: product.name, unit_price: String(product.price_cents / 100), vat_rate: String(product.vat_rate) } : lineIndex === index ? { ...line, product_id: productId } : line);
  }

  function addManualLine() { manualLines = [...manualLines, { product_id: "", description: "", quantity: "1", unit_price: "", vat_rate: "21" }]; }
  function removeManualLine(index: number) { if (manualLines.length > 1) manualLines = manualLines.filter((_, lineIndex) => lineIndex !== index); }

  const manualTotals = $derived(manualLines.reduce((total, line) => {
    const base = Math.round(numberValue(line.quantity) * numberValue(line.unit_price) * 100) || 0;
    const vat = Math.round(base * numberValue(line.vat_rate) / 100) || 0;
    return { base: total.base + base, vat: total.vat + vat, total: total.total + base + vat };
  }, { base: 0, vat: 0, total: 0 }));

  async function saveManualInvoice() {
    manualSaving = true;
    try {
      const lines = manualLines.map((line) => ({ description: line.description.trim(), quantity: numberValue(line.quantity), unit_price_cents: Math.round(numberValue(line.unit_price) * 100), vat_rate: numberValue(line.vat_rate) as 0 | 4 | 10 | 21 }));
      if (lines.some((line) => !line.description || !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.unit_price_cents) || line.unit_price_cents < 0)) throw new Error("Revisa las líneas de la factura");
      let customerId = manualForm.customer_id ? Number(manualForm.customer_id) : null;
      if (manualForm.customer_name.trim()) {
        const customer = await api.upsertCustomer({ id: customerId, name: manualForm.customer_name.trim(), nif: manualForm.customer_nif.trim(), email: manualForm.customer_email.trim() });
        customerId = customer.id;
      }
      const invoice = await api.issueInvoice({ series: invoiceSeries, kind: manualForm.kind, customer_id: customerId, customer_name: manualForm.customer_name, customer_nif: manualForm.customer_nif, customer_email: manualForm.customer_email, lines, operation_date: manualForm.operation_date || null, due_at: manualForm.due_at || null, irpf_rate: manualForm.irpf_rate ? Number(manualForm.irpf_rate) : undefined, notes: manualForm.notes });
      showToast(`Factura ${invoice.series}-${invoice.number} emitida`);
      manualOpen = false;
      previewInvoice = invoice;
      previewOpen = true;
      await load();
    } catch (error) { showToast(error instanceof Error ? error.message : "No se pudo crear la factura", "err"); }
    finally { manualSaving = false; }
  }

  async function issue(sale: Sale) {
    issuing = sale.id;
    try {
      const invoice = await api.issueInvoice({ sale_id: sale.id, series: invoiceSeries, operation_date: operationDate, due_at: dueDate || null, irpf_rate: irpfRate ? Number(irpfRate) : undefined, kind: sale.customer_id ? "complete" : "simplified" });
      showToast(`Factura ${invoice.series}-${invoice.number} emitida`);
      await load();
    } catch (error) { showToast(error instanceof Error ? error.message : "No se pudo emitir la factura", "err"); }
    finally { issuing = null; }
  }

  async function addPayment() {
    if (!selectedInvoice) return;
    paying = true;
    try { await api.addInvoicePayment({ invoice_id: selectedInvoice.id, amount_cents: Math.round(Number(paymentAmount.replace(",", ".")) * 100), method: paymentMethod }); showToast("Cobro registrado"); paymentAmount = ""; selectedInvoice = null; await load(); }
    catch (error) { showToast(error instanceof Error ? error.message : "No se pudo registrar el cobro", "err"); }
    finally { paying = false; }
  }

  async function rectify(invoice: Invoice) {
    if (!confirm(`¿Crear un abono que rectifique ${invoice.series}-${invoice.number}?`)) return;
    try { await api.issueInvoice({ rectifies_invoice_id: invoice.id, series: invoice.series, operation_date: operationDate, kind: "rectifying" }); showToast("Abono emitido"); await load(); }
    catch (error) { showToast(error instanceof Error ? error.message : "No se pudo crear el abono", "err"); }
  }

  async function cancel(invoice: Invoice) {
    if (!confirm(`¿Anular la factura ${invoice.series}-${invoice.number}?`)) return;
    try { await api.cancelInvoice(invoice.id); await load(); showToast("Factura anulada"); }
    catch (error) { showToast(error instanceof Error ? error.message : "No se pudo anular", "err"); }
  }

  async function print(invoice: Invoice) {
    const rows = invoice.lines.map((line) => `<tr><td>${line.description}</td><td>${line.quantity}</td><td>${formatEUR(line.base_cents)}</td><td>${line.vat_rate}%</td><td>${formatEUR(line.total_cents)}</td></tr>`).join("");
    const verifactu = verifactuRecords.find((record) => record.invoice_id === invoice.id && record.record_type === "alta");
    const qrDataUrl = verifactu ? await QRCode.toDataURL(verifactu.qr_url, { errorCorrectionLevel: "M", width: 150, margin: 2 }) : "";
    const qrHtml = verifactu ? `<div class="qr"><div>QR tributario:</div><img src="${qrDataUrl}" alt="QR tributario" /><div class="qr-label">${verifactu.mode === "test" ? "Entorno de pruebas VERI*FACTU" : "Factura verificable en la sede electrónica de la AEAT"}</div></div>` : "";
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${invoice.series}-${invoice.number}</title><style>body{font:14px Arial;color:#17121f;max-width:820px;margin:40px auto}header{display:flex;justify-content:space-between;border-bottom:2px solid #7c3aed;padding-bottom:24px}.qr{float:right;text-align:center;font-size:11px;margin-left:20px}.qr img{display:block;width:150px;height:150px;margin:4px auto}.qr-label{max-width:180px;font-size:10px}table{width:100%;border-collapse:collapse;margin-top:32px}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd}tfoot td{font-weight:bold;text-align:right}.muted{color:#666}.meta{margin-top:12px;color:#555;font-size:12px}</style></head><body>${qrHtml}<header><div><h1>${invoice.seller_trade_name}</h1><div>${invoice.seller_legal_name}<br>NIF: ${invoice.seller_nif}</div></div><div><h2>${invoice.kind === "rectifying" ? "ABONO / RECTIFICATIVA" : "FACTURA"}</h2><strong>${invoice.series}-${invoice.number}</strong><br>Fecha emisión: ${new Date(invoice.issued_at).toLocaleDateString("es-ES")}<br>Fecha operación: ${invoice.operation_date}${invoice.due_at ? `<br>Vencimiento: ${invoice.due_at}` : ""}</div></header><section style="margin-top:28px"><strong>Cliente</strong><br>${invoice.customer_name}<br>${invoice.customer_nif || ""}</section><table><thead><tr><th>Concepto</th><th>Cant.</th><th>Base</th><th>IVA</th><th>Total</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="4">Base imponible</td><td>${formatEUR(invoice.base_cents)}</td></tr><tr><td colspan="4">IVA</td><td>${formatEUR(invoice.vat_cents)}</td></tr><tr><td colspan="4">Retención IRPF (${invoice.irpf_rate}%)</td><td>${formatEUR(invoice.irpf_cents)}</td></tr><tr><td colspan="4">TOTAL</td><td>${formatEUR(invoice.total_cents)}</td></tr><tr><td colspan="4">Cobrado</td><td>${formatEUR(invoice.paid_cents)}</td></tr><tr><td colspan="4">Pendiente</td><td>${formatEUR(invoice.total_cents - invoice.paid_cents)}</td></tr></tfoot></table><p class="muted">${invoice.notes}</p></body></html>`;
    const popup = window.open("", "_blank");
    if (!popup) { showToast("El navegador ha bloqueado la ventana de impresión", "err"); return; }
    popup.document.write(html); popup.document.close(); popup.focus(); popup.print();
  }
</script>

<section class="workspace-page">
  <div class="workspace-intro workspace-intro-compact"><p class="workspace-index">FACTURACIÓN / VENTAS</p><div class="workspace-intro-row"><h2>Facturas<br /><em>emitidas.</em></h2><p>Ventas convertidas en facturas, separadas de las facturas recibidas de proveedores.</p></div></div>
  <div class="mb-5 flex flex-wrap items-end gap-3"><div class="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-sm"><span class="block text-xs text-slate-400">Serie configurada</span><strong>{invoiceSeries}</strong><span class="ml-2 text-xs text-slate-500">(Ajustes fiscales)</span></div><label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Fecha operación</span><input type="date" class="field" bind:value={operationDate} /></label><label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Vencimiento</span><input type="date" class="field" bind:value={dueDate} /></label><label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">IRPF %</span><input type="number" min="0" max="100" step="0.01" class="field w-24" bind:value={irpfRate} /></label><Button variant="primary" onclick={openManualInvoice}>+ Nueva factura</Button><Button variant="secondary" onclick={load}>Actualizar</Button></div>
  <div class="mb-5 grid gap-3 sm:grid-cols-3"><Card lift={false} class="p-4"><p class="text-xs text-slate-400">Facturas emitidas</p><p class="mt-1 text-2xl font-semibold">{invoices.length}</p></Card><Card lift={false} class="p-4"><p class="text-xs text-slate-400">Pendiente de cobro</p><p class="mt-1 text-2xl font-semibold text-amber-200">{formatEUR(pendingCents)}</p></Card><Card lift={false} class="p-4"><p class="text-xs text-slate-400">Vencido</p><p class="mt-1 text-2xl font-semibold text-rose-300">{formatEUR(overdueCents)}</p></Card></div>

  <Card lift={false} class="mb-5 p-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 class="font-semibold">Listado de facturas</h3><p class="text-xs text-slate-400">Busca y filtra por los mismos criterios operativos: cliente, fecha, serie y estado.</p></div><Button variant="ghost" class="text-xs" onclick={clearInvoiceFilters}>Limpiar filtros</Button></div>
    <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      <input class="field sm:col-span-2 xl:col-span-2" placeholder="Buscar número, cliente o NIF…" bind:value={invoiceSearch} />
      <select class="field" bind:value={invoiceStatusFilter}><option value="all">Estado: todos</option><option value="issued">Emitidas</option><option value="cancelled">Anuladas</option></select>
      <select class="field" bind:value={paymentFilter}><option value="all">Cobro: todos</option><option value="pending">Pendientes</option><option value="partial">Parciales</option><option value="paid">Pagadas</option></select>
      <select class="field" bind:value={customerFilter}><option value="">Cliente: todos</option>{#each customers as customer}<option value={customer.id}>{customer.name}</option>{/each}</select>
      <select class="field" bind:value={seriesFilter}><option value="">Serie: todas</option>{#each invoiceSeriesOptions as invoiceSeriesOption}<option value={invoiceSeriesOption}>{invoiceSeriesOption}</option>{/each}</select>
      <select class="field" value={datePreset} onchange={(event) => setDatePreset(event.currentTarget.value as typeof datePreset)}><option value="all">Fecha: todas</option><option value="month">Este mes</option><option value="quarter">Trimestre actual</option><option value="previous_quarter">Trimestre anterior</option><option value="year">Este año</option><option value="previous_year">Año anterior</option><option value="custom">Personalizado</option></select>
      {#if datePreset === "custom"}<div class="flex gap-2 sm:col-span-2"><label class="min-w-0 flex-1 text-xs text-slate-400"><span class="mb-1 block">Desde</span><input type="date" class="field w-full" aria-label="Desde" bind:value={fromFilter} /></label><label class="min-w-0 flex-1 text-xs text-slate-400"><span class="mb-1 block">Hasta</span><input type="date" class="field w-full" aria-label="Hasta" bind:value={toFilter} /></label></div>{/if}
    </div>
  </Card>

  {#if availableSales.length > 0}<Card lift={false} class="mb-5 p-4"><h3 class="mb-3 font-semibold">Ventas pendientes de facturar</h3><div class="space-y-2">{#each availableSales as sale}<div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-3"><div><strong>{sale.number}</strong><span class="ml-2 text-sm text-slate-400">{sale.customer_name || "Cliente contado"} · {formatEUR(sale.total_cents)}</span></div><Button class="text-xs" disabled={issuing === sale.id} onclick={() => issue(sale)}>{issuing === sale.id ? "Emitiendo…" : sale.customer_id ? "Emitir factura" : "Emitir simplificada"}</Button></div>{/each}</div></Card>{/if}

  {#if loading}<div class="skeleton h-48"></div>{:else if filteredInvoices.length === 0}<Card lift={false} class="p-10 text-center"><p class="text-sm text-[var(--color-muted)]">{invoices.length === 0 ? "Todavía no hay facturas emitidas." : "No hay facturas que coincidan con los filtros."}</p></Card>{:else}<Card lift={false} class="overflow-hidden p-0"><div class="overflow-x-auto"><table class="w-full min-w-[850px] text-left text-sm"><thead class="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500"><tr><th class="px-4 py-3">Factura</th><th class="px-4 py-3">Fecha</th><th class="px-4 py-3">Cliente</th><th class="px-4 py-3 text-right">Base</th><th class="px-4 py-3 text-right">IVA</th><th class="px-4 py-3 text-right">Total</th><th class="px-4 py-3">Estado</th><th class="px-4 py-3 text-right">Acciones</th></tr></thead><tbody>{#each filteredInvoices as invoice}<tr class="border-b border-white/5 align-middle hover:bg-white/[0.025]"><td class="px-4 py-3"><p class="font-semibold">{invoice.series}-{invoice.number}</p><p class="text-xs text-slate-500">{invoice.kind === "simplified" ? "Simplificada" : "Completa"}</p></td><td class="px-4 py-3 text-slate-400">{invoice.issued_at.slice(0, 10)}</td><td class="px-4 py-3"><p>{invoice.customer_name}</p>{#if invoice.customer_nif}<p class="text-xs text-slate-500">{invoice.customer_nif}</p>{/if}</td><td class="px-4 py-3 text-right tabular">{formatEUR(invoice.base_cents)}</td><td class="px-4 py-3 text-right tabular">{formatEUR(invoice.vat_cents)}</td><td class="px-4 py-3 text-right font-semibold tabular">{formatEUR(invoice.total_cents)}</td><td class="px-4 py-3"><div class="flex flex-wrap gap-1"><Badge tone={invoice.status === "issued" ? "ok" : "danger"}>{invoice.status === "issued" ? "Emitida" : "Anulada"}</Badge>{#if isOverdue(invoice)}<Badge tone="danger">Vencida</Badge>{/if}<span class="text-xs text-slate-500">{invoice.payment_status === "paid" ? "Pagada" : invoice.payment_status === "partial" ? "Parcial" : "Pendiente"}</span></div></td><td class="px-4 py-3"><div class="flex justify-end gap-1"><Button variant="ghost" class="text-xs" onclick={() => print(invoice)}>PDF</Button>{#if invoice.status === "issued"}<Button variant="ghost" class="text-xs" onclick={() => { selectedInvoice = invoice; paymentAmount = String((invoice.total_cents - invoice.paid_cents) / 100); }}>Cobro</Button><Button variant="ghost" class="text-xs" onclick={() => rectify(invoice)}>Abono</Button><Button variant="ghost" class="text-xs" onclick={() => cancel(invoice)}>⋮</Button>{/if}</div></td></tr>{/each}</tbody></table></div></Card>{/if}

  {#if selectedInvoice}<Card lift={false} class="mt-5 border border-emerald-400/30 p-4"><div class="flex flex-wrap items-end gap-3"><div><p class="font-semibold">Registrar cobro · {selectedInvoice.series}-{selectedInvoice.number}</p><p class="text-xs text-slate-400">Pendiente: {formatEUR(selectedInvoice.total_cents - selectedInvoice.paid_cents)}</p></div><label class="text-sm"><span class="mb-1 block text-slate-400">Importe (€)</span><input class="field w-32" type="number" min="0.01" step="0.01" bind:value={paymentAmount} /></label><label class="text-sm"><span class="mb-1 block text-slate-400">Método</span><select class="field" bind:value={paymentMethod}><option value="bank_transfer">Transferencia</option><option value="card">Tarjeta</option><option value="cash">Efectivo</option><option value="other">Otro</option></select></label><Button disabled={paying} onclick={addPayment}>{paying ? "Guardando…" : "Guardar cobro"}</Button><Button variant="ghost" onclick={() => (selectedInvoice = null)}>Cancelar</Button></div></Card>{/if}
</section>

<Modal open={manualOpen} title="Nueva factura emitida" size="full" onclose={() => (manualOpen = false)}>
  <div class="space-y-5">
    <div class="grid gap-3 sm:grid-cols-3">
      <label class="text-sm"><span class="mb-1 block text-slate-400">Tipo</span><select class="field w-full" bind:value={manualForm.kind}><option value="complete">Completa</option><option value="simplified">Simplificada</option></select></label>
      <label class="text-sm"><span class="mb-1 block text-slate-400">Fecha operación</span><input type="date" class="field w-full" bind:value={manualForm.operation_date} /></label>
      <label class="text-sm"><span class="mb-1 block text-slate-400">Vencimiento</span><input type="date" class="field w-full" bind:value={manualForm.due_at} /></label>
    </div>
    <div class="grid gap-3 sm:grid-cols-3">
      <label class="text-sm"><span class="mb-1 block text-slate-400">Cliente guardado</span><select class="field w-full" value={manualForm.customer_id} onchange={(event) => selectManualCustomer(event.currentTarget.value)}><option value="">Cliente nuevo / contado</option>{#each customers as customer}<option value={customer.id}>{customer.name}{customer.nif ? ` · ${customer.nif}` : ""}</option>{/each}</select></label>
      <label class="text-sm"><span class="mb-1 block text-slate-400">Nombre / razón social</span><input class="field w-full" bind:value={manualForm.customer_name} /></label>
      <label class="text-sm"><span class="mb-1 block text-slate-400">NIF {manualForm.kind === "complete" ? "(obligatorio)" : "(opcional)"}</span><input class="field w-full" bind:value={manualForm.customer_nif} /></label>
      <label class="text-sm"><span class="mb-1 block text-slate-400">Email</span><input type="email" class="field w-full" bind:value={manualForm.customer_email} /></label>
      <div class="flex items-end"><Button variant="secondary" class="w-full text-xs" disabled={creatingCustomer || !manualForm.customer_name.trim()} onclick={createManualCustomer}>{creatingCustomer ? "Guardando…" : manualForm.customer_id ? "Actualizar cliente" : "+ Añadir cliente"}</Button></div>
    </div>
    <div class="rounded-2xl border border-white/10 bg-white/[0.02] p-4"><div class="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 class="font-semibold">Conceptos de la factura</h3><p class="text-xs text-slate-400">Añade productos del catálogo o escribe un servicio personalizado. El total se calcula automáticamente.</p></div><Button variant="secondary" class="text-xs" onclick={addManualLine}>+ Añadir línea</Button></div><div class="hidden gap-2 px-1 pb-2 text-[11px] uppercase tracking-wide text-slate-500 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)_5rem_7rem_6rem_6rem_auto]"><span>Producto / servicio</span><span>Descripción</span><span>Cant.</span><span>Precio (€)</span><span>IVA</span><span>Importe</span><span></span></div><div class="space-y-3">{#each manualLines as line, index}<div class="rounded-xl border border-white/10 bg-black/10 p-3"><div class="grid items-end gap-2 lg:grid-cols-[13rem_minmax(0,1fr)_5rem_7rem_6rem_6rem_auto]"><label class="text-sm"><span class="mb-1 block text-slate-400 lg:hidden">Producto / servicio</span><select class="field w-full" value={line.product_id} onchange={(event) => selectManualProduct(index, event.currentTarget.value)}><option value="">Personalizado</option>{#each products as product}<option value={product.id}>{product.name}</option>{/each}</select></label><label class="text-sm"><span class="mb-1 block text-slate-400 lg:hidden">Descripción</span><input class="field w-full" placeholder="Descripción del concepto" bind:value={line.description} /></label><label class="text-sm"><span class="mb-1 block text-slate-400 lg:hidden">Cantidad</span><input type="number" min="0.01" step="0.01" class="field w-full" bind:value={line.quantity} /></label><label class="text-sm"><span class="mb-1 block text-slate-400 lg:hidden">Precio (€)</span><input type="number" min="0" step="0.01" class="field w-full" bind:value={line.unit_price} /></label><label class="text-sm"><span class="mb-1 block text-slate-400 lg:hidden">IVA</span><select class="field w-full" bind:value={line.vat_rate}><option value="21">21%</option><option value="10">10%</option><option value="4">4%</option><option value="0">0%</option></select></label><div class="text-right text-sm font-semibold tabular"><span class="mb-1 block text-slate-400 lg:hidden">Importe</span>{formatEUR((Math.round(numberValue(line.quantity) * numberValue(line.unit_price) * 100) || 0) + Math.round((Math.round(numberValue(line.quantity) * numberValue(line.unit_price) * 100) || 0) * numberValue(line.vat_rate) / 100))}</div><Button variant="ghost" class="text-xs" disabled={manualLines.length === 1} onclick={() => removeManualLine(index)}>Quitar</Button></div></div>{/each}</div><div class="mt-4 flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-white/10 pt-3 text-sm"><span>Base: <strong>{formatEUR(manualTotals.base)}</strong></span><span>IVA: <strong>{formatEUR(manualTotals.vat)}</strong></span><span class="text-base">Total: <strong>{formatEUR(manualTotals.total)}</strong></span></div></div>
    <div class="grid gap-3 sm:grid-cols-3"><label class="text-sm"><span class="mb-1 block text-slate-400">IRPF %</span><input type="number" min="0" max="100" step="0.01" class="field w-full" bind:value={manualForm.irpf_rate} /></label><label class="text-sm sm:col-span-2"><span class="mb-1 block text-slate-400">Notas</span><input class="field w-full" placeholder="Condiciones de pago, referencia…" bind:value={manualForm.notes} /></label></div>
    <div class="flex justify-end gap-2"><Button variant="ghost" onclick={() => (manualOpen = false)}>Cancelar</Button><Button variant="primary" disabled={manualSaving} onclick={saveManualInvoice}>{manualSaving ? "Guardando…" : "Emitir factura"}</Button></div>
  </div>
</Modal>

<Modal open={previewOpen} title={previewInvoice ? `Vista previa · ${previewInvoice.series}-${previewInvoice.number}` : "Vista previa de factura"} size="xl" onclose={() => (previewOpen = false)}>
  {#if previewInvoice}
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3"><div><p class="font-semibold text-emerald-200">Factura emitida correctamente</p><p class="text-xs text-slate-400">Revísala antes de imprimirla o guardarla como PDF.</p></div><Button variant="primary" onclick={() => print(previewInvoice)}>Imprimir / guardar PDF</Button></div>
    <div class="mx-auto max-w-3xl rounded-lg bg-white p-7 text-slate-900 shadow-2xl sm:p-10">
      <div class="flex flex-wrap justify-between gap-8 border-b border-slate-200 pb-7"><div><p class="text-2xl font-bold tracking-tight">{previewInvoice.seller_trade_name}</p><p class="mt-2 text-sm text-slate-500">{previewInvoice.seller_legal_name}<br />NIF: {previewInvoice.seller_nif}</p></div><div class="text-right"><p class="text-sm font-semibold uppercase tracking-[0.18em] text-violet-600">{previewInvoice.kind === "simplified" ? "Factura simplificada" : "Factura"}</p><p class="mt-2 text-xl font-bold">{previewInvoice.series}-{previewInvoice.number}</p><p class="mt-1 text-sm text-slate-500">Emisión: {new Date(previewInvoice.issued_at).toLocaleDateString("es-ES")}<br />Operación: {previewInvoice.operation_date}{#if previewInvoice.due_at}<br />Vencimiento: {previewInvoice.due_at}{/if}</p></div></div>
      <div class="grid gap-4 border-b border-slate-200 py-6 sm:grid-cols-2"><div><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Cliente</p><p class="mt-1 font-semibold">{previewInvoice.customer_name}</p>{#if previewInvoice.customer_nif}<p class="text-sm text-slate-500">NIF: {previewInvoice.customer_nif}</p>{/if}{#if previewInvoice.customer_email}<p class="text-sm text-slate-500">{previewInvoice.customer_email}</p>{/if}</div><div class="sm:text-right"><p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Estado</p><p class="mt-1 font-semibold text-emerald-600">Emitida · Pendiente de cobro</p></div></div>
      <table class="w-full text-sm"><thead><tr class="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400"><th class="py-3">Concepto</th><th class="py-3 text-right">Cant.</th><th class="py-3 text-right">Precio</th><th class="py-3 text-right">IVA</th><th class="py-3 text-right">Importe</th></tr></thead><tbody>{#each previewInvoice.lines as line}<tr class="border-b border-slate-100"><td class="py-3 font-medium">{line.description}</td><td class="py-3 text-right">{line.quantity}</td><td class="py-3 text-right">{formatEUR(line.unit_price_cents)}</td><td class="py-3 text-right">{line.vat_rate}%</td><td class="py-3 text-right font-medium">{formatEUR(line.total_cents)}</td></tr>{/each}</tbody></table>
      <div class="ml-auto mt-7 max-w-xs space-y-2 text-sm"><div class="flex justify-between"><span class="text-slate-500">Base imponible</span><strong>{formatEUR(previewInvoice.base_cents)}</strong></div><div class="flex justify-between"><span class="text-slate-500">IVA</span><strong>{formatEUR(previewInvoice.vat_cents)}</strong></div>{#if previewInvoice.irpf_cents}<div class="flex justify-between"><span class="text-slate-500">IRPF ({previewInvoice.irpf_rate}%)</span><strong>-{formatEUR(previewInvoice.irpf_cents)}</strong></div>{/if}<div class="flex justify-between border-t border-slate-300 pt-3 text-lg"><span class="font-semibold">Total</span><strong>{formatEUR(previewInvoice.total_cents)}</strong></div></div>
      {#if previewInvoice.notes}<p class="mt-8 border-t border-slate-200 pt-4 text-sm text-slate-500">{previewInvoice.notes}</p>{/if}
    </div>
    <div class="mt-4 flex justify-end"><Button variant="ghost" onclick={() => (previewOpen = false)}>Cerrar vista previa</Button></div>
  {/if}
</Modal>
