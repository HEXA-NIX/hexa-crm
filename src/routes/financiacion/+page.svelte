<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api/client";
  import { activeCompany, isAdmin } from "$lib/stores/session";
  import { showToast } from "$lib/stores/ui";
  import { formatEUR, parseEurosInput } from "$lib/money";
  import { normalizeProjectManagement } from "$lib/projects/management";
  import type { CompanyFinancing, CompanyFounder, CompanyInvestmentRound, CompanyInvestor, CompanyLoan, ProjectGrant, Settings, WorkProject } from "$lib/types";
  import Button from "$lib/components/Button.svelte";
  import Select from "$lib/components/Select.svelte";
  import DatePicker from "$lib/components/DatePicker.svelte";
  import MoneyInput from "$lib/components/MoneyInput.svelte";
  import ProjectGrants from "$lib/components/projects/ProjectGrants.svelte";

  let settings = $state<Settings | null>(null);
  let projects = $state<WorkProject[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let investorOpen = $state(false);
  let loanOpen = $state(false);
  let investorEditId = $state<string | null>(null);
  let loanEditId = $state<string | null>(null);
  let selectedGrantProjectUid = $state("");
  let investor = $state(blankInvestor());
  let roundOpen = $state(false);
  let round = $state(blankRound());
  let roundParticipants = $state([{ name:"", amount:"" }]);
  let foundersOpen = $state(false);
  let founderRows = $state([{id:"",name:"",equity:"",notes:""}]);
  let loan = $state(blankLoan());

  const financing = $derived<CompanyFinancing>({...settings?.company_financing, founders:settings?.company_financing?.founders??[], investors:settings?.company_financing?.investors??[], rounds:settings?.company_financing?.rounds??[], loans:settings?.company_financing?.loans??[]});
  const companyId = $derived($activeCompany?.id ?? null);
  const grants = $derived.by(() => projects.flatMap((project) => normalizeProjectManagement(project.management).grants
    .filter((grant) => (grant.beneficiary_company_id ?? project.task_company_id ?? project.company_id) === companyId)
    .map((grant) => ({ grant, project }))));
  const grantProjects = $derived(projects.filter((project) => [project.company_id, project.task_company_id].includes(companyId ?? -1)));
  const selectedGrantProject = $derived(grantProjects.find((project) => project.uid === selectedGrantProjectUid) ?? grantProjects[0] ?? null);
  const grantRecognized = $derived(grants.reduce((sum, item) => sum + recognized(item.grant), 0));
  const investedTotal = $derived(financing.investors.reduce((sum, item) => sum + item.received_cents, 0));
  const investmentCommitted = $derived(financing.investors.reduce((sum, item) => sum + item.committed_cents, 0));
  const totalEquity = $derived([...financing.founders,...financing.investors].reduce((sum, item) => sum + item.equity_percent, 0));
  const loanReceived = $derived(financing.loans.reduce((sum, item) => sum + item.received_cents, 0));
  const loanPrincipal = $derived(financing.loans.reduce((sum, item) => sum + item.principal_cents, 0));
  const loanOutstanding = $derived(financing.loans.reduce((sum, item) => sum + item.outstanding_cents, 0));

  function blankInvestor() { return { name:"", status:"contact" as CompanyInvestor["status"], committed:"", received:"", equity:"", date:"", notes:"" }; }
  function blankRound() { return { name:"", status:"open" as CompanyInvestmentRound["status"], valuationBasis:"pre_money" as CompanyInvestmentRound["valuation_basis"], valuation:"", date:"", notes:"" }; }
  function blankLoan() { return { lender:"", status:"negotiating" as CompanyLoan["status"], principal:"", received:"", outstanding:"", interest:"", start_date:"", maturity_date:"", notes:"" }; }
  const uid = (prefix:string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  const recognized = (grant: ProjectGrant) => ["awarded","received","closed"].includes(grant.status) ? (grant.received_cents || grant.awarded_cents || grant.requested_cents) : 0;
  const moneyInput = (cents:number) => cents ? String(cents / 100).replace(".",",") : "";
  const dateText = (value:string|null) => value ? value.slice(0,10).split("-").reverse().join("-") : "Sin fecha";
  const investorStatus = (status:CompanyInvestor["status"]) => ({contact:"Contacto",negotiating:"Negociando",committed:"Comprometido",invested:"Invertido",exited:"Salida"})[status];
  const loanStatus = (status:CompanyLoan["status"]) => ({negotiating:"Negociando",approved:"Aprobado",active:"Activo",paid:"Pagado",defaulted:"Impagado"})[status];

  onMount(async () => {
    try {
      [settings, projects] = await Promise.all([api.getSettings(), api.supportsWorkManagement() ? api.listWorkProjects() : Promise.resolve([])]);
      selectedGrantProjectUid = projects[0]?.uid ?? "";
      const current = settings?.company_financing ?? { founders: [], investors: [], rounds: [], loans: [] };
      await Promise.all([...current.investors.map(syncInvestorIncome), ...current.loans.map(syncLoanIncome)]);
    }
    catch (error) { showToast(error instanceof Error ? error.message : "No se pudo cargar la financiación", "err"); }
    finally { loading=false; }
  });

  async function persist(next: CompanyFinancing) {
    saving=true;
    try { settings = await api.updateSettings({ company_financing:next }); showToast("Financiación actualizada", "ok"); return true; }
    catch (error) { showToast(error instanceof Error ? error.message : "No se pudo guardar", "err"); return false; }
    finally { saving=false; }
  }
  const syncInvestorIncome = (item: CompanyInvestor) => api.syncCompanyFinancingIncome({ source_type:"investment", source_id:item.id, amount_cents:item.received_cents, description:`Inversión recibida · ${item.name}`, occurred_at:item.investment_date });
  const syncLoanIncome = (item: CompanyLoan) => api.syncCompanyFinancingIncome({ source_type:"loan", source_id:item.id, amount_cents:item.received_cents, description:`Préstamo recibido · ${item.lender}`, occurred_at:item.start_date });
  function editInvestor(item:CompanyInvestor) { investorEditId=item.id; investor={name:item.name,status:item.status,committed:moneyInput(item.committed_cents),received:moneyInput(item.received_cents),equity:String(item.equity_percent||""),date:item.investment_date??"",notes:item.notes}; investorOpen=true; }
  async function saveInvestor() {
    if (!investor.name.trim()) return showToast("Indica el inversor", "err");
    const item:CompanyInvestor={id:investorEditId??uid("investor"),name:investor.name.trim(),status:investor.status,committed_cents:parseEurosInput(investor.committed)??0,received_cents:parseEurosInput(investor.received)??0,equity_percent:Math.max(0,Number(investor.equity.replace(",","."))||0),investment_date:investor.date||null,notes:investor.notes.trim()};
    const next=investorEditId?financing.investors.map((row)=>row.id===investorEditId?item:row):[...financing.investors,item];
    if(await persist({...financing,investors:next})){await syncInvestorIncome(item);investorOpen=false;investorEditId=null;investor=blankInvestor();}
  }
  function editLoan(item:CompanyLoan) { loanEditId=item.id; loan={lender:item.lender,status:item.status,principal:moneyInput(item.principal_cents),received:moneyInput(item.received_cents),outstanding:moneyInput(item.outstanding_cents),interest:String(item.interest_percent||""),start_date:item.start_date??"",maturity_date:item.maturity_date??"",notes:item.notes}; loanOpen=true; }
  async function saveLoan() {
    if(!loan.lender.trim()) return showToast("Indica la entidad o prestamista", "err");
    const principal=parseEurosInput(loan.principal)??0; const received=parseEurosInput(loan.received)??principal;
    const item:CompanyLoan={id:loanEditId??uid("loan"),lender:loan.lender.trim(),status:loan.status,principal_cents:principal,received_cents:received,outstanding_cents:parseEurosInput(loan.outstanding)??principal,interest_percent:Math.max(0,Number(loan.interest.replace(",","."))||0),start_date:loan.start_date||null,maturity_date:loan.maturity_date||null,notes:loan.notes.trim()};
    const next=loanEditId?financing.loans.map((row)=>row.id===loanEditId?item:row):[...financing.loans,item];
    if(await persist({...financing,loans:next})){await syncLoanIncome(item);loanOpen=false;loanEditId=null;loan=blankLoan();}
  }
  async function removeInvestor(item:CompanyInvestor){if(await persist({...financing,investors:financing.investors.filter((row)=>row.id!==item.id)}))await api.syncCompanyFinancingIncome({source_type:"investment",source_id:item.id,amount_cents:0,description:""});}
  async function removeLoan(item:CompanyLoan){if(await persist({...financing,loans:financing.loans.filter((row)=>row.id!==item.id)}))await api.syncCompanyFinancingIncome({source_type:"loan",source_id:item.id,amount_cents:0,description:""});}
  async function saveRound(){
    if(!round.name.trim())return showToast("Indica el nombre de la ronda","err");
    const participants=roundParticipants.map((entry)=>({name:entry.name.trim(),amount_cents:parseEurosInput(entry.amount)??0})).filter((entry)=>entry.name&&entry.amount_cents>0);
    if(!participants.length)return showToast("Añade al menos un inversor y su aportación","err");
    const newMoney=participants.reduce((sum,entry)=>sum+entry.amount_cents,0);
    const valuation=Math.max(0,parseEurosInput(round.valuation)??0);
    if(!valuation)return showToast(`Indica la valoración ${round.valuationBasis==="pre_money"?"pre-money":"post-money"}`,"err");
    const postMoney=round.valuationBasis==="post_money"?valuation:valuation+newMoney;
    const preMoney=round.valuationBasis==="pre_money"?valuation:valuation-newMoney;
    if(preMoney<=0)return showToast("La valoración post-money debe ser superior al capital nuevo de la ronda","err");
    const roundId=uid("round");
    const dilution=preMoney/postMoney;
    const dilutedFounders=financing.founders.map((item)=>({...item,equity_percent:item.equity_percent*dilution}));
    const diluted=financing.investors.map((item)=>({...item,equity_percent:item.equity_percent*dilution}));
    const additions:CompanyInvestor[]=participants.map((entry)=>({id:uid("investor"),round_id:roundId,name:entry.name,status:round.status==="closed"?"invested":"committed",committed_cents:entry.amount_cents,received_cents:round.status==="closed"?entry.amount_cents:0,equity_percent:(entry.amount_cents/postMoney)*100,investment_date:round.date||null,notes:round.notes.trim()}));
    const roundItem:CompanyInvestmentRound={id:roundId,name:round.name.trim(),status:round.status,valuation_basis:round.valuationBasis,pre_money_cents:preMoney,new_money_cents:newMoney,post_money_cents:postMoney,investment_date:round.date||null,notes:round.notes.trim()};
    if(await persist({...financing,founders:dilutedFounders,rounds:[...financing.rounds,roundItem],investors:[...diluted,...additions]})){
      await Promise.all(additions.map(syncInvestorIncome));roundOpen=false;round=blankRound();roundParticipants=[{name:"",amount:""}];
    }
  }
  function openFounders(){founderRows=financing.founders.length?financing.founders.map((item)=>({id:item.id,name:item.name,equity:String(item.equity_percent).replace(".",","),notes:item.notes})):[{id:"",name:"",equity:"",notes:""}];foundersOpen=true;}
  async function saveFounders(){
    const founders:CompanyFounder[]=founderRows.map((row)=>({id:row.id||uid("founder"),name:row.name.trim(),equity_percent:Math.max(0,Number(row.equity.replace(",","."))||0),notes:row.notes.trim()})).filter((row)=>row.name&&row.equity_percent>0);
    const total=founders.reduce((sum,row)=>sum+row.equity_percent,0);
    if(!founders.length)return showToast("Añade al menos un socio fundador","err");
    if(financing.rounds.length===0&&Math.abs(total-100)>.01)return showToast("El reparto inicial debe sumar exactamente 100 %","err");
    if(financing.rounds.length>0&&total>100.01)return showToast("La participación de los socios no puede superar el 100 %","err");
    if(await persist({...financing,founders})){foundersOpen=false;}
  }
</script>

{#if loading}<p class="text-sm text-[var(--color-muted)]">Cargando financiación…</p>{:else}
<div class="space-y-6">
  <section class="financing-kpis">
    <div class="glass rounded-2xl p-4"><span class="section-label">SUBVENCIONES RECONOCIDAS</span><strong class="mt-3 block text-2xl text-amber-200">{formatEUR(grantRecognized)}</strong></div>
    <div class="glass rounded-2xl p-4"><span class="section-label">INVERSIÓN RECIBIDA</span><strong class="mt-3 block text-2xl text-purple-200">{formatEUR(investedTotal)}</strong></div>
    <div class="glass rounded-2xl p-4"><span class="section-label">PRÉSTAMOS RECIBIDOS</span><strong class="mt-3 block text-2xl text-cyan-200">{formatEUR(loanReceived)}</strong></div>
    <div class="glass rounded-2xl p-4"><span class="section-label">DEUDA PENDIENTE</span><strong class="mt-3 block text-2xl text-rose-200">{formatEUR(loanOutstanding)}</strong></div>
  </section>

  <section class="glass rounded-2xl p-5"><div class="flex flex-wrap items-end justify-between gap-3"><div><span class="section-label">SUBVENCIONES DE LA EMPRESA</span><p class="mt-1 text-sm text-[var(--color-muted)]">Alta y seguimiento completo, vinculado al proyecto correspondiente.</p></div>{#if grantProjects.length > 1}<div class="w-full max-w-sm"><Select label="Proyecto" options={grantProjects.map((project)=>({value:project.uid,label:project.name}))} bind:value={selectedGrantProjectUid}/></div>{/if}</div>{#if selectedGrantProject}<ProjectGrants project={selectedGrantProject} onsaved={(saved)=>{projects=projects.map((project)=>project.id===saved.id?saved:project);}} />{:else}<p class="mt-4 rounded-xl border border-dashed border-white/10 p-4 text-sm text-[var(--color-muted)]">Crea un proyecto para poder vincular una subvención.</p>{/if}</section>

  <section class="glass rounded-2xl p-5">
    <div class="flex flex-wrap justify-between gap-3"><div><span class="section-label">RONDAS E INVERSORES · CAP TABLE</span><p class="mt-1 text-sm text-[var(--color-muted)]">Socios fundadores, valoración, capital nuevo, participantes y dilución acumulada.</p></div>{#if $isAdmin}<div class="flex gap-2"><Button variant="ghost" onclick={openFounders}>{financing.founders.length?"Editar socios":"Configurar socios fundadores"}</Button><Button variant="secondary" onclick={()=>{roundOpen=!roundOpen;round=blankRound();roundParticipants=[{name:"",amount:""}];}}>+ Añadir ronda</Button></div>{/if}</div>
    <div class="summary-strip"><div><small>COMPROMETIDO</small><strong>{formatEUR(investmentCommitted)}</strong></div><div><small>RECIBIDO</small><strong class="text-purple-200">{formatEUR(investedTotal)}</strong></div><div><small>CAP TABLE REGISTRADO</small><strong>{totalEquity.toLocaleString("es-ES",{maximumFractionDigits:2})}%</strong></div><div><small>SOCIOS / INVERSORES</small><strong>{financing.founders.length + financing.investors.length}</strong></div></div>
    {#if foundersOpen}<div class="founders-form"><div class="md:col-span-3"><strong>Reparto inicial de socios</strong><p>Antes de la primera ronda debe sumar exactamente el 100 %. Las rondas posteriores diluirán este reparto.</p></div>{#each founderRows as founder,index}<input class="field" bind:value={founder.name} placeholder="Nombre del socio"/><input class="field" bind:value={founder.equity} inputmode="decimal" placeholder="Participación (%)"/><div class="flex gap-2"><input class="field" bind:value={founder.notes} placeholder="Rol o notas"/>{#if founderRows.length>1}<Button variant="ghost" onclick={()=>founderRows=founderRows.filter((_,i)=>i!==index)}>Quitar</Button>{/if}</div>{/each}<div class="md:col-span-3 flex justify-between"><Button variant="ghost" onclick={()=>founderRows=[...founderRows,{id:"",name:"",equity:"",notes:""}]}>+ Añadir socio</Button><Button disabled={saving} onclick={saveFounders}>Guardar reparto</Button></div></div>{/if}
    {#if roundOpen}<div class="round-form"><input class="field" bind:value={round.name} placeholder="Nombre de la ronda (Seed, Serie A…)"/><Select bind:value={round.status} options={[{value:"planned",label:"Planificada"},{value:"open",label:"Abierta"},{value:"closed",label:"Cerrada y desembolsada"}]}/><Select label="Tipo de valoración" bind:value={round.valuationBasis} options={[{value:"pre_money",label:"Pre-money"},{value:"post_money",label:"Post-money"}]}/><MoneyInput bind:value={round.valuation} placeholder={`Valoración ${round.valuationBasis==="pre_money"?"pre-money":"post-money"} (€)`}/><label class="grid gap-1 text-xs text-[var(--color-muted)] md:col-span-2">Fecha de cierre<DatePicker bind:value={round.date}/></label><div class="md:col-span-2"><p class="mb-2 text-xs font-semibold text-[var(--color-muted)]">PARTICIPANTES DE LA RONDA</p>{#each roundParticipants as participant,index}<div class="participant-row"><input class="field" bind:value={participant.name} placeholder="Inversor"/><MoneyInput bind:value={participant.amount} placeholder="Aportación (€)"/>{#if roundParticipants.length>1}<Button variant="ghost" onclick={()=>roundParticipants=roundParticipants.filter((_,i)=>i!==index)}>Quitar</Button>{/if}</div>{/each}<Button variant="ghost" onclick={()=>roundParticipants=[...roundParticipants,{name:"",amount:""}]}>+ Añadir participante</Button></div><textarea class="field min-h-20 md:col-span-2" bind:value={round.notes} placeholder="Condiciones de la ronda"></textarea><div class="flex justify-end md:col-span-2"><Button disabled={saving} onclick={saveRound}>Guardar ronda</Button></div></div>{/if}
    {#if financing.rounds.length}<div class="round-list">{#each financing.rounds as item}<article><div><strong>{item.name}</strong><p>{item.status==="closed"?"Cerrada":item.status==="open"?"Abierta":"Planificada"} · {dateText(item.investment_date)}</p></div><span>Pre-money <strong>{formatEUR(item.pre_money_cents)}</strong></span><span>Capital nuevo <strong>{formatEUR(item.new_money_cents)}</strong></span><span>Post-money <strong>{formatEUR(item.post_money_cents)}</strong></span></article>{/each}</div>{/if}
    {#if investorOpen}<div class="mt-4 grid gap-3 rounded-xl border border-white/[0.08] p-4 md:grid-cols-2"><input class="field md:col-span-2" bind:value={investor.name} placeholder="Nombre del inversor"/><Select bind:value={investor.status} options={[{value:"contact",label:"Contacto"},{value:"negotiating",label:"Negociando"},{value:"committed",label:"Comprometido"},{value:"invested",label:"Invertido"},{value:"exited",label:"Salida"}]}/><input class="field" bind:value={investor.equity} inputmode="decimal" placeholder="Participación (%)"/><MoneyInput bind:value={investor.committed} placeholder="Importe comprometido (€)"/><MoneyInput bind:value={investor.received} placeholder="Importe recibido (€)"/><label class="grid gap-1 text-xs text-[var(--color-muted)]">Fecha de inversión<DatePicker bind:value={investor.date}/></label><textarea class="field min-h-20 md:col-span-2" bind:value={investor.notes} placeholder="Notas y condiciones"></textarea><div class="flex justify-end md:col-span-2"><Button disabled={saving} onclick={saveInvestor}>Guardar inversor</Button></div></div>{/if}
    <div class="finance-list">{#each financing.founders as item (item.id)}<article class="finance-row founder-row"><div><strong>{item.name}</strong><p>Socio fundador{item.notes?` · ${item.notes}`:""}</p></div><div><small>ORIGEN</small><strong>Reparto inicial</strong></div><div><small>APORTACIÓN</small><strong>—</strong></div><div><small>PARTICIPACIÓN ACTUAL</small><strong>{item.equity_percent.toLocaleString("es-ES",{maximumFractionDigits:2})}%</strong></div><div></div></article>{/each}{#each financing.investors as item (item.id)}<article class="finance-row"><div><strong>{item.name}</strong><p>{investorStatus(item.status)} · {dateText(item.investment_date)}</p></div><div><small>COMPROMETIDO</small><strong>{formatEUR(item.committed_cents)}</strong></div><div><small>RECIBIDO</small><strong class="text-purple-200">{formatEUR(item.received_cents)}</strong></div><div><small>PARTICIPACIÓN ACTUAL</small><strong>{item.equity_percent.toLocaleString("es-ES",{maximumFractionDigits:2})}%</strong></div>{#if $isAdmin}<div class="finance-actions"><Button variant="ghost" onclick={()=>editInvestor(item)}>Editar</Button><Button variant="ghost" onclick={()=>removeInvestor(item)}>Eliminar</Button></div>{/if}</article>{/each}</div>
  </section>

  <section class="glass rounded-2xl p-5">
    <div class="flex flex-wrap justify-between gap-3"><div><span class="section-label">PRÉSTAMOS</span><p class="mt-1 text-sm text-[var(--color-muted)]">Financiación ajena, coste, deuda y vencimientos.</p></div>{#if $isAdmin}<Button variant="secondary" onclick={()=>{loanOpen=!loanOpen;loanEditId=null;loan=blankLoan();}}>+ Añadir préstamo</Button>{/if}</div>
    <div class="summary-strip"><div><small>PRINCIPAL</small><strong>{formatEUR(loanPrincipal)}</strong></div><div><small>RECIBIDO</small><strong class="text-cyan-200">{formatEUR(loanReceived)}</strong></div><div><small>DEUDA PENDIENTE</small><strong class="text-rose-200">{formatEUR(loanOutstanding)}</strong></div><div><small>PRÉSTAMOS</small><strong>{financing.loans.length}</strong></div></div>
    {#if loanOpen}<div class="mt-4 grid gap-3 rounded-xl border border-white/[0.08] p-4 md:grid-cols-2"><input class="field md:col-span-2" bind:value={loan.lender} placeholder="Entidad o prestamista"/><Select bind:value={loan.status} options={[{value:"negotiating",label:"Negociando"},{value:"approved",label:"Aprobado"},{value:"active",label:"Activo"},{value:"paid",label:"Pagado"},{value:"defaulted",label:"Impagado"}]}/><input class="field" bind:value={loan.interest} inputmode="decimal" placeholder="Interés (%)"/><MoneyInput bind:value={loan.principal} placeholder="Principal (€)"/><MoneyInput bind:value={loan.received} placeholder="Importe recibido (€)"/><MoneyInput bind:value={loan.outstanding} placeholder="Capital pendiente (€)"/><label class="grid gap-1 text-xs text-[var(--color-muted)]">Inicio<DatePicker bind:value={loan.start_date}/></label><label class="grid gap-1 text-xs text-[var(--color-muted)]">Vencimiento<DatePicker bind:value={loan.maturity_date} min={loan.start_date||undefined}/></label><textarea class="field min-h-20 md:col-span-2" bind:value={loan.notes} placeholder="Garantías, cuotas y condiciones"></textarea><div class="flex justify-end md:col-span-2"><Button disabled={saving} onclick={saveLoan}>Guardar préstamo</Button></div></div>{/if}
    <div class="finance-list">{#each financing.loans as item (item.id)}<article class="finance-row"><div><strong>{item.lender}</strong><p>{loanStatus(item.status)} · vence {dateText(item.maturity_date)}</p></div><div><small>PRINCIPAL / RECIBIDO</small><strong>{formatEUR(item.principal_cents)} / {formatEUR(item.received_cents)}</strong></div><div><small>PENDIENTE</small><strong class="text-rose-200">{formatEUR(item.outstanding_cents)}</strong></div><div><small>INTERÉS</small><strong>{item.interest_percent}%</strong></div>{#if $isAdmin}<div class="finance-actions"><Button variant="ghost" onclick={()=>editLoan(item)}>Editar</Button><Button variant="ghost" onclick={()=>removeLoan(item)}>Eliminar</Button></div>{/if}</article>{/each}</div>
  </section>
</div>{/if}

<style>
  .financing-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem}
  .summary-strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin-top:1.25rem}.summary-strip>div{display:grid;gap:.3rem;padding:1rem;border-radius:.75rem;background:rgba(0,0,0,.18)}.summary-strip small,.finance-row small{font-size:.67rem;color:var(--color-muted-dim);letter-spacing:.06em}.summary-strip strong{font-size:1.15rem}.finance-list{display:grid;gap:.75rem;margin-top:1rem}.finance-row{display:grid;grid-template-columns:minmax(14rem,1.5fr) repeat(3,minmax(8rem,1fr)) auto;align-items:center;gap:1rem;padding:1rem;border:1px solid var(--color-border);border-radius:.8rem}.finance-row>div{display:grid;gap:.25rem}.finance-row p{font-size:.75rem;color:var(--color-muted)}.finance-row strong{font-size:.9rem}.finance-actions{display:flex!important;flex-direction:row;justify-content:flex-end}
  .round-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem;margin-top:1rem;padding:1rem;border:1px solid rgba(168,85,247,.25);border-radius:.8rem;background:rgba(88,28,135,.06)}.participant-row{display:grid;grid-template-columns:1fr 1fr auto;gap:.75rem;margin-bottom:.6rem}.round-list{display:grid;gap:.6rem;margin-top:1rem}.round-list article{display:grid;grid-template-columns:1.5fr repeat(3,1fr);align-items:center;gap:1rem;padding:.85rem 1rem;border-radius:.7rem;background:rgba(88,28,135,.09);border:1px solid rgba(168,85,247,.18)}.round-list p,.round-list span{font-size:.75rem;color:var(--color-muted)}.round-list span strong{display:block;margin-top:.2rem;color:var(--color-text)}
  .founders-form{display:grid;grid-template-columns:1.1fr .55fr 1.35fr;gap:.75rem;margin-top:1rem;padding:1rem;border:1px solid rgba(34,211,238,.2);border-radius:.8rem;background:rgba(8,145,178,.05)}.founders-form p{margin-top:.25rem;font-size:.75rem;color:var(--color-muted)}.founder-row{border-color:rgba(34,211,238,.16);background:rgba(8,145,178,.035)}
  @media(max-width:1050px){.finance-row{grid-template-columns:repeat(2,minmax(0,1fr))}.finance-actions{justify-content:flex-start}.summary-strip{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:1100px){.financing-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:620px){.financing-kpis{grid-template-columns:1fr}}
</style>
