<script lang="ts">
  let {
    start = $bindable(""),
    end = $bindable(""),
    label = "Intervalo",
    durationWeeks = $bindable<1 | 2 | 3 | 4 | null>(null),
    showDurations = false,
    required = false,
  }: {
    start?: string | null;
    end?: string | null;
    label?: string;
    durationWeeks?: 1 | 2 | 3 | 4 | null;
    showDurations?: boolean;
    required?: boolean;
  } = $props();

  let open = $state(false);
  let cursor = $state(new Date());

  function iso(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  function display(value: string) {
    return value ? value.slice(0, 10).split("-").reverse().join("/") : "—";
  }
  function openPicker() {
    const anchor = start ? new Date(`${start}T12:00:00`) : new Date();
    cursor = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    open = !open;
  }
  function move(months: number) {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + months, 1);
  }
  function monthLabel(offset: number) {
    return new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(new Date(cursor.getFullYear(), cursor.getMonth() + offset, 1));
  }
  function days(offset: number): Array<{ date: string; day: number } | null> {
    const month = new Date(cursor.getFullYear(), cursor.getMonth() + offset, 1);
    const leading = (month.getDay() + 6) % 7;
    const total = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [...Array.from({ length: leading }, () => null), ...Array.from({ length: total }, (_, index) => ({ date: iso(new Date(month.getFullYear(), month.getMonth(), index + 1)), day: index + 1 }))];
  }
  function choose(date: string) {
    if (!start || end) {
      start = date;
      end = "";
      durationWeeks = null;
      return;
    }
    if (date < start) {
      end = start;
      start = date;
    } else end = date;
    durationWeeks = null;
  }
  function applyWeeks(weeks: 1 | 2 | 3 | 4) {
    const base = start ? new Date(`${start}T12:00:00`) : new Date();
    start ||= iso(base);
    base.setDate(base.getDate() + weeks * 7 - 1);
    end = iso(base);
    durationWeeks = weeks;
  }
  function clear() {
    start = "";
    end = "";
    durationWeeks = null;
  }
  const inRange = (date: string) => Boolean(start && end && date >= start && date <= end);
</script>

<div class="range-root">
  <span class="range-label">{label}</span>
  <button type="button" class="range-trigger" aria-expanded={open} onclick={openPicker}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7 2.8v4M17 2.8v4M3 9h18M7 12.5h.01M12 12.5h.01M17 12.5h.01M7 16.5h.01M12 16.5h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
    <span>{start && end ? `${display(start)} - ${display(end)}` : start ? `${display(start)} - Selecciona el final` : "Seleccionar intervalo"}</span><b>⌄</b>
  </button>
  {#if required}<input class="sr-only" tabindex="-1" required value={start && end ? `${start}/${end}` : ""}/>{/if}
  {#if open}
    <div class="range-popover" class:with-presets={showDurations}>
      {#if showDurations}<aside><p>DURACIÓN</p>{#each [1,2,3,4] as weeks}<button type="button" class:active={durationWeeks === weeks} onclick={() => applyWeeks(weeks as 1|2|3|4)}>{weeks} {weeks === 1 ? "semana" : "semanas"}</button>{/each}<button type="button" class:active={durationWeeks === null}>Personalizado</button></aside>{/if}
      <section class="calendar">
        <header><button type="button" aria-label="Mes anterior" onclick={() => move(-1)}>‹</button><div><strong>Selecciona un intervalo</strong><span>{start ? display(start) : "Fecha inicial"} → {end ? display(end) : "Fecha final"}</span></div><button type="button" aria-label="Mes siguiente" onclick={() => move(1)}>›</button></header>
        <div class="months">{#each [0,1] as offset}<section><h4>{monthLabel(offset)}</h4><div class="weekdays">{#each ["L","M","X","J","V","S","D"] as day}<span>{day}</span>{/each}</div><div class="days">{#each days(offset) as cell}<div>{#if cell}<button type="button" class:edge={cell.date === start || cell.date === end} class:inside={inRange(cell.date)} onclick={() => choose(cell.date)}>{cell.day}</button>{/if}</div>{/each}</div></section>{/each}</div>
        <footer><button type="button" onclick={clear}>Borrar</button><div><button type="button" onclick={() => (open=false)}>Cancelar</button><button type="button" class="apply" disabled={!start || !end} onclick={() => (open=false)}>Aplicar</button></div></footer>
      </section>
    </div>
  {/if}
</div>

<style>
  .range-root{position:relative;display:grid;gap:.3rem}.range-label{font-size:.75rem;color:var(--color-muted)}.range-trigger{display:flex;min-height:2.75rem;width:100%;align-items:center;gap:.7rem;border:1px solid var(--color-border);border-radius:.75rem;background:var(--color-surface-input,rgba(0,0,0,.2));padding:.6rem .8rem;color:var(--color-text);text-align:left}.range-trigger:hover{border-color:var(--color-border-strong)}.range-trigger svg{width:1.2rem;flex:none}.range-trigger span{flex:1}.range-trigger b{color:var(--color-muted);font-weight:400}.range-popover{position:absolute;z-index:160;top:calc(100% + .5rem);left:0;display:grid;width:min(43rem,calc(100vw - 3rem));overflow:hidden;border:1px solid var(--color-border);border-radius:1rem;background:#19151f;box-shadow:0 24px 70px rgba(0,0,0,.55)}.range-popover.with-presets{grid-template-columns:9.5rem minmax(0,1fr)}aside{padding:.8rem;border-right:1px solid var(--color-border);background:rgba(0,0,0,.12)}aside p{padding:.4rem .65rem;color:var(--color-muted-dim);font-size:.65rem;font-weight:700;letter-spacing:.14em}aside button{display:block;width:100%;border-radius:.55rem;padding:.7rem;text-align:left;color:var(--color-text)}aside button:hover,aside button.active{background:var(--color-purple-mist);color:#dbc2f7}.calendar{min-width:0;padding:1rem}.calendar header{display:grid;grid-template-columns:2.4rem 1fr 2.4rem;align-items:center;gap:.75rem;margin-bottom:1rem}.calendar header button{height:2.4rem;border:1px solid var(--color-border);border-radius:.6rem;font-size:1.35rem}.calendar header div{text-align:center}.calendar header strong,.calendar header span{display:block}.calendar header span{margin-top:.2rem;color:var(--color-muted);font-size:.75rem}.months{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.months h4{text-align:center;text-transform:capitalize}.weekdays,.days{display:grid;grid-template-columns:repeat(7,1fr);text-align:center}.weekdays{margin:.75rem 0 .35rem;color:var(--color-muted-dim);font-size:.68rem;font-weight:700}.days>div{aspect-ratio:1}.days button{height:100%;width:100%;border-radius:.45rem;color:var(--color-text);font-size:.78rem}.days button:hover{background:rgba(168,85,247,.28)}.days button.inside{background:rgba(168,85,247,.17)}.days button.edge{background:#8b3ed1;color:white}.calendar footer{display:flex;align-items:center;justify-content:space-between;margin-top:1rem;border-top:1px solid var(--color-border);padding-top:.85rem}.calendar footer>div{display:flex;gap:.5rem}.calendar footer button{border-radius:.6rem;padding:.55rem .85rem;color:var(--color-muted)}.calendar footer .apply{background:#b893e2;color:#170d21;font-weight:700}.calendar footer .apply:disabled{opacity:.4}@media(max-width:720px){.range-popover,.range-popover.with-presets{left:0;right:auto;grid-template-columns:1fr;width:min(34rem,calc(100vw - 2rem))}.range-popover aside{display:flex;overflow-x:auto;border-right:0;border-bottom:1px solid var(--color-border)}aside p{display:none}aside button{width:auto;flex:none}.months{grid-template-columns:1fr}.months>section:nth-child(2){display:none}}
</style>
