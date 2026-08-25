<script lang="ts">
  import TechnologyPicker from "./TechnologyPicker.svelte";
  import type { TechnologyCategory } from "$lib/projects/technology-catalog";
  export type ProposalTechnologyForm = Record<TechnologyCategory, string>;
  let { value = $bindable() }: { value: ProposalTechnologyForm } = $props();
  const fields: { key: TechnologyCategory; label: string }[] = [
    { key: "frontend", label: "Frontend" }, { key: "backend", label: "Backend" }, { key: "app", label: "Aplicaciones" },
    { key: "database", label: "Base de datos" }, { key: "infrastructure", label: "Infraestructura" }, { key: "deployment", label: "Despliegue" },
    { key: "integrations", label: "Integraciones" }, { key: "plugins", label: "Plugins" }, { key: "ai", label: "Inteligencia artificial" }, { key: "tools", label: "Herramientas" },
  ];
</script>
<div class="rounded-xl border border-purple-400/20 bg-purple-500/[0.04] p-4">
  <p class="font-semibold text-[var(--color-text)]">Tecnologías utilizadas o previstas</p>
  <p class="mt-1 text-xs text-[var(--color-muted-dim)]">Selecciona por área las tecnologías que aparecerán con su logo en la propuesta.</p>
  <div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {#each fields as field}<TechnologyPicker label={field.label} category={field.key} bind:value={value[field.key]} />{/each}
  </div>
</div>
