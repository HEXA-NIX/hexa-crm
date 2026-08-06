<script lang="ts">
  import { technologyLogoUrl } from "$lib/projects/technology-catalog";
  let { name, removable = false, onremove }: { name: string; removable?: boolean; onremove?: () => void } = $props();
  const logo = $derived(technologyLogoUrl(name));
</script>

<span class="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1 text-[11px] text-[var(--color-text)]">
  <span class="relative grid h-4 w-4 place-items-center overflow-hidden rounded text-[8px] font-bold text-[var(--color-muted)]">
    {name.slice(0, 1).toUpperCase()}
    {#if logo}<img src={logo} alt="" class="absolute inset-0 h-full w-full object-contain" />{/if}
  </span>
  <span>{name}</span>
  {#if removable}<button type="button" class="ml-0.5 text-[var(--color-muted)] hover:text-rose-300" aria-label={`Quitar ${name}`} onclick={onremove}>×</button>{/if}
</span>
