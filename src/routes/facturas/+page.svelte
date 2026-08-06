<script lang="ts">
  import { onMount } from "svelte";
  import QRCode from "qrcode";
  import { api } from "$lib/api/client";
  import type { Invoice, Sale, VerifactuRecord } from "$lib/types";
  import { formatEUR } from "$lib/money";
  import Card from "$lib/components/Card.svelte";
  import Button from "$lib/components/Button.svelte";
  import Badge from "$lib/components/Badge.svelte";
  import { showToast } from "$lib/stores/ui";

  let invoices = $state<Invoice[]>([]);
  let sales = $state<Sale[]>([]);
  let verifactuRecords = $state<VerifactuRecord[]>([]);
  let loading = $state(true);
  let issuing = $state<number | null>(null);
  let series = $state("F");
  let operationDate = $state(new Date().toISOString().slice(0, 10));
  let dueDate = $state("");
  let irpfRate = $state("");
  let selectedInvoice = $state<Invoice | null>(null);
  let paymentAmount = $state("");
  let paymentMethod = $state<"cash" | "bank_transfer" | "card" | "other">("bank_transfer");
  let paying = $state(false);

  const availableSales = $derived(sales.filter((sale) => sale.status !== "cancelled" && !invoices.some((invoice) => invoice.sale_id === sale.id && invoice.status !== "cancelled")));
  const pendingCents = $derived(invoices.filter((invoice) => invoice.status === "issued").reduce((sum, invoice) => sum + Math.max(0, invoice.total_cents - invoice.paid_cents), 0));
  const overdueCents = $derived(invoices.filter((invoice) => isOverdue(invoice)).reduce((sum, invoice) => sum + Math.max(0, invoice.total_cents - invoice.paid_cents), 0));

  function isOverdue(invoice: Invoice) {
    return invoice.status === "issued" && invoice.payment_status !== "paid" && !!invoice.due_at && invoice.due_at.slice(0, 10) < new Date().toISOString().slice(0, 10);
  }

  async function load() {
    loading = true;
    try { [invoices, sales, verifactuRecords] = await Promise.all([api.listInvoices(), api.listSales(), api.listVerifactuRecords()]); }
    catch (error) { showToast(error instanceof Error ? error.message : "No se pudieron cargar las facturas", "err"); }
    finally { loading = false; }
  }
  onMount(load);

  async function issue(sale: Sale) {
    issuing = sale.id;
    try {
      const invoice = await api.issueInvoice({ sale_id: sale.id, series, operation_date: operationDate, due_at: dueDate || null, irpf_rate: irpfRate ? Number(irpfRate) : undefined, kind: sale.customer_id ? "complete" : "simplified" });
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
  <div class="mb-5 flex flex-wrap items-end gap-3"><label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Serie nueva</span><input class="field w-24" maxlength="8" bind:value={series} /></label><label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Fecha operación</span><input type="date" class="field" bind:value={operationDate} /></label><label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Vencimiento</span><input type="date" class="field" bind:value={dueDate} /></label><label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">IRPF %</span><input type="number" min="0" max="100" step="0.01" class="field w-24" bind:value={irpfRate} /></label><Button variant="secondary" onclick={load}>Actualizar</Button></div>
  <div class="mb-5 grid gap-3 sm:grid-cols-3"><Card lift={false} class="p-4"><p class="text-xs text-slate-400">Facturas emitidas</p><p class="mt-1 text-2xl font-semibold">{invoices.length}</p></Card><Card lift={false} class="p-4"><p class="text-xs text-slate-400">Pendiente de cobro</p><p class="mt-1 text-2xl font-semibold text-amber-200">{formatEUR(pendingCents)}</p></Card><Card lift={false} class="p-4"><p class="text-xs text-slate-400">Vencido</p><p class="mt-1 text-2xl font-semibold text-rose-300">{formatEUR(overdueCents)}</p></Card></div>

  {#if availableSales.length > 0}<Card lift={false} class="mb-5 p-4"><h3 class="mb-3 font-semibold">Ventas pendientes de facturar</h3><div class="space-y-2">{#each availableSales as sale}<div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-3"><div><strong>{sale.number}</strong><span class="ml-2 text-sm text-slate-400">{sale.customer_name || "Cliente contado"} · {formatEUR(sale.total_cents)}</span></div><Button class="text-xs" disabled={issuing === sale.id} onclick={() => issue(sale)}>{issuing === sale.id ? "Emitiendo…" : sale.customer_id ? "Emitir factura" : "Emitir simplificada"}</Button></div>{/each}</div></Card>{/if}

  {#if loading}<div class="skeleton h-48"></div>{:else if invoices.length === 0}<Card lift={false} class="p-10 text-center"><p class="text-sm text-[var(--color-muted)]">Todavía no hay facturas emitidas.</p></Card>{:else}<div class="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">{#each invoices as invoice}<Card lift={false} class="p-4"><div class="flex items-start justify-between gap-3"><div><p class="font-semibold">{invoice.series}-{invoice.number}</p><p class="mt-1 text-xs text-slate-400">{invoice.customer_name}</p></div><div class="flex items-center gap-2"><Badge tone={invoice.status === "issued" ? "ok" : "danger"}>{invoice.status === "issued" ? "Emitida" : "Anulada"}</Badge>{#if isOverdue(invoice)}<Badge tone="danger">Vencida</Badge>{/if}</div></div><div class="mt-4 grid grid-cols-2 gap-2 text-xs"><div><span class="text-slate-400">Total</span><p class="text-xl font-semibold tabular">{formatEUR(invoice.total_cents)}</p></div><div><span class="text-slate-400">Cobrado</span><p class="font-semibold tabular text-emerald-200">{formatEUR(invoice.paid_cents)}</p><p class="text-slate-400">{invoice.payment_status === "paid" ? "Pagada" : invoice.payment_status === "partial" ? "Parcial" : "Pendiente"}</p></div></div><div class="mt-3 flex flex-wrap gap-2"><Button variant="ghost" class="text-xs" onclick={() => print(invoice)}>Imprimir</Button>{#if invoice.status === "issued"}<Button variant="secondary" class="text-xs" onclick={() => { selectedInvoice = invoice; paymentAmount = String((invoice.total_cents - invoice.paid_cents) / 100); }}>Registrar cobro</Button><Button variant="ghost" class="text-xs" onclick={() => rectify(invoice)}>Crear abono</Button><Button variant="ghost" class="text-xs" onclick={() => cancel(invoice)}>Anular</Button>{/if}</div></Card>{/each}</div>{/if}

  {#if selectedInvoice}<Card lift={false} class="mt-5 border border-emerald-400/30 p-4"><div class="flex flex-wrap items-end gap-3"><div><p class="font-semibold">Registrar cobro · {selectedInvoice.series}-{selectedInvoice.number}</p><p class="text-xs text-slate-400">Pendiente: {formatEUR(selectedInvoice.total_cents - selectedInvoice.paid_cents)}</p></div><label class="text-sm"><span class="mb-1 block text-slate-400">Importe (€)</span><input class="field w-32" type="number" min="0.01" step="0.01" bind:value={paymentAmount} /></label><label class="text-sm"><span class="mb-1 block text-slate-400">Método</span><select class="field" bind:value={paymentMethod}><option value="bank_transfer">Transferencia</option><option value="card">Tarjeta</option><option value="cash">Efectivo</option><option value="other">Otro</option></select></label><Button disabled={paying} onclick={addPayment}>{paying ? "Guardando…" : "Guardar cobro"}</Button><Button variant="ghost" onclick={() => (selectedInvoice = null)}>Cancelar</Button></div></Card>{/if}
</section>
