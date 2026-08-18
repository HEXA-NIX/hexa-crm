<script lang="ts">
  import type { Company } from "$lib/types";
  import { formatEUR } from "$lib/money";
  import RichDescription from "$lib/components/RichDescription.svelte";

  export type CommercialLine = {
    description: string;
    detail?: string;
    quantity: number;
    unit_price_cents: number;
    vat_rate: number;
    total_cents: number;
  };

  let {
    company,
    documentType,
    subject = "",
    number,
    operationDate,
    dueDate = "",
    customerName,
    customerNif = "",
    customerEmail = "",
    introduction = "",
    lines = [],
    baseCents,
    vatCents,
    irpfCents = 0,
    totalCents,
    paidCents,
    notes = "",
    status = "",
  }: {
    company: Company | null;
    documentType: string;
    subject?: string;
    number: string;
    operationDate: string;
    dueDate?: string | null;
    customerName: string;
    customerNif?: string;
    customerEmail?: string;
    introduction?: string;
    lines?: CommercialLine[];
    baseCents: number;
    vatCents: number;
    irpfCents?: number;
    totalCents: number;
    paidCents?: number;
    notes?: string;
    status?: string;
  } = $props();

  const companyName = $derived(company?.trade_name || company?.legal_name || "Empresa");
  const companyAddress = $derived([company?.address, [company?.postal_code, company?.city].filter(Boolean).join(" "), company?.province].filter(Boolean).join(" · "));
  const pendingCents = $derived(paidCents == null ? null : Math.max(0, totalCents - paidCents));
  const displayDate = (value: string | null | undefined) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("es-ES") : "—";
</script>

<article class="commercial-document">
  <header class="commercial-cover">
    <div class="commercial-brand">
      <div>
        <p class="commercial-company">{companyName}</p>
        <p class="commercial-kicker">{documentType}</p>
        {#if subject}<h1 class="commercial-subject">{subject}</h1>{/if}
      </div>
      <img src={company?.logo_data_url || "/logo-mark.svg"} alt="Logo de {companyName}" />
    </div>
    <div class="commercial-meta">
      <div><span>CLIENTE</span><strong>{customerName || "Sin cliente"}</strong>{#if customerNif}<small>NIF: {customerNif}</small>{/if}{#if customerEmail}<small>{customerEmail}</small>{/if}</div>
      <div class="commercial-meta-right"><span>DOCUMENTO</span><strong>{number}</strong><small>Emisión: {displayDate(operationDate)}</small>{#if dueDate}<small>Vencimiento: {displayDate(dueDate)}</small>{/if}</div>
    </div>
  </header>

  {#if introduction}
    <section class="commercial-section">
      <h3><i></i>Proyecto y alcance</h3>
      <div class="commercial-introduction"><RichDescription value={introduction} /></div>
    </section>
  {/if}

  <section class="commercial-section">
    <div class="commercial-section-heading"><h3><i></i>Propuesta económica</h3>{#if status}<span>{status}</span>{/if}</div>
    <div class="commercial-table-wrap">
      <table>
        <thead><tr><th>Concepto / servicio</th><th>Detalle</th><th class="numeric">Cant.</th><th class="numeric">Precio</th><th class="numeric">IVA</th><th class="numeric">Total</th></tr></thead>
        <tbody>{#each lines as line}<tr><td><strong>{line.description}</strong></td><td>{line.detail || "—"}</td><td class="numeric">{line.quantity}</td><td class="numeric">{formatEUR(line.unit_price_cents)}</td><td class="numeric">{line.vat_rate}%</td><td class="numeric"><strong>{formatEUR(line.total_cents)}</strong></td></tr>{/each}</tbody>
      </table>
    </div>
    <div class="commercial-totals">
      <span>Base imponible <strong>{formatEUR(baseCents)}</strong></span>
      <span>IVA <strong>{formatEUR(vatCents)}</strong></span>
      {#if irpfCents}<span>Retención <strong>−{formatEUR(irpfCents)}</strong></span>{/if}
      {#if paidCents != null}<span>Cobrado <strong>{formatEUR(paidCents)}</strong></span>{/if}
      {#if pendingCents != null}<span>Pendiente <strong>{formatEUR(pendingCents)}</strong></span>{/if}
      <span class="commercial-total">TOTAL <strong>{formatEUR(totalCents)}</strong></span>
    </div>
  </section>

  {#if notes}
    <section class="commercial-conditions"><strong>CONDICIONES Y NOTAS</strong><p>{notes}</p></section>
  {/if}

  <footer>
    <div><strong>{company?.legal_name || companyName}</strong>{#if company?.nif}<span>NIF: {company.nif}</span>{/if}{#if companyAddress}<span>{companyAddress}</span>{/if}</div>
    <div class="commercial-footer-right">{#if company?.email}<span>{company.email}</span>{/if}{#if company?.phone}<span>{company.phone}</span>{/if}</div>
  </footer>
</article>

<style>
  .commercial-document{--doc-bg:#090610;--doc-panel:#171025;--doc-panel-2:#201333;--doc-border:#38204f;--doc-accent:#9b32ff;--doc-gold:#e7b94e;width:100%;max-width:58rem;margin:auto;overflow:hidden;border:1px solid var(--doc-border);border-radius:.85rem;background:var(--doc-bg);color:#f7f3fb;box-shadow:0 24px 70px rgba(0,0,0,.45);font-family:Inter,Arial,sans-serif}.commercial-cover{padding:2.5rem 3rem 2rem;border-bottom:2px solid var(--doc-accent);background:linear-gradient(145deg,#130b20,#0a0711 65%)}.commercial-brand{display:flex;align-items:flex-start;justify-content:space-between;gap:2rem}.commercial-brand img{width:5.2rem;height:5.2rem;border-radius:1.1rem;object-fit:contain;background:#130d1c;border:1px solid #7044a1;padding:.35rem;box-shadow:0 0 28px rgba(155,50,255,.22)}.commercial-company{font-size:2rem;font-weight:800;letter-spacing:.02em}.commercial-kicker{margin-top:.45rem;color:#b6a4c8;font-size:1rem}.commercial-subject{max-width:42rem;margin-top:1rem;color:#fff;font-size:1.35rem;line-height:1.25}.commercial-meta{display:grid;grid-template-columns:1fr 1fr;gap:2rem;margin-top:2rem;padding-top:1.25rem;border-top:1px solid #2c1b3d}.commercial-meta>div{display:grid;gap:.22rem}.commercial-meta span{color:var(--doc-accent);font-size:.68rem;font-weight:800;letter-spacing:.12em}.commercial-meta strong{font-size:.9rem}.commercial-meta small{color:#a999b9}.commercial-meta-right{text-align:right}.commercial-section{padding:2rem 3rem}.commercial-section+.commercial-section{padding-top:.4rem}.commercial-section h3{display:flex;align-items:center;gap:.75rem;font-size:1.2rem}.commercial-section h3 i{width:.25rem;height:1.75rem;background:var(--doc-accent)}.commercial-section-heading{display:flex;align-items:center;justify-content:space-between;gap:1rem}.commercial-section-heading>span{border:1px solid #553078;border-radius:999px;padding:.35rem .7rem;color:#cda9ef;font-size:.7rem;font-weight:700;text-transform:uppercase}.commercial-introduction{margin-top:1.1rem;color:#c7bbd1;line-height:1.75}.commercial-introduction :global(h2){display:flex;align-items:center;gap:.65rem;margin:1.6rem 0 .65rem;color:#fff;font-size:1.15rem}.commercial-introduction :global(h2)::before{content:"";width:.22rem;height:1.55rem;background:var(--doc-accent)}.commercial-introduction :global(h2.technology-section + ul){display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.55rem;margin:.8rem 0 1.2rem;padding:0;list-style:none}.commercial-introduction :global(h2.technology-section + ul li){margin:0;padding:.7rem .85rem;border:1px solid var(--doc-border);border-radius:.45rem;background:linear-gradient(135deg,var(--doc-panel),#110b19);color:#cdbfd8}.commercial-introduction :global(h2.technology-section + ul li)::before{content:"◆";margin-right:.55rem;color:var(--doc-accent);font-size:.65rem}.commercial-introduction :global(h3){margin:1rem 0 0;padding:1rem 1.1rem .6rem;border:1px solid var(--doc-border);border-bottom:0;border-radius:.5rem .5rem 0 0;background:var(--doc-panel);color:var(--doc-gold);font-size:1rem}.commercial-introduction :global(h3 + p){margin:0 0 .85rem;padding:0 1.1rem 1rem;border:1px solid var(--doc-border);border-top:0;border-radius:0 0 .5rem .5rem;background:var(--doc-panel);color:#bcaec8}.commercial-introduction :global(p){text-align:justify}.commercial-table-wrap{margin-top:1.25rem;overflow-x:auto;border:1px solid var(--doc-border)}table{width:100%;min-width:44rem;border-collapse:collapse;font-size:.76rem}th{padding:.85rem;background:var(--doc-panel-2);color:#f8f3fb;text-align:left;text-transform:uppercase;letter-spacing:.05em}td{padding:.9rem .85rem;border-top:1px solid var(--doc-border);color:#cbbfd5;vertical-align:top}td+td,th+th{border-left:1px solid var(--doc-border)}.numeric{text-align:right;white-space:nowrap}.commercial-totals{display:grid;justify-content:end;min-width:20rem;margin:1rem 0 0 auto}.commercial-totals span{display:flex;justify-content:space-between;gap:3rem;padding:.45rem .8rem;color:#bcaec8}.commercial-totals strong{color:#fff}.commercial-totals .commercial-total{margin-top:.3rem;border:1px solid var(--doc-border);background:var(--doc-panel-2);color:#fff;font-weight:800}.commercial-totals .commercial-total strong{color:var(--doc-gold);font-size:1.05rem}.commercial-conditions{margin:0 3rem 2rem;padding:1.25rem;border:1px solid var(--doc-border);border-radius:.5rem;background:var(--doc-panel)}.commercial-conditions strong{font-size:.72rem;letter-spacing:.07em}.commercial-conditions p{margin-top:.65rem;color:#a99ab6;line-height:1.55;white-space:pre-wrap}.commercial-document>footer{display:flex;justify-content:space-between;gap:2rem;padding:1.2rem 3rem;border-top:1px solid var(--doc-border);color:#88739c;font-size:.66rem}.commercial-document>footer>div{display:grid;gap:.18rem}.commercial-footer-right{text-align:right}@media(max-width:700px){.commercial-cover,.commercial-section{padding:1.5rem}.commercial-conditions{margin:0 1.5rem 1.5rem}.commercial-meta{grid-template-columns:1fr}.commercial-meta-right{text-align:left}.commercial-document>footer{padding:1rem 1.5rem}.commercial-company{font-size:1.5rem}.commercial-brand img{width:4rem;height:4rem}}
  @media print{.commercial-document{max-width:none;border:0;border-radius:0;box-shadow:none;print-color-adjust:exact;-webkit-print-color-adjust:exact}.commercial-cover,.commercial-section{break-inside:avoid}.commercial-table-wrap{overflow:visible}}
  .commercial-introduction :global(.rich-phase-block){box-sizing:border-box;padding-top:1.75rem;break-inside:avoid;page-break-inside:avoid}
  .commercial-introduction :global(.rich-phase-block h3){margin-top:0;break-after:avoid;page-break-after:avoid}
  .commercial-introduction :global(.rich-phase-block h3 + p){break-before:avoid;page-break-before:avoid}
  .commercial-introduction :global(.rich-technology-block){break-inside:avoid;page-break-inside:avoid}
  .commercial-introduction :global(h2){break-after:avoid;page-break-after:avoid}
  .commercial-introduction :global(h2 + p),.commercial-introduction :global(h2 + ul),.commercial-introduction :global(h2 + ol){break-before:avoid;page-break-before:avoid}
</style>
