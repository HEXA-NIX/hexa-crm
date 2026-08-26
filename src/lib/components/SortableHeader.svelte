<script lang="ts">
  import type { SortDirection } from "$lib/list-sort";

  let {
    label,
    active = false,
    direction = "asc",
    onclick,
    class: className = "",
    align = "left",
  }: {
    label: string;
    active?: boolean;
    direction?: SortDirection;
    onclick: () => void;
    class?: string;
    align?: "left" | "right";
  } = $props();
</script>

<th class="px-4 py-3 {align === 'right' ? 'text-right' : ''} {className}" aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}>
  <button
    type="button"
    class="inline-flex items-center gap-1.5 text-inherit transition hover:text-[var(--color-text)]"
    class:justify-end={align === "right"}
    onclick={onclick}
    aria-label="Ordenar por {label}"
  >
    <span>{label}</span>
    <span class="text-[10px] normal-case opacity-70" aria-hidden="true">{active ? (direction === "asc" ? "↑" : "↓") : "↕"}</span>
  </button>
</th>
