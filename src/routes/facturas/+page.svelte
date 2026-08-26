<script lang="ts">
  import { onMount } from "svelte";
  import QRCode from "qrcode";
  import { api } from "$lib/api/client";
  import type { Customer, Invoice, Product, Sale, VerifactuRecord, WorkProject } from "$lib/types";
  import { formatEUR } from "$lib/money";
  import Card from "$lib/components/Card.svelte";
  import Button from "$lib/components/Button.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import DatePicker from "$lib/components/DatePicker.svelte";
  import MoneyInput from "$lib/components/MoneyInput.svelte";
  import CommercialDocument from "$lib/components/CommercialDocument.svelte";
  import { activeCompany } from "$lib/stores/session";
  import { invoicePrintHtml } from "$lib/documents/commercial-print";
  import SortableHeader from "$lib/components/SortableHeader.svelte";
  import { sortedCopy, type SortDirection } from "$lib/list-sort";
  import { showToast } from "$lib/stores/ui";
  import { confirmDialog } from "$lib/stores/confirm-dialog";
  import { formatDateES } from "$lib/date";

  type ManualLine = { product_id: string; description: string; quantity: string | number; unit_price: string | number; vat_rate: string | number };

  function numberValue(value: string | number | null | undefined): number {
    const normalized = String(value ?? "").replace(",", ".").trim();
    return normalized === "" ? 0 : Number(normalized);
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
  let paymentError = $state("");
  let invoiceSearch = $state("");
  let showInvoiceFilters = $state(false);
  let filterMenuOpen = $state(false);
  let filterSubmenu = $state<"status" | "email" | "type" | "subtotal" | "numbering" | "payment" | null>(null);
  let dateMenuOpen = $state(false);
  let actionInvoiceId = $state<number | null>(null);
  let invoicePage = $state(1);
  let invoicePageSize = $state(50);
  let invoiceStatusFilter = $state<"all" | "draft" | "issued" | "cancelled" | "paid" | "pending" | "overdue" | "pending_overdue" | "partial" | "not_cancelled">("all");
  let paymentFilter = $state<"all" | "pending" | "partial" | "paid">("all");
  let overdueFilter = $state<"none" | "overdue" | "pending_overdue">("none");
  let customerFilter = $state("");
  let seriesFilter = $state("");
  let emailFilter = $state<"all" | "with" | "without">("all");
  let kindFilter = $state<"all" | "complete" | "simplified" | "rectifying">("all");
  let subtotalFilter = $state<"all" | "with" | "without">("all");
  let invoiceSortKey = $state<"number" | "date" | "operation_date" | "customer" | "base" | "vat" | "total" | "status" | "paid" | "pending">("date");
  let invoiceSortDirection = $state<SortDirection>("desc");
  let datePreset = $state<"all" | "last12" | "today" | "yesterday" | "last7" | "month" | "previous_month" | "quarter" | "previous_quarter" | "year" | "previous_year" | "custom">("year");
  let fromFilter = $state(`${new Date().getFullYear()}-01-01`);
  let toFilter = $state(`${new Date().getFullYear()}-12-31`);
  let calendarOpen = $state(false);
  let calendarCursor = $state(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  let customers = $state<Customer[]>([]);
  let products = $state<Product[]>([]);
  let clientProjects = $state<WorkProject[]>([]);
  let manualOpen = $state(false);
  let manualSaving = $state(false);
  let manualError = $state("");
  let creatingCustomer = $state(false);
  let previewOpen = $state(false);
  let previewInvoice = $state<Invoice | null>(null);
  let manualDraftId = $state<number | null>(null);
  let manualForm = $state({ kind: "complete" as "complete" | "simplified", project_id: "", customer_id: "", customer_name: "", customer_nif: "", customer_email: "", operation_date: new Date().toISOString().slice(0, 10), due_at: "", irpf_rate: "", notes: "" });
  let manualLines = $state<ManualLine[]>([{ product_id: "", description: "", quantity: "1", unit_price: "", vat_rate: "21" }]);

  const availableSales = $derived(sales.filter((sale) => sale.status !== "cancelled" && !invoices.some((invoice) => invoice.sale_id === sale.id && invoice.status !== "cancelled")));
  const pendingCents = $derived(invoices.filter((invoice) => invoice.status === "issued").reduce((sum, invoice) => sum + Math.max(0, invoice.total_cents - invoice.paid_cents), 0));
  const overdueCents = $derived(invoices.filter((invoice) => isOverdue(invoice)).reduce((sum, invoice) => sum + Math.max(0, invoice.total_cents - invoice.paid_cents), 0));
  const invoiceSeriesOptions = $derived([...new Set(invoices.map((invoice) => invoice.series))].sort());
  const filteredInvoices = $derived(invoices.filter((invoice) => {
    const query = invoiceSearch.trim().toLocaleLowerCase();
    const haystack = `${invoice.series}-${invoice.number} ${invoice.customer_name} ${invoice.customer_nif}`.toLocaleLowerCase();
    return (!query || haystack.includes(query))
      && matchesInvoiceStatus(invoice)
      && (paymentFilter === "all" || invoice.payment_status === paymentFilter)
      && (!customerFilter || String(invoice.customer_id ?? "") === customerFilter)
      && (!seriesFilter || invoice.series === seriesFilter)
      && (emailFilter === "all" || (emailFilter === "with" ? !!invoice.customer_email : !invoice.customer_email))
      && (kindFilter === "all" || invoice.kind === kindFilter)
      && (subtotalFilter === "all" || (subtotalFilter === "with" ? invoice.base_cents > 0 : invoice.base_cents === 0))
      && (overdueFilter === "none" || (overdueFilter === "overdue" ? isOverdue(invoice) : isOverdue(invoice) && invoice.payment_status !== "paid"))
      && (!fromFilter || invoice.issued_at.slice(0, 10) >= fromFilter)
      && (!toFilter || invoice.issued_at.slice(0, 10) <= toFilter);
  }));
  const displayedInvoices = $derived(sortedCopy(filteredInvoices, (invoice) => {
    if (invoiceSortKey === "number") return `${invoice.series}-${invoice.number}`;
    if (invoiceSortKey === "date") return invoice.issued_at;
    if (invoiceSortKey === "operation_date") return invoice.operation_date;
    if (invoiceSortKey === "customer") return invoice.customer_name;
    if (invoiceSortKey === "base") return invoice.base_cents;
    if (invoiceSortKey === "vat") return invoice.vat_cents;
    if (invoiceSortKey === "total") return invoice.total_cents;
    if (invoiceSortKey === "paid") return invoice.paid_cents;
    if (invoiceSortKey === "pending") return invoice.total_cents - invoice.paid_cents;
    return invoice.status;
  }, invoiceSortDirection));
  const invoicePageCount = $derived(Math.max(1, Math.ceil(displayedInvoices.length / invoicePageSize)));
  const paginatedInvoices = $derived(displayedInvoices.slice((invoicePage - 1) * invoicePageSize, invoicePage * invoicePageSize));
  const activeFilterCount = $derived([invoiceStatusFilter !== "all", paymentFilter !== "all", !!customerFilter, !!seriesFilter, emailFilter !== "all", kindFilter !== "all", subtotalFilter !== "all", datePreset !== "all"].filter(Boolean).length);
  const dateFilterLabel = $derived(datePreset === "all" ? "Todas las fechas" : fromFilter && toFilter ? `${displayDate(fromFilter)} - ${displayDate(toFilter)}` : "Selecciona un intervalo");

  $effect(() => {
    if (invoicePage > invoicePageCount) invoicePage = invoicePageCount;
  });

  $effect(() => {
    const visibleIds = paginatedInvoices.map((invoice) => invoice.id).join(",");
    const openAction = actionInvoiceId;
    queueMicrotask(() => {
      if (!visibleIds) return;
      document.querySelectorAll<HTMLTableRowElement>(".invoice-table tbody tr").forEach((row) => {
        for (const index of [0, 2, 3, 12]) {
          const cell = row.cells.item(index);
          const value = cell?.textContent?.trim() ?? "";
          if (cell && value !== "—" && /^\d{4}-\d{2}-\d{2}/.test(value)) cell.textContent = formatDateES(value);
        }
      });
      if (openAction) document.querySelectorAll<HTMLButtonElement>(".invoice-actions-menu button").forEach((button) => {
        if (button.textContent?.trim() === "Crear rectificativa") {
          button.textContent = "Anular factura";
          button.classList.add("danger");
        }
      });
    });
  });

  function sortInvoices(key: typeof invoiceSortKey) {
    if (invoiceSortKey === key) invoiceSortDirection = invoiceSortDirection === "asc" ? "desc" : "asc";
    else { invoiceSortKey = key; invoiceSortDirection = key === "date" ? "desc" : "asc"; }
  }

  function openInvoicePreview(event: MouseEvent, invoice: Invoice) {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, select, input")) return;
    previewInvoice = invoice;
    previewOpen = true;
  }

  function displayDate(value: string): string {
    const [year, month, day] = value.split("-");
    return year && month && day ? `${day}/${month}/${year}` : value;
  }

  function matchesInvoiceStatus(invoice: Invoice): boolean {
    if (invoiceStatusFilter === "all") return true;
    if (invoiceStatusFilter === "draft" || invoiceStatusFilter === "issued" || invoiceStatusFilter === "cancelled") return invoice.status === invoiceStatusFilter;
    if (invoiceStatusFilter === "paid" || invoiceStatusFilter === "pending" || invoiceStatusFilter === "partial") return invoice.payment_status === invoiceStatusFilter;
    if (invoiceStatusFilter === "overdue") return isOverdue(invoice);
    if (invoiceStatusFilter === "pending_overdue") return isOverdue(invoice) && invoice.payment_status !== "paid";
    if (invoiceStatusFilter === "not_cancelled") return invoice.status !== "cancelled";
    return false;
  }

  function clearInvoiceFilters() {
    invoiceSearch = ""; invoiceStatusFilter = "all"; paymentFilter = "all"; overdueFilter = "none"; customerFilter = ""; seriesFilter = ""; emailFilter = "all"; kindFilter = "all"; subtotalFilter = "all"; datePreset = "all"; fromFilter = ""; toFilter = ""; calendarOpen = false;
  }

  function changeInvoicePage(next: number) { invoicePage = Math.min(invoicePageCount, Math.max(1, next)); }

  function setDatePreset(value: typeof datePreset) {
    datePreset = value;
    if (value === "all") { fromFilter = ""; toFilter = ""; return; }
    if (value === "custom") { showInvoiceFilters = true; openRangeCalendar(); return; }
    const today = new Date();
    let from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let to = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (value === "last12") { from = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()); }
    if (value === "yesterday") { from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1); to = new Date(from); }
    if (value === "last7") { from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6); }
    if (value === "month") { from = new Date(today.getFullYear(), today.getMonth(), 1); to = new Date(today.getFullYear(), today.getMonth() + 1, 0); }
    if (value === "previous_month") { from = new Date(today.getFullYear(), today.getMonth() - 1, 1); to = new Date(today.getFullYear(), today.getMonth(), 0); }
    if (value === "quarter") { const quarterMonth = Math.floor(today.getMonth() / 3) * 3; from = new Date(today.getFullYear(), quarterMonth, 1); to = new Date(today.getFullYear(), quarterMonth + 3, 0); }
    if (value === "previous_quarter") { const quarterMonth = Math.floor(today.getMonth() / 3) * 3 - 3; from = new Date(today.getFullYear(), quarterMonth, 1); to = new Date(today.getFullYear(), quarterMonth + 3, 0); }
    if (value === "year") { from = new Date(today.getFullYear(), 0, 1); to = new Date(today.getFullYear(), 11, 31); }
    if (value === "previous_year") { from = new Date(today.getFullYear() - 1, 0, 1); to = new Date(today.getFullYear() - 1, 11, 31); }
    const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    fromFilter = iso(from); toFilter = iso(to);
  }

  function isoDate(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
  function openRangeCalendar() {
    datePreset = "custom";
    const anchor = fromFilter ? new Date(`${fromFilter}T00:00:00`) : new Date();
    calendarCursor = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    calendarOpen = true;
  }
  function moveCalendar(months: number) { calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + months, 1); }
  function calendarDays(offset: number): Array<{ date: string; day: number } | null> {
    const month = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + offset, 1);
    const leading = (month.getDay() + 6) % 7;
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [...Array.from({ length: leading }, () => null), ...Array.from({ length: days }, (_, index) => ({ date: isoDate(new Date(month.getFullYear(), month.getMonth(), index + 1)), day: index + 1 }))];
  }
  function monthLabel(offset: number): string { return new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + offset, 1)); }
  function chooseCalendarDate(date: string) {
    if (!fromFilter || toFilter) { fromFilter = date; toFilter = ""; return; }
    if (date < fromFilter) { toFilter = fromFilter; fromFilter = date; } else { toFilter = date; calendarOpen = false; }
  }
  function inCalendarRange(date: string): boolean { return !!fromFilter && !!toFilter && date >= fromFilter && date <= toFilter; }

  function isOverdue(invoice: Invoice) {
    return invoice.status === "issued" && invoice.payment_status !== "paid" && !!invoice.due_at && invoice.due_at.slice(0, 10) < new Date().toISOString().slice(0, 10);
  }

  function setEmailFilter(value: "all" | "with" | "without") { emailFilter = value; filterSubmenu = null; filterMenuOpen = false; }
  function setKindFilter(value: typeof kindFilter) { kindFilter = value; filterSubmenu = null; filterMenuOpen = false; }
  function setSubtotalFilter(value: typeof subtotalFilter) { subtotalFilter = value; filterSubmenu = null; filterMenuOpen = false; }
  function setSeriesFilter(value: string) { seriesFilter = value; filterSubmenu = null; filterMenuOpen = false; }

  function chooseStatusFilter(value: "pending" | "paid" | "partial" | "cancelled" | "overdue" | "pending_overdue") {
    paymentFilter = value === "pending" || value === "overdue" || value === "pending_overdue" ? "pending" : value === "paid" || value === "partial" ? value : "all";
    invoiceStatusFilter = value === "cancelled" ? "cancelled" : "all";
    overdueFilter = value === "overdue" ? "overdue" : value === "pending_overdue" ? "pending_overdue" : "none";
    filterSubmenu = null;
    filterMenuOpen = false;
  }

  async function load() {
    loading = true;
    try {
      const [loadedInvoices, loadedSales, loadedRecords, loadedCustomers, loadedProducts, profiles, loadedProjects] = await Promise.all([api.listInvoices(), api.listSales(), api.listVerifactuRecords(), api.listCustomers(), api.listProducts(true), api.listFiscalProfiles(), api.listWorkProjects()]);
      invoices = loadedInvoices; sales = loadedSales; verifactuRecords = loadedRecords; customers = loadedCustomers; products = loadedProducts; invoiceSeries = profiles[0]?.invoice_series || "F";
      clientProjects = loadedProjects.filter((project) => project.project_type === "client" && project.status !== "archived");
    }
    catch (error) { showToast(error instanceof Error ? error.message : "No se pudieron cargar las facturas", "err"); }
    finally { loading = false; }
  }
  onMount(load);

  function openManualInvoice() {
    manualDraftId = null;
    manualForm = { kind: "complete", project_id: "", customer_id: "", customer_name: "", customer_nif: "", customer_email: "", operation_date: new Date().toISOString().slice(0, 10), due_at: "", irpf_rate: irpfRate, notes: "" };
    manualLines = [{ product_id: "", description: "", quantity: "1", unit_price: "", vat_rate: "21" }];
    manualError = "";
    manualOpen = true;
  }

  function editDraft(invoice: Invoice) {
    manualDraftId = invoice.id;
    manualForm = { kind: invoice.kind === "simplified" ? "simplified" : "complete", project_id: invoice.project_id ? String(invoice.project_id) : "", customer_id: invoice.customer_id ? String(invoice.customer_id) : "", customer_name: invoice.customer_name === "Cliente contado" ? "" : invoice.customer_name, customer_nif: invoice.customer_nif, customer_email: invoice.customer_email, operation_date: invoice.operation_date, due_at: invoice.due_at ?? "", irpf_rate: invoice.irpf_rate ? String(invoice.irpf_rate) : "", notes: invoice.notes };
    manualLines = invoice.lines.map((line) => ({ product_id: "", description: line.description, quantity: String(line.quantity), unit_price: String(line.unit_price_cents / 100), vat_rate: String(line.vat_rate) }));
    manualError = "";
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

  async function saveManualInvoice(status: "draft" | "issued") {
    manualSaving = true;
    manualError = "";
    try {
      const lines = manualLines.map((line) => ({ description: line.description.trim(), quantity: numberValue(line.quantity), unit_price_cents: Math.round(numberValue(line.unit_price) * 100), vat_rate: numberValue(line.vat_rate) as 0 | 4 | 10 | 21 }));
      if (lines.some((line) => !line.description || !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.unit_price_cents) || line.unit_price_cents < 0)) throw new Error("Revisa las líneas de la factura");
      let customerId = manualForm.customer_id ? Number(manualForm.customer_id) : null;
      if (manualForm.customer_name.trim()) {
        const customer = await api.upsertCustomer({ id: customerId, name: manualForm.customer_name.trim(), nif: manualForm.customer_nif.trim(), email: manualForm.customer_email.trim() });
        customerId = customer.id;
      }
      const invoice = await api.issueInvoice({ draft_id: manualDraftId, status, series: invoiceSeries, kind: manualForm.kind, project_id: manualForm.project_id ? Number(manualForm.project_id) : null, customer_id: customerId, customer_name: manualForm.customer_name, customer_nif: manualForm.customer_nif, customer_email: manualForm.customer_email, lines, operation_date: manualForm.operation_date || null, due_at: manualForm.due_at || null, irpf_rate: manualForm.irpf_rate ? Number(manualForm.irpf_rate) : undefined, notes: manualForm.notes });
      showToast(status === "draft" ? "Borrador guardado" : `Factura ${invoice.series}-${invoice.number} emitida`);
      manualOpen = false;
      if (status === "issued") { previewInvoice = invoice; previewOpen = true; }
      manualDraftId = status === "draft" ? invoice.id : null;
      await load();
    } catch (error) { manualError = error instanceof Error ? error.message : "No se pudo crear la factura"; showToast(manualError, "err"); }
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
    const amountCents = Math.round(Number(String(paymentAmount ?? "").replace(",", ".")) * 100);
    const pending = selectedInvoice.total_cents - selectedInvoice.paid_cents;
    if (!Number.isFinite(amountCents) || amountCents <= 0) { paymentError = "Introduce un importe válido mayor que cero."; return; }
    if (amountCents > pending) { paymentError = `El cobro no puede superar el pendiente (${formatEUR(pending)}).`; return; }
    paying = true;
    paymentError = "";
    try { await api.addInvoicePayment({ invoice_id: selectedInvoice.id, amount_cents: amountCents, method: paymentMethod }); showToast("Cobro registrado"); paymentAmount = ""; selectedInvoice = null; await load(); }
    catch (error) { paymentError = error instanceof Error ? error.message : "No se pudo registrar el cobro"; showToast(paymentError, "err"); }
    finally { paying = false; }
  }

  async function rectify(invoice: Invoice) {
    if (!await confirmDialog(`La factura ${invoice.series}-${invoice.number} quedará anulada mediante un abono rectificativo, conservando la trazabilidad fiscal.`, { title: "Anular factura", confirmLabel: "Anular factura", danger: true })) return;
    try { await api.issueInvoice({ rectifies_invoice_id: invoice.id, series: invoice.series, operation_date: operationDate, kind: "rectifying" }); showToast("Abono emitido"); await load(); }
    catch (error) { showToast(error instanceof Error ? error.message : "No se pudo crear el abono", "err"); }
  }

  async function cancel(invoice: Invoice) {
    if (invoice.status === "issued") { await rectify(invoice); return; }
    if (!await confirmDialog(`Se anulará la factura ${invoice.series}-${invoice.number}.`, { title: "Anular factura", confirmLabel: "Anular factura", danger: true })) return;
    try { await api.cancelInvoice(invoice.id); await load(); showToast("Factura anulada"); }
    catch (error) { showToast(error instanceof Error ? error.message : "No se pudo anular", "err"); }
  }

  async function print(invoice: Invoice) {
    const verifactu = verifactuRecords.find((record) => record.invoice_id === invoice.id && record.record_type === "alta");
    const qrDataUrl = verifactu ? await QRCode.toDataURL(verifactu.qr_url, { errorCorrectionLevel: "M", width: 150, margin: 2 }) : "";
    const qrHtml = verifactu ? `<div class="qr"><div>QR tributario:</div><img src="${qrDataUrl}" alt="QR tributario" /><div class="qr-label">${verifactu.mode === "test" ? "Entorno de pruebas VERI*FACTU" : "Factura verificable en la sede electrónica de la AEAT"}</div></div>` : "";
    const html = invoicePrintHtml(invoice, $activeCompany, qrHtml);
    const popup = window.open("", "_blank");
    if (!popup) { showToast("El navegador ha bloqueado la ventana de impresión", "err"); return; }
    popup.document.write(html); popup.document.close(); popup.focus(); popup.print();
  }
</script>

<section class="workspace-page">
  <div class="mb-5 flex flex-wrap items-center justify-between gap-4"><div><p class="text-xs uppercase tracking-[0.18em] text-slate-500">Facturación / Ventas</p><h2 class="mt-1 text-2xl font-semibold tracking-tight">Facturas de venta <span class="text-sm text-slate-500">ⓘ</span></h2><p class="mt-1 text-sm text-slate-400">Gestiona facturas emitidas, vencimientos y cobros.</p></div><div class="flex flex-wrap gap-2"><Button variant="secondary" onclick={load}>Actualizar</Button><Button variant="primary" onclick={openManualInvoice}>Nueva factura</Button></div></div>
  <div class="invoice-toolbar mb-5">
    <div class="flex flex-wrap items-center gap-2">
      <select class="field invoice-quick-status" aria-label="Estado" bind:value={invoiceStatusFilter}><option value="all">Todos</option><option value="paid">Pagado</option><option value="pending">Pendiente</option><option value="overdue">Vencido</option><option value="pending_overdue">Pendiente + Vencido</option><option value="partial">Pago parcial</option><option value="cancelled">Anulado</option><option value="not_cancelled">No anuladas</option></select>
      <div class="relative">
        <button type="button" class="invoice-filter-trigger" aria-expanded={filterMenuOpen} onclick={() => { filterMenuOpen = !filterMenuOpen; filterSubmenu = null; dateMenuOpen = false; }}>＋ Filtro{activeFilterCount ? ` · ${activeFilterCount}` : ""}</button>
        {#if filterMenuOpen}<div class="invoice-popover invoice-filter-menu">
          {#if filterSubmenu}<button type="button" class="invoice-back" onclick={() => (filterSubmenu = null)}>‹ <span>Volver</span></button>
            {#if filterSubmenu === "status"}<button type="button" onclick={() => chooseStatusFilter("pending")}>Pendiente</button><button type="button" onclick={() => chooseStatusFilter("paid")}>Pagado</button><button type="button" onclick={() => chooseStatusFilter("partial")}>Pago parcial</button><button type="button" onclick={() => chooseStatusFilter("cancelled")}>Anulado</button><button type="button" onclick={() => chooseStatusFilter("overdue")}>Vencimiento</button><button type="button" onclick={() => chooseStatusFilter("pending_overdue")}>Pendiente + Vencimiento</button>
            {:else if filterSubmenu === "email"}<button type="button" onclick={() => setEmailFilter("all")}>Todos</button><button type="button" onclick={() => setEmailFilter("with")}>Con email</button><button type="button" onclick={() => setEmailFilter("without")}>Sin email</button>
            {:else if filterSubmenu === "type"}<button type="button" onclick={() => setKindFilter("all")}>Todos</button><button type="button" onclick={() => setKindFilter("complete")}>Factura completa</button><button type="button" onclick={() => setKindFilter("simplified")}>Factura simplificada</button><button type="button" onclick={() => setKindFilter("rectifying")}>Rectificativa</button>
            {:else if filterSubmenu === "subtotal"}<button type="button" onclick={() => setSubtotalFilter("all")}>Todos</button><button type="button" onclick={() => setSubtotalFilter("with")}>Con subtotal</button><button type="button" onclick={() => setSubtotalFilter("without")}>Sin subtotal</button>
            {:else if filterSubmenu === "payment"}<button type="button" onclick={() => chooseStatusFilter("pending")}>Pendiente</button><button type="button" onclick={() => chooseStatusFilter("paid")}>Pagado</button><button type="button" onclick={() => chooseStatusFilter("partial")}>Pago parcial</button>
            {:else if filterSubmenu === "numbering"}<button type="button" onclick={() => setSeriesFilter("")}>Todas las series</button>{#each invoiceSeriesOptions as option}<button type="button" onclick={() => setSeriesFilter(option)}>Serie {option}</button>{/each}
            {:else}<button type="button" onclick={() => chooseStatusFilter("pending")}>Pendientes</button><button type="button" onclick={() => chooseStatusFilter("paid")}>Pagadas</button><button type="button" onclick={() => chooseStatusFilter("partial")}>Parciales</button>{/if}
          {:else}<button type="button" class="has-arrow" onclick={() => (filterSubmenu = "status")}>Estado <span>›</span></button><button type="button" class="has-arrow" onclick={() => (filterSubmenu = "email")}>Email <span>›</span></button><button type="button" class="has-arrow" onclick={() => (filterSubmenu = "type")}>Tipo <span>›</span></button><button type="button" class="has-arrow" onclick={() => (filterSubmenu = "subtotal")}>Subtotal <span>›</span></button><button type="button" class="has-arrow" onclick={() => (filterSubmenu = "numbering")}>Numeración de documentos <span>›</span></button><button type="button" class="has-arrow" onclick={() => (filterSubmenu = "payment")}>Forma de pago <span>›</span></button>{/if}
        </div>{/if}
      </div>
      {#if activeFilterCount}<span class="invoice-filter-count">{activeFilterCount} activos</span>{/if}
    </div>
    <div class="flex flex-1 flex-wrap items-center justify-end gap-2">
      <div class="relative min-w-[14rem] max-w-md flex-1"><svg class="invoice-search-icon pointer-events-none" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.6" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><input class="field invoice-search-input w-full" placeholder="Buscar número, cliente o NIF…" aria-label="Buscar facturas" bind:value={invoiceSearch} /></div>
      <div class="relative">
        <button type="button" class="invoice-date-trigger" aria-expanded={dateMenuOpen} onclick={() => { dateMenuOpen = !dateMenuOpen; filterMenuOpen = false; }}><svg class="invoice-calendar-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7 2.8v4M17 2.8v4M3 9h18M7 12.5h.01M12 12.5h.01M17 12.5h.01M7 16.5h.01M12 16.5h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span class="invoice-date-label">{dateFilterLabel}</span><span class="invoice-date-chevron" aria-hidden="true">⌄</span></button>
        {#if dateMenuOpen}<div class="invoice-popover invoice-date-menu">
          <aside class="invoice-date-presets">
            <p>PERIODO</p>
            {#each [{ value: "today", label: "Hoy" }, { value: "yesterday", label: "Ayer" }, { value: "last7", label: "Últimos 7 días" }, { value: "month", label: "Este mes" }, { value: "previous_month", label: "Mes anterior" }, { value: "quarter", label: "Este trimestre" }, { value: "previous_quarter", label: "Trimestre anterior" }, { value: "year", label: "Este año" }, { value: "last12", label: "Últimos 12 meses" }] as preset}
              <button type="button" class:active={datePreset === preset.value} onclick={() => { setDatePreset(preset.value as typeof datePreset); dateMenuOpen = false; }}>{preset.label}</button>
            {/each}
          </aside>
          <div class="invoice-range-calendar">
            <header><button type="button" class="invoice-month-nav" aria-label="Mes anterior" onclick={() => moveCalendar(-1)}>‹</button><div><strong>Selecciona un intervalo</strong><span>{fromFilter ? displayDate(fromFilter) : "Fecha inicial"} → {toFilter ? displayDate(toFilter) : "Fecha final"}</span></div><button type="button" class="invoice-month-nav" aria-label="Mes siguiente" onclick={() => moveCalendar(1)}>›</button></header>
            <div class="invoice-calendar-months">
              {#each [0, 1] as offset}
                <section><p class="invoice-month-label">{monthLabel(offset)}</p><div class="invoice-weekdays">{#each ["L", "M", "X", "J", "V", "S", "D"] as weekday}<span>{weekday}</span>{/each}</div><div class="invoice-days">{#each calendarDays(offset) as cell}<div>{#if cell}<button type="button" class:range-edge={cell.date === fromFilter || cell.date === toFilter} class:in-range={inCalendarRange(cell.date)} onclick={() => { setDatePreset("custom"); chooseCalendarDate(cell.date); }}>{cell.day}</button>{/if}</div>{/each}</div></section>
              {/each}
            </div>
            <footer><button type="button" class="invoice-date-clear" onclick={() => { fromFilter = ""; toFilter = ""; datePreset = "all"; }}>Borrar</button><div><button type="button" class="invoice-date-cancel" onclick={() => (dateMenuOpen = false)}>Cancelar</button><button type="button" class="invoice-date-apply" disabled={!fromFilter || !toFilter} onclick={() => (dateMenuOpen = false)}>Aplicar</button></div></footer>
          </div>
        </div>{/if}
      </div>
      <Button variant="ghost" class="!rounded-lg !px-3 !py-2 text-xs" onclick={clearInvoiceFilters}>Limpiar</Button>
    </div>
  </div>
  <div class="mb-5 grid gap-3 sm:grid-cols-3"><Card lift={false} class="p-4"><p class="text-xs text-slate-400">Facturas emitidas</p><p class="mt-1 text-2xl font-semibold">{invoices.length}</p></Card><Card lift={false} class="p-4"><p class="text-xs text-slate-400">Pendiente de cobro</p><p class="mt-1 text-2xl font-semibold text-amber-200">{formatEUR(pendingCents)}</p></Card><Card lift={false} class="p-4"><p class="text-xs text-slate-400">Vencido</p><p class="mt-1 text-2xl font-semibold text-rose-300">{formatEUR(overdueCents)}</p></Card></div>

  {#if showInvoiceFilters}<Card lift={false} class="mb-5 border-purple-400/20 p-4">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 class="font-semibold">Filtros avanzados</h3><p class="text-xs text-slate-400">Añade criterios de cobro, cliente o serie sin ocupar la barra principal.</p></div></div>
    <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      <input class="field sm:col-span-2 xl:col-span-2" placeholder="Buscar número, cliente o NIF…" bind:value={invoiceSearch} />
      <select class="field" bind:value={invoiceStatusFilter}><option value="all">Estado: todos</option><option value="draft">Borradores</option><option value="issued">Emitidas</option><option value="cancelled">Anuladas</option></select>
      <select class="field" bind:value={paymentFilter}><option value="all">Cobro: todos</option><option value="pending">Pendientes</option><option value="partial">Parciales</option><option value="paid">Pagadas</option></select>
      <select class="field" bind:value={customerFilter}><option value="">Cliente: todos</option>{#each customers as customer}<option value={customer.id}>{customer.name}</option>{/each}</select>
      <select class="field" bind:value={seriesFilter}><option value="">Serie: todas</option>{#each invoiceSeriesOptions as invoiceSeriesOption}<option value={invoiceSeriesOption}>{invoiceSeriesOption}</option>{/each}</select>
      <select class="field" value={datePreset} onchange={(event) => setDatePreset(event.currentTarget.value as typeof datePreset)}><option value="all">Fecha: todas</option><option value="month">Este mes</option><option value="quarter">Trimestre actual</option><option value="previous_quarter">Trimestre anterior</option><option value="year">Este año</option><option value="previous_year">Año anterior</option><option value="custom">Personalizado</option></select>
      {#if datePreset === "custom"}<div class="relative sm:col-span-2"><button type="button" class="field flex w-full items-center justify-between text-left" onclick={() => (calendarOpen = !calendarOpen)}><span>{fromFilter && toFilter ? `${fromFilter} → ${toFilter}` : fromFilter ? `${fromFilter} → Selecciona la fecha final` : "Seleccionar intervalo"}</span><span class="text-slate-400">▣</span></button>{#if calendarOpen}<div class="absolute left-0 top-full z-30 mt-2 w-[min(46rem,calc(100vw-3rem))] rounded-2xl border border-white/15 bg-[#17121f] p-4 shadow-2xl"><div class="mb-3 flex items-center justify-between"><Button variant="ghost" class="px-2 text-lg" onclick={() => moveCalendar(-1)}>‹</Button><p class="text-xs text-slate-400">Selecciona inicio y fin</p><Button variant="ghost" class="px-2 text-lg" onclick={() => moveCalendar(1)}>›</Button></div><div class="grid gap-5 sm:grid-cols-2">{#each [0, 1] as offset}<div><p class="mb-2 text-center text-sm font-semibold capitalize">{monthLabel(offset)}</p><div class="mb-1 grid grid-cols-7 text-center text-[10px] uppercase text-slate-500">{#each ["L", "M", "X", "J", "V", "S", "D"] as weekday}<span>{weekday}</span>{/each}</div><div class="grid grid-cols-7 gap-1">{#each calendarDays(offset) as cell}<div class="aspect-square">{#if cell}<button type="button" class="h-full w-full rounded-lg text-xs transition hover:bg-purple-500/30 {cell.date === fromFilter || cell.date === toFilter ? "bg-purple-500 text-white" : inCalendarRange(cell.date) ? "bg-purple-500/20 text-purple-100" : "text-slate-300"}" onclick={() => chooseCalendarDate(cell.date)}>{cell.day}</button>{/if}</div>{/each}</div></div>{/each}</div><div class="mt-4 flex justify-end gap-2 border-t border-white/10 pt-3"><Button variant="ghost" class="text-xs" onclick={() => { fromFilter = ""; toFilter = ""; }}>Borrar</Button><Button variant="secondary" class="text-xs" onclick={() => (calendarOpen = false)}>Aplicar</Button></div></div>{/if}</div>{/if}
    </div>
  </Card>{/if}

  {#if availableSales.length > 0}<Card lift={false} class="mb-5 p-4"><h3 class="mb-3 font-semibold">Ventas pendientes de facturar</h3><div class="space-y-2">{#each availableSales as sale}<div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-3"><div><strong>{sale.number}</strong><span class="ml-2 text-sm text-slate-400">{sale.customer_name || "Cliente contado"} · {formatEUR(sale.total_cents)}</span></div><Button class="text-xs" disabled={issuing === sale.id} onclick={() => issue(sale)}>{issuing === sale.id ? "Emitiendo…" : sale.customer_id ? "Emitir factura" : "Emitir simplificada"}</Button></div>{/each}</div></Card>{/if}

  {#if loading}<div class="skeleton h-48"></div>{:else if filteredInvoices.length === 0}<Card lift={false} class="p-10 text-center"><p class="text-sm text-[var(--color-muted)]">{invoices.length === 0 ? "Todavía no hay facturas emitidas." : "No hay facturas que coincidan con los filtros."}</p></Card>{:else}<Card lift={false} class="invoice-table-card overflow-hidden p-0"><div class="overflow-x-auto"><table class="invoice-table w-full min-w-[1280px] text-left text-sm"><thead><tr><SortableHeader label="Fecha" active={invoiceSortKey === "date"} direction={invoiceSortDirection} onclick={() => sortInvoices("date")} /><SortableHeader label="Nº factura" active={invoiceSortKey === "number"} direction={invoiceSortDirection} onclick={() => sortInvoices("number")} /><SortableHeader label="Fecha operación" active={invoiceSortKey === "operation_date"} direction={invoiceSortDirection} onclick={() => sortInvoices("operation_date")} /><th>Vencimiento</th><SortableHeader label="Cliente" active={invoiceSortKey === "customer"} direction={invoiceSortDirection} onclick={() => sortInvoices("customer")} /><th>Descripción</th><th>Etiquetas</th><SortableHeader label="Subtotal" align="right" active={invoiceSortKey === "base"} direction={invoiceSortDirection} onclick={() => sortInvoices("base")} /><SortableHeader label="IVA" align="right" active={invoiceSortKey === "vat"} direction={invoiceSortDirection} onclick={() => sortInvoices("vat")} /><th class="text-right">Retención</th><SortableHeader label="Cobrado" align="right" active={invoiceSortKey === "paid"} direction={invoiceSortDirection} onclick={() => sortInvoices("paid")} /><SortableHeader label="Pendiente" align="right" active={invoiceSortKey === "pending"} direction={invoiceSortDirection} onclick={() => sortInvoices("pending")} /><th>Fecha de cobro</th><th class="text-right">⋮</th></tr></thead><tbody>{#each paginatedInvoices as invoice}<tr class="invoice-row-clickable" onclick={(event) => openInvoicePreview(event, invoice)}><td>{invoice.issued_at.slice(0, 10)}</td><td><p class="font-semibold">{invoice.series}{invoice.number}</p><p class="invoice-subline">{invoice.status === "draft" ? "Borrador" : invoice.kind === "simplified" ? "Simplificada" : "Factura"}</p></td><td>{invoice.operation_date}</td><td>{invoice.due_at ?? "—"}</td><td><p>{invoice.customer_name}</p>{#if invoice.customer_nif}<p class="invoice-subline">{invoice.customer_nif}</p>{/if}</td><td class="max-w-[13rem] truncate">{invoice.notes || "—"}</td><td><span class:invoice-tag-issued={invoice.status === "issued"} class:invoice-tag-draft={invoice.status === "draft"} class:invoice-tag-cancelled={invoice.status === "cancelled"} class="invoice-tag">{invoice.status === "issued" ? "Emitida" : invoice.status === "draft" ? "Borrador" : "Anulada"}</span>{#if isOverdue(invoice)} <span class="invoice-tag invoice-tag-danger">Vencida</span>{/if}</td><td class="text-right tabular">{formatEUR(invoice.base_cents)}</td><td class="text-right tabular">{formatEUR(invoice.vat_cents)}</td><td class="text-right tabular">{formatEUR(invoice.irpf_cents)}</td><td class="text-right tabular">{formatEUR(invoice.paid_cents)}</td><td class="text-right tabular font-semibold">{formatEUR(Math.max(0, invoice.total_cents - invoice.paid_cents))}</td><td>{invoice.payment_status === "paid" ? invoice.issued_at.slice(0, 10) : "—"}</td><td class="text-right"><div class="relative inline-block"><button type="button" class="invoice-more" aria-label={`Acciones de ${invoice.series}-${invoice.number}`} aria-expanded={actionInvoiceId === invoice.id} onclick={(event) => { event.stopPropagation(); actionInvoiceId = actionInvoiceId === invoice.id ? null : invoice.id; }}>⋮</button>{#if actionInvoiceId === invoice.id}<div class="invoice-popover invoice-actions-menu"><button type="button" onclick={(event) => { event.stopPropagation(); void print(invoice); }}>Enviar / descargar</button>{#if invoice.status === "draft"}<button type="button" onclick={(event) => { event.stopPropagation(); actionInvoiceId = null; editDraft(invoice); }}><span>Editar</span></button><button type="button" class="danger" onclick={(event) => { event.stopPropagation(); actionInvoiceId = null; void cancel(invoice); }}>Eliminar</button>{:else}<button type="button" onclick={(event) => { event.stopPropagation(); actionInvoiceId = null; selectedInvoice = invoice; paymentAmount = String(Math.max(0, invoice.total_cents - invoice.paid_cents) / 100); }}>Registrar cobro</button>{#if invoice.status === "issued"}<button type="button" onclick={(event) => { event.stopPropagation(); actionInvoiceId = null; void rectify(invoice); }}>Crear rectificativa</button>{/if}{/if}</div>{/if}</div></td></tr>{/each}</tbody><tfoot><tr><td colspan="7">{displayedInvoices.length} facturas</td><td class="text-right tabular">{formatEUR(displayedInvoices.reduce((sum, invoice) => sum + invoice.base_cents, 0))}</td><td class="text-right tabular">{formatEUR(displayedInvoices.reduce((sum, invoice) => sum + invoice.vat_cents, 0))}</td><td class="text-right tabular">{formatEUR(displayedInvoices.reduce((sum, invoice) => sum + invoice.irpf_cents, 0))}</td><td class="text-right tabular">{formatEUR(displayedInvoices.reduce((sum, invoice) => sum + invoice.paid_cents, 0))}</td><td class="text-right tabular">{formatEUR(displayedInvoices.reduce((sum, invoice) => sum + Math.max(0, invoice.total_cents - invoice.paid_cents), 0))}</td><td colspan="2"></td></tr></tfoot></table></div></Card>{/if}

  <div class="invoice-pagination"><span>{displayedInvoices.length ? `${(invoicePage - 1) * invoicePageSize + 1} - ${Math.min(invoicePage * invoicePageSize, displayedInvoices.length)}` : "0"} de {displayedInvoices.length}</span><select class="invoice-page-size" aria-label="Filas por página" bind:value={invoicePageSize} onchange={() => (invoicePage = 1)}><option value={50}>50</option><option value={25}>25</option><option value={100}>100</option></select><div class="invoice-page-controls"><button type="button" aria-label="Página anterior" disabled={invoicePage === 1} onclick={() => changeInvoicePage(invoicePage - 1)}><span aria-hidden="true">‹</span></button><span class="invoice-current-page">{invoicePage}</span><button type="button" aria-label="Página siguiente" disabled={invoicePage === invoicePageCount} onclick={() => changeInvoicePage(invoicePage + 1)}><span aria-hidden="true">›</span></button></div></div>

  <Modal open={!!selectedInvoice} title={selectedInvoice ? `Registrar cobro · ${selectedInvoice.series}-${selectedInvoice.number}` : "Registrar cobro"} size="sm" onclose={() => { selectedInvoice = null; paymentError = ""; }}>
    {#if selectedInvoice}<div class="space-y-4"><div class="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3"><p class="text-sm text-slate-400">Pendiente de cobro</p><p class="mt-1 text-2xl font-semibold text-emerald-200">{formatEUR(selectedInvoice.total_cents - selectedInvoice.paid_cents)}</p></div><label class="block text-sm"><span class="mb-1 block text-slate-400">Importe (€)</span><MoneyInput bind:value={paymentAmount} ariaLabel="Importe (€)" /></label><label class="block text-sm"><span class="mb-1 block text-slate-400">Método</span><select class="field w-full" bind:value={paymentMethod}><option value="bank_transfer">Transferencia</option><option value="card">Tarjeta</option><option value="cash">Efectivo</option><option value="other">Otro</option></select></label>{#if paymentError}<p class="rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200" role="alert">{paymentError}</p>{/if}<div class="flex justify-end gap-2"><Button variant="ghost" onclick={() => (selectedInvoice = null)}>Cancelar</Button><Button disabled={paying} onclick={addPayment}>{paying ? "Guardando…" : "Guardar cobro"}</Button></div></div>{/if}
  </Modal>
</section>

<Modal open={manualOpen} title={manualDraftId ? "Editar borrador de factura" : "Nueva factura"} size="full" onclose={() => (manualOpen = false)}>
  <div class="space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
      <div>
        <p class="text-xs uppercase tracking-[0.18em] text-slate-500">Facturación / Ventas</p>
        <h3 class="mt-1 text-xl font-semibold">{manualDraftId ? "Editar borrador" : "Nueva factura"}</h3>
        <p class="mt-1 text-xs text-slate-400">Completa los datos, añade líneas y revisa el total antes de emitir.</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button variant="ghost" onclick={() => (manualOpen = false)}>Volver</Button>
        <Button variant="secondary" disabled={manualSaving} onclick={() => saveManualInvoice("draft")}>Guardar como borrador</Button>
        <Button variant="primary" disabled={manualSaving} onclick={() => saveManualInvoice("issued")}>{manualSaving ? "Emitiendo…" : "Emitir factura"}</Button>
      </div>
    </div>
    <div class="grid gap-3 sm:grid-cols-3">
      <label class="text-sm"><span class="mb-1 block text-slate-400">Tipo</span><select class="field w-full" bind:value={manualForm.kind}><option value="complete">Completa</option><option value="simplified">Simplificada</option></select></label>
      <label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Fecha operación</span><DatePicker bind:value={manualForm.operation_date} /></label>
      <label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Vencimiento</span><DatePicker bind:value={manualForm.due_at} align="right" /></label>
    </div>
    {#if clientProjects.length}
      <label class="text-sm"><span class="mb-1 block text-[var(--color-muted)]">Proyecto del cliente (visible en su portal)</span><select class="field w-full" bind:value={manualForm.project_id}><option value="">Sin proyecto</option>{#each clientProjects as project}<option value={project.id}>{project.name}</option>{/each}</select></label>
    {/if}
    <div class="grid gap-3 sm:grid-cols-3">
      <label class="text-sm"><span class="mb-1 block text-slate-400">Cliente guardado</span><select class="field w-full" value={manualForm.customer_id} onchange={(event) => selectManualCustomer(event.currentTarget.value)}><option value="">Cliente nuevo / contado</option>{#each customers as customer}<option value={customer.id}>{customer.name}{customer.nif ? ` · ${customer.nif}` : ""}</option>{/each}</select></label>
      <label class="text-sm"><span class="mb-1 block text-slate-400">Nombre / razón social</span><input class="field w-full" bind:value={manualForm.customer_name} /></label>
      <label class="text-sm"><span class="mb-1 block text-slate-400">NIF {manualForm.kind === "complete" ? "(obligatorio)" : "(opcional)"}</span><input class="field w-full" bind:value={manualForm.customer_nif} /></label>
      <label class="text-sm"><span class="mb-1 block text-slate-400">Email</span><input type="email" class="field w-full" bind:value={manualForm.customer_email} /></label>
      <div class="flex items-end"><Button variant="secondary" class="w-full text-xs" disabled={creatingCustomer || !manualForm.customer_name.trim()} onclick={createManualCustomer}>{creatingCustomer ? "Guardando…" : manualForm.customer_id ? "Actualizar cliente" : "+ Añadir cliente"}</Button></div>
    </div>
    <div class="rounded-2xl border border-white/10 bg-white/[0.02] p-4"><div class="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 class="font-semibold">Conceptos de la factura</h3><p class="text-xs text-slate-400">Añade productos del catálogo o escribe un servicio personalizado. El total se calcula automáticamente.</p></div><Button variant="secondary" class="text-xs" onclick={addManualLine}>+ Añadir línea</Button></div><div class="hidden gap-2 px-1 pb-2 text-[11px] uppercase tracking-wide text-slate-500 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)_5rem_7rem_6rem_6rem_auto]"><span>Producto / servicio</span><span>Descripción</span><span>Cant.</span><span>Precio (€)</span><span>IVA</span><span>Importe</span><span></span></div><div class="space-y-3">{#each manualLines as line, index}<div class="rounded-xl border border-white/10 bg-black/10 p-3"><div class="grid items-end gap-2 lg:grid-cols-[13rem_minmax(0,1fr)_5rem_7rem_6rem_6rem_auto]"><label class="text-sm"><span class="mb-1 block text-slate-400 lg:hidden">Producto / servicio</span><select class="field w-full" value={line.product_id} onchange={(event) => selectManualProduct(index, event.currentTarget.value)}><option value="">Personalizado</option>{#each products as product}<option value={product.id}>{product.name}</option>{/each}</select></label><label class="text-sm"><span class="mb-1 block text-slate-400 lg:hidden">Descripción</span><input class="field w-full" placeholder="Descripción del concepto" bind:value={line.description} /></label><label class="text-sm"><span class="mb-1 block text-slate-400 lg:hidden">Cantidad</span><input type="number" min="0.01" step="0.01" class="field w-full" bind:value={line.quantity} /></label><label class="text-sm"><span class="mb-1 block text-slate-400 lg:hidden">Precio (€)</span><MoneyInput bind:value={line.unit_price} ariaLabel="Precio (€)" /></label><label class="text-sm"><span class="mb-1 block text-slate-400 lg:hidden">IVA</span><select class="field w-full" bind:value={line.vat_rate}><option value="21">21%</option><option value="10">10%</option><option value="4">4%</option><option value="0">0%</option></select></label><div class="text-right text-sm font-semibold tabular"><span class="mb-1 block text-slate-400 lg:hidden">Importe</span>{formatEUR((Math.round(numberValue(line.quantity) * numberValue(line.unit_price) * 100) || 0) + Math.round((Math.round(numberValue(line.quantity) * numberValue(line.unit_price) * 100) || 0) * numberValue(line.vat_rate) / 100))}</div><Button variant="ghost" class="text-xs" disabled={manualLines.length === 1} onclick={() => removeManualLine(index)}>Quitar</Button></div></div>{/each}</div><div class="mt-4 flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-white/10 pt-3 text-sm"><span>Base: <strong>{formatEUR(manualTotals.base)}</strong></span><span>IVA: <strong>{formatEUR(manualTotals.vat)}</strong></span><span class="text-base">Total: <strong>{formatEUR(manualTotals.total)}</strong></span></div></div>
    <div class="grid gap-3 sm:grid-cols-3"><label class="text-sm"><span class="mb-1 block text-slate-400">IRPF %</span><input type="number" min="0" max="100" step="0.01" class="field w-full" bind:value={manualForm.irpf_rate} /></label><label class="text-sm sm:col-span-2"><span class="mb-1 block text-slate-400">Notas</span><input class="field w-full" placeholder="Condiciones de pago, referencia…" bind:value={manualForm.notes} /></label></div>
    {#if manualError}<p class="rounded-xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200" role="alert">{manualError}</p>{/if}
    <div class="flex flex-wrap justify-end gap-2"><Button variant="ghost" onclick={() => (manualOpen = false)}>Cancelar</Button><Button variant="secondary" disabled={manualSaving} onclick={() => saveManualInvoice("draft")}>{manualSaving ? "Guardando…" : "Guardar borrador"}</Button><Button variant="primary" disabled={manualSaving} onclick={() => saveManualInvoice("issued")}>{manualSaving ? "Guardando…" : "Emitir factura"}</Button></div>
  </div>
</Modal>

<style>
  .invoice-toolbar { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:.75rem; padding:.5rem; border:1px solid var(--color-border); border-radius:.7rem; background:var(--color-obsidian-panel); }
  .invoice-quick-status, .invoice-date-trigger, .invoice-filter-trigger { min-height:2.35rem; }
  .invoice-filter-trigger, .invoice-date-trigger { border:1px solid var(--color-border); border-radius:.45rem; background:transparent; color:var(--color-text); padding:.45rem .7rem; cursor:pointer; font-size:.84rem; }
  .invoice-date-trigger { display:flex; align-items:center; gap:.65rem; min-width:15rem; justify-content:flex-start; padding-inline:.8rem; }
  .invoice-date-label { flex:1; text-align:left; white-space:nowrap; }
  .invoice-date-chevron { display:grid; width:1.5rem; height:1.5rem; flex:none; place-items:center; margin-left:.35rem; color:var(--color-muted-dim); font-size:.85rem; line-height:1; }
  .invoice-calendar-icon { width:1.15rem; height:1.15rem; flex:none; }
  .invoice-search-icon { position:absolute; left:.75rem; top:50%; width:1.2rem; height:1.2rem; transform:translateY(-50%); color:var(--color-muted); }
  .invoice-search-input { padding-left:2.55rem !important; }
  .invoice-filter-trigger:hover, .invoice-date-trigger:hover { border-color:var(--color-border-strong); background:var(--color-purple-mist); }
  .invoice-filter-count { color:var(--color-purple); font-size:.72rem; }
  .invoice-popover { position:absolute; z-index:40; top:calc(100% + .45rem); min-width:15rem; border:1px solid var(--color-border); border-radius:.55rem; background:var(--color-obsidian-elevated); box-shadow:0 14px 32px rgba(0,0,0,.35); padding:.4rem; }
  .invoice-filter-menu { left:0; }
  .invoice-date-menu { right:0; display:grid; grid-template-columns:10.5rem minmax(34rem,1fr); width:min(48rem,calc(100vw - 2rem)); padding:0; overflow:hidden; }
  .invoice-date-presets { padding:.75rem; border-right:1px solid var(--color-border); background:rgba(0,0,0,.12); }
  .invoice-date-presets p { padding:.35rem .65rem .55rem; color:var(--color-muted-dim); font-size:.62rem; font-weight:700; letter-spacing:.14em; }
  .invoice-range-calendar { min-width:0; padding:1rem; }
  .invoice-range-calendar header { display:grid; grid-template-columns:2.25rem 1fr 2.25rem; align-items:center; gap:.75rem; margin-bottom:1rem; }
  .invoice-range-calendar header div { text-align:center; }
  .invoice-range-calendar header strong { display:block; color:var(--color-text); font-size:.85rem; }
  .invoice-range-calendar header span { display:block; margin-top:.15rem; color:var(--color-muted); font-size:.7rem; }
  .invoice-popover button.invoice-month-nav { display:grid; width:2.25rem; height:2.25rem; padding:0 0 .15rem; place-items:center; border:1px solid var(--color-border); border-radius:.5rem; font-size:1.2rem; text-align:center; }
  .invoice-calendar-months { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1.5rem; }
  .invoice-month-label { margin-bottom:.65rem; color:var(--color-text); font-size:.78rem; font-weight:700; text-align:center; text-transform:capitalize; }
  .invoice-weekdays,.invoice-days { display:grid; grid-template-columns:repeat(7,1fr); text-align:center; }
  .invoice-weekdays { margin-bottom:.25rem; color:var(--color-muted-dim); font-size:.6rem; font-weight:700; }
  .invoice-days > div { display:grid; min-height:2rem; place-items:center; }
  .invoice-popover .invoice-days button { display:grid; width:2rem; height:2rem; padding:0; place-items:center; border-radius:50%; color:var(--color-muted); font-size:.72rem; text-align:center; }
  .invoice-popover .invoice-days button.in-range { border-radius:0; background:rgba(168,85,247,.14); color:var(--color-text); }
  .invoice-popover .invoice-days button.range-edge { border-radius:50%; background:var(--color-purple); color:white; font-weight:700; }
  .invoice-range-calendar footer { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-top:1rem; padding-top:.85rem; border-top:1px solid var(--color-border); }
  .invoice-range-calendar footer > div { display:flex; gap:.5rem; }
  .invoice-popover button.invoice-date-clear,.invoice-popover button.invoice-date-cancel,.invoice-popover button.invoice-date-apply { width:auto; padding:.5rem .8rem; text-align:center; }
  .invoice-popover button.invoice-date-clear { color:var(--color-muted); }
  .invoice-popover button.invoice-date-apply { background:var(--color-purple); color:white; font-weight:700; }
  .invoice-popover button.invoice-date-apply:disabled { opacity:.4; cursor:not-allowed; }
  .invoice-actions-menu { right:0; top:auto; bottom:calc(100% + .35rem); min-width:12rem; }
  .invoice-popover button { display:block; width:100%; border:0; border-radius:.35rem; background:transparent; color:var(--color-text); padding:.62rem .65rem; text-align:left; cursor:pointer; font-size:.84rem; }
  .invoice-popover button:hover, .invoice-popover button.active { background:var(--color-purple-soft); color:var(--color-purple-bright); }
  .invoice-popover button.danger { color:var(--color-danger); }
  .invoice-popover button.has-arrow { display:flex; justify-content:space-between; align-items:center; }
  .invoice-popover button.has-arrow span { font-size:1.35rem; line-height:1; }
  .invoice-popover button.invoice-back { color:var(--color-purple); font-weight:600; margin-bottom:.25rem; }
  .invoice-table { border-collapse:separate; border-spacing:0; }
  .invoice-table th:nth-child(6), .invoice-table td:nth-child(6) { display:none; }
  .invoice-table th { background:var(--color-obsidian-elevated); color:var(--color-muted-dim); font-size:.66rem; font-weight:600; letter-spacing:.04em; padding:.65rem .7rem; white-space:nowrap; }
  .invoice-table td { border-top:1px solid var(--color-border-soft); color:var(--color-text); padding:.72rem .7rem; white-space:nowrap; }
  .invoice-table tbody tr:hover { background:var(--color-purple-mist); }
  .invoice-table tfoot td { border-top:1px solid var(--color-border); color:var(--color-text); font-weight:700; padding:.8rem .7rem; }
  .invoice-pagination { display:flex; align-items:center; gap:.7rem; min-height:3rem; padding:.35rem 1rem .35rem .6rem; color:var(--color-muted); font-size:.72rem; }
  .invoice-page-size { border:1px solid var(--color-border); border-radius:.3rem; background:var(--color-obsidian-panel); color:var(--color-text); padding:.25rem .4rem; font-size:.7rem; }
  .invoice-page-controls { display:flex; align-items:center; gap:.35rem; margin-left:auto; padding-left:.75rem; }
  .invoice-page-controls button { display:grid; width:2rem; height:2rem; flex:none; place-items:center; border:1px solid var(--color-border); border-radius:.45rem; background:var(--color-obsidian-panel); color:var(--color-muted); cursor:pointer; font-size:1.15rem; line-height:1; padding:0 0 .1rem; transition:border-color .2s,background .2s,color .2s; }
  .invoice-page-controls button:not(:disabled):hover { border-color:var(--color-border-strong); background:var(--color-purple-soft); color:var(--color-purple-bright); }
  .invoice-current-page { min-width:1.75rem; text-align:center; font-variant-numeric:tabular-nums; }
  .invoice-page-controls button:disabled { opacity:.3; cursor:default; }
  .invoice-subline { color:var(--color-muted-dim); font-size:.68rem; margin-top:.15rem; }
  .invoice-tag { display:inline-block; border-radius:.25rem; background:rgba(148,139,153,.14); color:var(--color-muted); font-size:.66rem; padding:.16rem .35rem; }
  .invoice-tag-issued { background:rgba(52,211,153,.16); color:#34d399; }
  .invoice-tag-draft { background:rgba(251,191,36,.16); color:#fbbf24; }
  .invoice-tag-cancelled { background:rgba(251,113,133,.16); color:#fb7185; }
  .invoice-tag-danger { background:rgba(251,113,133,.12); color:var(--color-danger); }
  .invoice-more { border:0; background:transparent; color:var(--color-muted); font-size:1.2rem; line-height:1; padding:.2rem .45rem; cursor:pointer; }
  @media (max-width: 760px) {
    .invoice-date-menu { grid-template-columns:1fr; width:min(34rem,calc(100vw - 1rem)); }
    .invoice-date-presets { display:flex; gap:.25rem; overflow-x:auto; border-right:0; border-bottom:1px solid var(--color-border); }
    .invoice-date-presets p { display:none; }
    .invoice-date-presets button { flex:none; width:auto; }
    .invoice-calendar-months { grid-template-columns:1fr; }
    .invoice-calendar-months section:nth-child(2) { display:none; }
  }
  .invoice-more:hover { color:var(--color-purple-bright); }
</style>


<Modal open={previewOpen} title={previewInvoice ? `Vista previa · ${previewInvoice.series}-${previewInvoice.number}` : "Vista previa de factura"} size="xl" onclose={() => (previewOpen = false)}>
  {#if previewInvoice}
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3"><div><p class="font-semibold text-emerald-200">Factura emitida correctamente</p><p class="text-xs text-slate-400">Revísala antes de imprimirla o guardarla como PDF.</p></div><div class="flex flex-wrap gap-2"><Button variant="ghost" onclick={() => previewInvoice && rectify(previewInvoice)}>Crear rectificativa</Button><Button variant="secondary" onclick={() => { if (previewInvoice) { selectedInvoice = previewInvoice; paymentAmount = String(Math.max(0, previewInvoice.total_cents - previewInvoice.paid_cents) / 100); } }}>Registrar cobro</Button><Button variant="primary" onclick={() => previewInvoice && print(previewInvoice)}>Imprimir / guardar PDF</Button></div></div>
    <CommercialDocument
      company={$activeCompany}
      documentType={previewInvoice.kind === "simplified" ? "Factura simplificada" : previewInvoice.kind === "rectifying" ? "Factura rectificativa" : "Factura"}
      number={`${previewInvoice.series}-${previewInvoice.number}`}
      operationDate={previewInvoice.operation_date}
      dueDate={previewInvoice.due_at}
      customerName={previewInvoice.customer_name}
      customerNif={previewInvoice.customer_nif}
      customerEmail={previewInvoice.customer_email}
      introduction={previewInvoice.notes}
      lines={previewInvoice.lines.map((line) => ({ description: line.description, quantity: line.quantity, unit_price_cents: line.unit_price_cents, vat_rate: line.vat_rate, total_cents: line.total_cents }))}
      baseCents={previewInvoice.base_cents}
      vatCents={previewInvoice.vat_cents}
      irpfCents={previewInvoice.irpf_cents}
      totalCents={previewInvoice.total_cents}
      paidCents={previewInvoice.paid_cents}
      status={previewInvoice.status === "issued" ? "Emitida" : previewInvoice.status === "draft" ? "Borrador" : "Anulada"}
    />
    <div class="mt-4 flex justify-end"><Button variant="ghost" onclick={() => (previewOpen = false)}>Cerrar vista previa</Button></div>
  {/if}
</Modal>
