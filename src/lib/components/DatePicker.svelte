<script lang="ts">
  import { formatDateES } from "$lib/date";
  import { onMount } from "svelte";

  let {
    value = $bindable(""),
    type = "date",
    placeholder = "dd/mm/aaaa",
    min,
    max,
    required = false,
    disabled = false,
    class: className = "",
    ariaLabel = "Seleccionar fecha",
    align = "left",
    oninput,
  }: {
    value?: string;
    type?: "date" | "month";
    placeholder?: string;
    min?: string;
    max?: string;
    required?: boolean;
    disabled?: boolean;
    class?: string;
    ariaLabel?: string;
    align?: "left" | "right";
    oninput?: (value: string) => void;
  } = $props();

  let open = $state(false);
  let root = $state<HTMLElement | null>(null);
  let cursor = $state(new Date());
  const weekdays = ["L", "M", "X", "J", "V", "S", "D"];
  const months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

  const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const monthIso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const today = iso(new Date());
  const title = $derived(type === "month" ? String(cursor.getFullYear()) : cursor.toLocaleDateString("es-ES", { month: "long", year: "numeric" }));
  const display = $derived.by(() => {
    if (!value) return "";
    if (type === "month") return new Date(`${value}-01T12:00:00`).toLocaleDateString("es-ES", { month: "long", year: "numeric" });
    return formatDateES(value, "");
  });
  const days = $derived.by(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const leading = (new Date(year, month, 1).getDay() + 6) % 7;
    const count = new Date(year, month + 1, 0).getDate();
    const previousCount = new Date(year, month, 0).getDate();
    return Array.from({ length: 42 }, (_, index) => {
      const day = index - leading + 1;
      const date = day < 1 ? new Date(year, month - 1, previousCount + day) : day > count ? new Date(year, month + 1, day - count) : new Date(year, month, day);
      return { date: iso(date), day: date.getDate(), outside: date.getMonth() !== month };
    });
  });

  function show() {
    if (disabled) return;
    const parsed = value ? new Date(type === "month" ? `${value}-01T12:00:00` : `${value.slice(0, 10)}T12:00:00`) : new Date();
    if (!Number.isNaN(parsed.getTime())) cursor = parsed;
    open = !open;
  }
  function move(amount: number) {
    cursor = type === "month" ? new Date(cursor.getFullYear() + amount, cursor.getMonth(), 1) : new Date(cursor.getFullYear(), cursor.getMonth() + amount, 1);
  }
  function allowed(next: string) { return (!min || next >= min) && (!max || next <= max); }
  function choose(next: string) {
    if (!allowed(next)) return;
    value = next;
    oninput?.(next);
    open = false;
  }
  function clear() { value = ""; oninput?.(""); open = false; }

  onMount(() => {
    const close = (event: PointerEvent) => { if (open && root && !root.contains(event.target as Node)) open = false; };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  });
</script>

<div class="hexa-date {className}" bind:this={root}>
  <button type="button" class="field hexa-date-trigger" aria-label={ariaLabel} aria-expanded={open} {disabled} onclick={show}>
    <span class:placeholder={!display}>{display || placeholder}</span>
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></svg>
  </button>
  {#if required}<input class="hexa-date-required" tabindex="-1" aria-hidden="true" required value={value} />{/if}
  {#if open}
    <div class="hexa-date-popover" class:align-right={align === "right"} role="dialog" aria-label={ariaLabel}>
      <header><button type="button" aria-label={type === "month" ? "Año anterior" : "Mes anterior"} onclick={() => move(-1)}>‹</button><strong>{title}</strong><button type="button" aria-label={type === "month" ? "Año siguiente" : "Mes siguiente"} onclick={() => move(1)}>›</button></header>
      {#if type === "month"}
        <div class="hexa-month-grid">{#each months as month, index}{@const next = `${cursor.getFullYear()}-${String(index + 1).padStart(2, "0")}`}<button type="button" class:selected={value === next} disabled={!allowed(next)} onclick={() => choose(next)}>{month.slice(0, 3)}</button>{/each}</div>
      {:else}
        <div class="hexa-weekdays">{#each weekdays as weekday}<span>{weekday}</span>{/each}</div>
        <div class="hexa-days">{#each days as cell}<button type="button" class:outside={cell.outside} class:today={cell.date === today} class:selected={value?.slice(0,10) === cell.date} disabled={!allowed(cell.date)} onclick={() => choose(cell.date)}>{cell.day}</button>{/each}</div>
      {/if}
      <footer><button type="button" onclick={clear}>Borrar</button>{#if type === "date"}<button type="button" onclick={() => choose(today)}>Hoy</button>{/if}</footer>
    </div>
  {/if}
</div>

<style>
  .hexa-date{position:relative;width:100%}.hexa-date-trigger{display:flex;width:100%;align-items:center;justify-content:space-between;gap:.75rem;text-align:left}.hexa-date-trigger .placeholder{color:var(--color-muted-dim)}.hexa-date-trigger svg{width:1.15rem;height:1.15rem;flex:none;fill:none;stroke:var(--color-purple-bright);stroke-width:1.7;stroke-linecap:round}.hexa-date-required{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}.hexa-date-popover{position:absolute;left:0;top:calc(100% + .45rem);z-index:1000;width:20rem;max-width:calc(100vw - 2rem);padding:.85rem;border:1px solid var(--color-border-strong);border-radius:.85rem;background:var(--color-obsidian-elevated);box-shadow:0 22px 55px rgba(0,0,0,.48)}.hexa-date-popover.align-right{right:0;left:auto}.hexa-date-popover header{display:grid;grid-template-columns:2rem 1fr 2rem;align-items:center;gap:.5rem;margin-bottom:.8rem}.hexa-date-popover header strong{text-align:center;text-transform:capitalize}.hexa-date-popover button{border:0;background:transparent;color:var(--color-text);cursor:pointer}.hexa-date-popover header button{display:grid;width:2rem;height:2rem;place-items:center;border:1px solid var(--color-border);border-radius:.5rem;font-size:1.2rem}.hexa-date-popover button:hover{background:var(--color-purple-soft);color:var(--color-purple-bright)}.hexa-weekdays,.hexa-days{display:grid;grid-template-columns:repeat(7,1fr);text-align:center}.hexa-weekdays{margin-bottom:.25rem;color:var(--color-muted-dim);font-size:.62rem;font-weight:700}.hexa-days button{aspect-ratio:1;border-radius:50%;font-size:.74rem}.hexa-days button.outside{color:var(--color-muted-dim);opacity:.45}.hexa-days button.today{box-shadow:inset 0 0 0 1px var(--color-purple)}.hexa-days button.selected,.hexa-month-grid button.selected{background:var(--color-purple);color:#fff;font-weight:700}.hexa-days button:disabled,.hexa-month-grid button:disabled{opacity:.2;cursor:not-allowed}.hexa-month-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.35rem}.hexa-month-grid button{padding:.65rem;border-radius:.5rem;text-transform:capitalize}.hexa-date-popover footer{display:flex;justify-content:space-between;margin-top:.75rem;padding-top:.65rem;border-top:1px solid var(--color-border)}.hexa-date-popover footer button{padding:.4rem .55rem;border-radius:.4rem;color:var(--color-purple-bright);font-size:.75rem}@media(max-width:480px){.hexa-date-popover{width:min(20rem,calc(100vw - 2rem))}}
  .hexa-date-trigger:disabled{cursor:default;opacity:.72}
</style>
