<script lang="ts">
  import TechnologyBadge from "./TechnologyBadge.svelte";
  import { TECHNOLOGY_CATALOG, type TechnologyCategory } from "$lib/projects/technology-catalog";
  import { parseTechStack } from "$lib/projects/project-brief";
  let { label, category, value = $bindable("") }: { label: string; category: TechnologyCategory; value: string } = $props();
  let custom = $state("");
  const selected = $derived(parseTechStack(value));
  const suggestions = $derived(TECHNOLOGY_CATALOG.filter((item) => item.categories.includes(category) && !selected.some((name) => name.toLowerCase() === item.name.toLowerCase())));
  function set(values: string[]) { value = values.join(", "); }
  function add(name: string) { if (name.trim()) set([...selected, name.trim()]); custom = ""; }
</script>

<div class="space-y-2 rounded-xl border border-white/[0.07] bg-black/15 p-3">
  <p class="text-xs font-semibold text-[var(--color-text)]">{label}</p>
  <div class="flex min-h-7 flex-wrap gap-1.5">
    {#each selected as name}<TechnologyBadge {name} removable onremove={() => set(selected.filter((item) => item !== name))} />{/each}
    {#if !selected.length}<span class="text-[11px] text-[var(--color-muted-dim)]">Ninguna seleccionada</span>{/if}
  </div>
  <div class="flex flex-wrap gap-1">
    {#each suggestions as item}
      <button type="button" class="rounded-md border border-white/10 px-2 py-1 text-[10px] text-[var(--color-muted)] hover:border-purple-400/35 hover:text-white" onclick={() => add(item.name)}>+ {item.name}</button>
    {/each}
  </div>
  <div class="flex gap-2"><input class="field min-w-0 flex-1 text-xs" bind:value={custom} placeholder="Otra tecnología…" onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(custom); } }} /><button type="button" class="rounded-lg border border-[var(--color-border)] px-3 text-xs" onclick={() => add(custom)}>Añadir</button></div>
</div>
