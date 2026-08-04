<script lang="ts">
  import { tick } from "svelte";
  import RichDescription from "./RichDescription.svelte";

  let {
    value = $bindable(""),
    id,
    label = "Descripción",
    placeholder = "Añade detalles o notas…",
    rows = 5,
  }: {
    value?: string;
    id: string;
    label?: string;
    placeholder?: string;
    rows?: number;
  } = $props();

  let textarea = $state<HTMLTextAreaElement>();
  let preview = $state(false);

  async function wrapSelection(prefix: string, suffix = prefix, fallback = "texto") {
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end) || fallback;
    value = `${value.slice(0, start)}${prefix}${selected}${suffix}${value.slice(end)}`;
    await tick();
    textarea.focus();
    textarea.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
  }

  async function formatList(ordered: boolean) {
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const lineEnd = value.indexOf("\n", end);
    const finish = lineEnd === -1 ? value.length : lineEnd;
    const selected = value.slice(lineStart, finish) || "Elemento";
    const formatted = selected
      .split("\n")
      .map((line, index) => `${ordered ? `${index + 1}.` : "-"} ${line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "")}`)
      .join("\n");
    value = `${value.slice(0, lineStart)}${formatted}${value.slice(finish)}`;
    await tick();
    textarea.focus();
    textarea.setSelectionRange(lineStart, lineStart + formatted.length);
  }
</script>

<div class="space-y-1.5">
  <div class="flex items-center justify-between gap-3">
    <label for={id} class="text-xs font-medium text-[var(--color-muted)]">{label}</label>
    <button type="button" class="text-[11px] font-medium text-[var(--color-purple-bright)] hover:text-white" onclick={() => (preview = !preview)}>
      {preview ? "Seguir editando" : "Vista previa"}
    </button>
  </div>
  <div class="overflow-hidden rounded-xl border border-[var(--color-border)] focus-within:border-[var(--color-purple)]">
    <div class="flex items-center gap-1 border-b border-[var(--color-border-soft)] bg-black/20 p-1.5" aria-label="Formato de la descripción">
      <button type="button" class="rounded-md px-2.5 py-1 text-xs font-bold text-[var(--color-muted)] hover:bg-white/10 hover:text-white" title="Negrita" onclick={() => wrapSelection("**")}>B</button>
      <button type="button" class="rounded-md px-2.5 py-1 text-xs italic text-[var(--color-muted)] hover:bg-white/10 hover:text-white" title="Cursiva" onclick={() => wrapSelection("*")}>I</button>
      <span class="mx-1 h-4 w-px bg-[var(--color-border)]"></span>
      <button type="button" class="rounded-md px-2.5 py-1 text-xs text-[var(--color-muted)] hover:bg-white/10 hover:text-white" title="Lista con viñetas" onclick={() => formatList(false)}>• Lista</button>
      <button type="button" class="rounded-md px-2.5 py-1 text-xs text-[var(--color-muted)] hover:bg-white/10 hover:text-white" title="Lista numerada" onclick={() => formatList(true)}>1. Lista</button>
    </div>
    {#if preview}
      <RichDescription {value} class="min-h-28 bg-black/10 p-3 text-sm leading-relaxed text-[var(--color-muted)]" />
    {:else}
      <textarea bind:this={textarea} {id} bind:value {placeholder} {rows} class="block w-full resize-y bg-transparent p-3 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-muted-dim)]"></textarea>
    {/if}
  </div>
  <p class="text-[10px] text-[var(--color-muted-dim)]">Formato ligero: negrita, cursiva y listas.</p>
</div>
