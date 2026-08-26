<script lang="ts">
  import type { Company } from "$lib/types";
  import { formatEUR } from "$lib/money";
  import { formatDateES } from "$lib/date";
  import RichDescription from "$lib/components/RichDescription.svelte";

  export type CommercialLine = {
    description: string;
    detail?: string;
    quantity: number;
    unit_price_cents: number;
    vat_rate: number;
    total_cents: number;
    base_cents?: number;
    discount_cents?: number;
    global_discount_cents?: number;
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
    globalDiscountType = "percent",
    globalDiscountValue = 0,
    globalDiscountCents = 0,
    paidCents,
    notes = "",
    status = "",
    technologyGroups = [],
    technologyLogos = {},
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
    globalDiscountType?: "percent" | "amount";
    globalDiscountValue?: number;
    globalDiscountCents?: number;
    paidCents?: number;
    notes?: string;
    status?: string;
    technologyGroups?: { label: string; items: string[] }[];
    technologyLogos?: Record<string, string>;
  } = $props();

  const companyName = $derived(company?.trade_name || company?.legal_name || "Empresa");
  const companyAddress = $derived([company?.address, [company?.postal_code, company?.city].filter(Boolean).join(" "), company?.province].filter(Boolean).join(" · "));
  const pendingCents = $derived(paidCents == null ? null : Math.max(0, totalCents - paidCents));
  const originalBaseCents = $derived(lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unit_price_cents), 0));
  const lineDiscountCents = $derived(lines.reduce((sum, line) => sum + Math.max(0, line.discount_cents ?? 0), 0));
  const afterLineDiscountCents = $derived(Math.max(0, originalBaseCents - lineDiscountCents));
  const hasDiscount = $derived(originalBaseCents > baseCents);
  const displayDate = formatDateES;
</script>

<article class="commercial-document">
  <header class="commercial-cover">
    <div class="commercial-brand">
      <div>
        <p class="commercial-company">{companyName}</p>
        <p class="commercial-kicker">{documentType}</p>
        {#if subject}<h1 class="commercial-subject">{subject}</h1>{/if}
      </div>
      <span class="commercial-logo-frame"><img src={company?.logo_data_url || "/logo-mark.svg"} alt="Logo de {companyName}" /></span>
    </div>
    <div class="commercial-meta">
      <div class="commercial-meta-identification">
        <div class="commercial-meta-line"><span>CLIENTE</span><strong>{customerName || "Sin cliente"}</strong></div>
        <div class="commercial-meta-line"><span>DOCUMENTO</span><strong>{number}</strong></div>
        {#if customerNif || customerEmail}<small>{[customerNif && `NIF: ${customerNif}`, customerEmail].filter(Boolean).join(" · ")}</small>{/if}
      </div>
      <div class="commercial-meta-right"><small>Emisión: <strong>{displayDate(operationDate)}</strong></small>{#if dueDate}<small>Vencimiento: <strong>{displayDate(dueDate)}</strong></small>{/if}</div>
    </div>
  </header>

  {#if introduction}
    <section class="commercial-section">
      <h3><i></i>Proyecto y alcance</h3>
      <div class="commercial-introduction"><RichDescription value={introduction} /></div>
    </section>
  {/if}

  {#if technologyGroups.some((group) => group.items.length)}
    <section class="commercial-section commercial-technologies">
      <h3><i></i>Tecnologías utilizadas y previstas</h3>
      <div class="commercial-technology-groups">{#each technologyGroups.filter((group) => group.items.length) as group}<div><strong>{group.label}</strong><div class="commercial-technology-list">{#each group.items as technology}<span class="commercial-technology"><b>{#if technologyLogos[technology]}<img src={technologyLogos[technology]} alt="" />{:else}{technology.slice(0, 1).toUpperCase()}{/if}</b><span>{technology}</span></span>{/each}</div></div>{/each}</div>
    </section>
  {/if}

  <section class="commercial-section commercial-economics">
    <div class="commercial-section-heading"><h3><i></i>Propuesta económica</h3></div>
    <div class="commercial-table-wrap">
      <table>
        <thead><tr><th>Línea de servicio /<br />módulo técnico</th><th>Alcance del entregable</th><th class="numeric">{hasDiscount ? "Antes / ahora" : "Inversión neta"}</th></tr></thead>
        <tbody>{#each lines as line}{@const originalLineCents = Math.round(line.quantity * line.unit_price_cents)}{@const lineSavingCents = Math.max(0, line.discount_cents ?? 0)}{@const afterLineCents = Math.max(0, originalLineCents - lineSavingCents)}<tr><td><span class="commercial-cell-content"><strong>{line.description}</strong></span></td><td><span class="commercial-cell-content">{line.detail || "—"}{#if lineSavingCents > 0}<small class="commercial-line-discount">Descuento de línea: −{formatEUR(lineSavingCents)}</small>{/if}</span></td><td class="numeric"><span class="commercial-cell-content commercial-price-comparison">{#if lineSavingCents > 0}<small class="commercial-original-price">{formatEUR(originalLineCents)}</small>{/if}<strong>{formatEUR(afterLineCents)}</strong></span></td></tr>{/each}</tbody>
        <tfoot>{#if hasDiscount}<tr class="commercial-original-total"><td colspan="2"><span class="commercial-cell-content">VALOR DEL PRESUPUESTO SIN DESCUENTO</span></td><td class="numeric"><span class="commercial-cell-content">{formatEUR(originalBaseCents)}</span></td></tr>{#if lineDiscountCents > 0}<tr class="commercial-global-discount"><td colspan="2"><span class="commercial-cell-content">DESCUENTOS POR LÍNEA</span></td><td class="numeric"><span class="commercial-cell-content">−{formatEUR(lineDiscountCents)}</span></td></tr><tr class="commercial-original-total"><td colspan="2"><span class="commercial-cell-content">SUBTOTAL TRAS DESCUENTOS DE LÍNEA</span></td><td class="numeric"><span class="commercial-cell-content">{formatEUR(afterLineDiscountCents)}</span></td></tr>{/if}{#if globalDiscountCents > 0}<tr class="commercial-global-discount"><td colspan="2"><span class="commercial-cell-content">DESCUENTO GENERAL{globalDiscountType === "percent" ? ` · ${globalDiscountValue}%` : ""}</span></td><td class="numeric"><span class="commercial-cell-content">−{formatEUR(globalDiscountCents)}</span></td></tr>{/if}{/if}<tr><td colspan="2"><span class="commercial-cell-content">{hasDiscount ? "TOTAL INVERSIÓN CON DESCUENTO" : "TOTAL INVERSIÓN INICIAL DE LANZAMIENTO"}</span></td><td class="numeric"><span class="commercial-cell-content">{formatEUR(baseCents)}</span></td></tr></tfoot>
      </table>
    </div>
    <div class="commercial-totals">
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
  .commercial-document{--doc-bg:#090610;--doc-panel:#171025;--doc-panel-2:#201333;--doc-border:#38204f;--doc-accent:#9b32ff;--doc-gold:#e7b94e;width:100%;max-width:58rem;margin:auto;overflow:hidden;border:1px solid var(--doc-border);border-radius:.85rem;background:var(--doc-bg);color:#f7f3fb;box-shadow:0 24px 70px rgba(0,0,0,.45);font-family:Inter,Arial,sans-serif}.commercial-cover{padding:2.5rem 3rem 2rem;border-bottom:2px solid var(--doc-accent);background:linear-gradient(145deg,#130b20,#0a0711 65%)}.commercial-brand{display:flex;align-items:flex-start;justify-content:space-between;gap:2rem}.commercial-brand img{width:5.2rem;height:5.2rem;border-radius:1.1rem;object-fit:cover;background:#130d1c;border:1px solid #7044a1;padding:0;box-shadow:0 0 28px rgba(155,50,255,.22)}.commercial-company{font-size:2rem;font-weight:800;letter-spacing:.02em}.commercial-kicker{margin-top:.45rem;color:#b6a4c8;font-size:1rem}.commercial-subject{max-width:42rem;margin-top:1rem;color:#fff;font-size:1.35rem;line-height:1.25}.commercial-meta{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:2rem;margin-top:2rem;padding-top:1.25rem;border-top:1px solid #2c1b3d}.commercial-meta>div{display:grid;gap:.38rem}.commercial-meta-line{display:flex;align-items:baseline;gap:.65rem;min-width:0}.commercial-meta span{flex:0 0 5.8rem;color:var(--doc-accent);font-size:.68rem;font-weight:800;letter-spacing:.12em}.commercial-meta strong{font-size:.9rem}.commercial-meta-line strong{overflow-wrap:anywhere}.commercial-meta small{color:#a999b9}.commercial-meta-right{text-align:right}.commercial-meta-right small{white-space:nowrap}.commercial-meta-right small strong{margin-left:.25rem;color:#f7f3fb}.commercial-section{padding:2rem 3rem}.commercial-section+.commercial-section{padding-top:.4rem}.commercial-section h3{display:flex;align-items:center;gap:.75rem;font-size:1.2rem}.commercial-section h3 i{width:.25rem;height:1.75rem;background:var(--doc-accent)}.commercial-section-heading{display:flex;align-items:center;justify-content:space-between;gap:1rem}.commercial-section-heading>span{border:1px solid #553078;border-radius:999px;padding:.35rem .7rem;color:#cda9ef;font-size:.7rem;font-weight:700;text-transform:uppercase}.commercial-introduction{margin-top:1.1rem;color:#c7bbd1;line-height:1.75}.commercial-introduction :global(h2){display:flex;align-items:center;gap:.65rem;margin:1.6rem 0 .65rem;color:#fff;font-size:1.15rem}.commercial-introduction :global(h2)::before{content:"";width:.22rem;height:1.55rem;background:var(--doc-accent)}.commercial-introduction :global(h2.technology-section + ul){display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.55rem;margin:.8rem 0 1.2rem;padding:0;list-style:none}.commercial-introduction :global(h2.technology-section + ul li){margin:0;padding:.7rem .85rem;border:1px solid var(--doc-border);border-radius:.45rem;background:linear-gradient(135deg,var(--doc-panel),#110b19);color:#cdbfd8}.commercial-introduction :global(h2.technology-section + ul li)::before{content:"◆";margin-right:.55rem;color:var(--doc-accent);font-size:.65rem}.commercial-introduction :global(h3){margin:1rem 0 0;padding:1rem 1.1rem .6rem;border:1px solid var(--doc-border);border-bottom:0;border-radius:.5rem .5rem 0 0;background:var(--doc-panel);color:var(--doc-gold);font-size:1rem}.commercial-introduction :global(h3 + p){margin:0 0 .85rem;padding:0 1.1rem 1rem;border:1px solid var(--doc-border);border-top:0;border-radius:0 0 .5rem .5rem;background:var(--doc-panel);color:#bcaec8}.commercial-introduction :global(p){text-align:justify}.commercial-table-wrap{margin-top:1.25rem;overflow-x:auto;border:1px solid var(--doc-border)}table{width:100%;min-width:44rem;border-collapse:collapse;font-size:.76rem}th{padding:.85rem;background:var(--doc-panel-2);color:#f8f3fb;text-align:left;text-transform:uppercase;letter-spacing:.05em}td{padding:.9rem .85rem;border-top:1px solid var(--doc-border);color:#cbbfd5;vertical-align:top}td+td,th+th{border-left:1px solid var(--doc-border)}.numeric{text-align:right;white-space:nowrap}.commercial-totals{display:grid;justify-content:end;min-width:20rem;margin:1rem 0 0 auto}.commercial-totals span{display:flex;justify-content:space-between;gap:3rem;padding:.45rem .8rem;color:#bcaec8}.commercial-totals strong{color:#fff}.commercial-totals .commercial-total{margin-top:.3rem;border:1px solid var(--doc-border);background:var(--doc-panel-2);color:#fff;font-weight:800}.commercial-totals .commercial-total strong{color:var(--doc-gold);font-size:1.05rem}.commercial-conditions{margin:0 3rem 2rem;padding:1.25rem;border:1px solid var(--doc-border);border-radius:.5rem;background:var(--doc-panel)}.commercial-conditions strong{font-size:.72rem;letter-spacing:.07em}.commercial-conditions p{margin-top:.65rem;color:#a99ab6;line-height:1.55;white-space:pre-wrap}.commercial-document>footer{display:flex;justify-content:space-between;gap:2rem;padding:1.2rem 3rem;border-top:1px solid var(--doc-border);color:#88739c;font-size:.66rem}.commercial-document>footer>div{display:grid;gap:.18rem}.commercial-footer-right{text-align:right}@media(max-width:700px){.commercial-cover,.commercial-section{padding:1.5rem}.commercial-conditions{margin:0 1.5rem 1.5rem}.commercial-meta{grid-template-columns:1fr}.commercial-meta-right{text-align:left}.commercial-meta-right small{white-space:normal}.commercial-document>footer{padding:1rem 1.5rem}.commercial-company{font-size:1.5rem}.commercial-brand img{width:4rem;height:4rem}}
  .commercial-table-wrap table{table-layout:fixed;min-width:0}
  .commercial-table-wrap{break-inside:avoid;page-break-inside:avoid}
  .commercial-technologies{break-inside:avoid;page-break-inside:avoid}
  .commercial-technology-groups{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem 1.25rem;margin-top:1.1rem}
  .commercial-technology-groups>div{padding:0;border:0;background:none}
  .commercial-technology-groups>div>strong{display:block;margin:0 0 .45rem;color:#cda9ef;font-size:.65rem;text-transform:uppercase;letter-spacing:.08em}
  .commercial-technology-list{display:flex;flex-wrap:wrap;gap:.4rem}
  .commercial-technology{display:inline-flex;align-items:center;gap:.4rem;padding:.3rem .5rem;border:1px solid #47305d;border-radius:.4rem;background:rgba(255,255,255,.04);color:#eee7f4;font-size:.7rem}
  .commercial-technology b{display:flex;width:1.15rem;height:1.15rem;align-items:center;justify-content:center;border-radius:.25rem;background:#352046;color:#c994ff;font-size:.58rem;line-height:1}
  .commercial-technology b img{display:block;width:.9rem;height:.9rem;margin:0;object-fit:contain}
  .commercial-technology>span{display:block;height:1.15rem;line-height:1.15rem;transform:translateY(-.38rem)}
  .commercial-table-wrap th:first-child,.commercial-table-wrap td:first-child{width:25%}
  .commercial-table-wrap th:nth-child(2),.commercial-table-wrap td:nth-child(2){width:52%}
  .commercial-table-wrap th:last-child,.commercial-table-wrap td:last-child{width:23%}
  .commercial-table-wrap th{padding:.68rem .8rem;border-bottom:2px solid var(--doc-accent);font-size:.7rem;line-height:1.25}
  .commercial-table-wrap td{padding:.72rem .8rem;font-size:.78rem;line-height:1.35;vertical-align:middle}
  .commercial-cell-content{display:block;transform:translateY(-.3rem)}
  .commercial-line-discount{display:block;margin-top:.18rem;color:var(--doc-gold);font-size:.68rem}
  .commercial-price-comparison{display:grid;justify-items:end;gap:.12rem}
  .commercial-original-price{color:#998ba4;font-size:.68rem;text-decoration:line-through;text-decoration-thickness:1px}
  .commercial-table-wrap tbody td:first-child strong{font-size:.82rem;line-height:1.3}
  .commercial-table-wrap tfoot td{padding:.78rem .8rem;border-top:1px solid var(--doc-border);background:var(--doc-panel-2);color:#fff;font-size:.78rem;font-weight:800}
  .commercial-table-wrap tfoot td:last-child{color:var(--doc-gold);font-size:.92rem}
  .commercial-table-wrap tfoot .commercial-global-discount td{background:#130d1c;color:#cdbfd8;font-size:.74rem}
  .commercial-table-wrap tfoot .commercial-global-discount td:last-child{color:var(--doc-gold);font-size:.8rem}
  .commercial-table-wrap tfoot .commercial-original-total td{background:#100b16;color:#a99ab6;font-size:.72rem}
  .commercial-table-wrap tfoot .commercial-original-total td:last-child{color:#cbbfd5;font-size:.78rem;text-decoration:line-through}
  @media print{.commercial-document{max-width:none;border:0;border-radius:0;box-shadow:none;print-color-adjust:exact;-webkit-print-color-adjust:exact}.commercial-cover,.commercial-section{break-inside:avoid}.commercial-table-wrap{overflow:visible}}
  @media(max-width:700px){.commercial-technology-groups{grid-template-columns:1fr}}
  .commercial-introduction :global(.rich-phase-block){box-sizing:border-box;padding-top:1.75rem;break-inside:avoid;page-break-inside:avoid}
  .commercial-introduction :global(.rich-phase-block h3){margin-top:0;break-after:avoid;page-break-after:avoid}
  .commercial-introduction :global(.rich-phase-block h3 + p){break-before:avoid;page-break-before:avoid}
  .commercial-introduction :global(.rich-technology-block){break-inside:avoid;page-break-inside:avoid}
  .commercial-introduction :global(.rich-section-lead){break-inside:avoid;page-break-inside:avoid}
  .commercial-introduction :global(h2){break-after:avoid;page-break-after:avoid}
  .commercial-introduction :global(h2 + p),.commercial-introduction :global(h2 + ul),.commercial-introduction :global(h2 + ol){break-before:avoid;page-break-before:avoid}
  .commercial-introduction :global(h2){display:flex;align-items:center;gap:.8rem;margin:1.9rem 0 1rem;color:#f7f3fb;font-size:1.42rem;font-weight:800;line-height:1.25;letter-spacing:0}
  .commercial-introduction :global(h2)::before{content:"";display:block;flex:0 0 .28rem;width:.28rem;height:2.15rem;border-radius:0;background:var(--doc-accent)}
  .commercial-introduction :global(h3){display:block;margin:1.15rem 0 .45rem;padding:0;border:0;border-radius:0;background:none;color:var(--doc-gold);font-size:1.08rem;font-weight:800;line-height:1.3;letter-spacing:0}
  .commercial-introduction :global(h3 + p){margin:0 0 .7rem;padding:0;border:0;border-radius:0;background:none;color:#c7bbd1}
  .commercial-introduction :global(p){margin:.45rem 0 .72rem;color:#c7bbd1;font-size:.9rem;line-height:1.72;text-align:justify}
  .commercial-introduction :global(ul),.commercial-introduction :global(ol){margin:.42rem 0 .8rem;padding-left:1.35rem;color:#c7bbd1;font-size:.9rem;line-height:1.72}
  .commercial-introduction :global(li){margin:.28rem 0}
  .commercial-introduction :global(br){display:none}
  .commercial-introduction :global(ul),.commercial-introduction :global(ol){break-inside:avoid;page-break-inside:avoid}
  .commercial-economics{break-inside:avoid;page-break-inside:avoid}
  .commercial-logo-frame{display:flex;flex:0 0 auto;width:5.2rem;height:5.2rem;padding:.28rem;border:2px solid #7044a1;border-radius:1.1rem;background:#130d1c;box-shadow:0 0 28px rgba(155,50,255,.22);overflow:hidden}
  .commercial-logo-frame img{width:100%;height:100%;padding:0;border:0;border-radius:.78rem;object-fit:cover;box-shadow:none}
  @media(max-width:700px){.commercial-logo-frame{width:4rem;height:4rem}}
</style>
