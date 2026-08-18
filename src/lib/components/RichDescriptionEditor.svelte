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

  async function formatHeading(level: 2 | 3) {
    if (!textarea) return;
    const start = textarea.selectionStart;
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const lineEnd = value.indexOf("\n", start);
    const finish = lineEnd === -1 ? value.length : lineEnd;
    const current = value.slice(lineStart, finish).replace(/^\s*#{1,6}\s+/, "") || (level === 2 ? "Título de sección" : "Subtítulo");
    const formatted = `${"#".repeat(level)} ${current}`;
    value = `${value.slice(0, lineStart)}${formatted}${value.slice(finish)}`;
    await tick();
    textarea.focus();
    textarea.setSelectionRange(lineStart + level + 1, lineStart + formatted.length);
  }

  async function insertPhase() {
    if (!textarea) return;
    const position = textarea.selectionStart;
    const prefix = position > 0 && !value.slice(0, position).endsWith("\n\n") ? "\n\n" : "";
    const block = `${prefix}### Fase 1 — Nombre de la fase · Semanas 1–2\nDescribe aquí los trabajos, objetivos y entregables de esta fase.`;
    value = `${value.slice(0, position)}${block}${value.slice(position)}`;
    await tick();
    textarea.focus();
    textarea.setSelectionRange(position + prefix.length + 3, position + prefix.length + block.length);
  }

  async function insertTechnologies() {
    if (!textarea) return;
    const position = textarea.selectionStart;
    const prefix = position > 0 && !value.slice(0, position).endsWith("\n\n") ? "\n\n" : "";
    const block = `${prefix}## Tecnologías utilizadas y previstas\n- Tecnología — uso dentro del proyecto\n- Tecnología — uso dentro del proyecto`;
    value = `${value.slice(0, position)}${block}${value.slice(position)}`;
    await tick();
    textarea.focus();
    const firstTechnology = position + prefix.length + "## Tecnologías utilizadas y previstas\n- ".length;
    textarea.setSelectionRange(firstTechnology, firstTechnology + "Tecnología — uso dentro del proyecto".length);
  }

  async function continueList(event: KeyboardEvent) {
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || !textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const currentLine = value.slice(lineStart, start);
    const unordered = currentLine.match(/^(\s*)[-*]\s+(.*)$/);
    const ordered = currentLine.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    if (!unordered && !ordered) return;

    event.preventDefault();
    const content = unordered?.[2] ?? ordered?.[3] ?? "";
    if (!content.trim()) {
      value = `${value.slice(0, lineStart)}${value.slice(end)}`;
      await tick();
      textarea.focus();
      textarea.setSelectionRange(lineStart, lineStart);
      return;
    }

    const marker = unordered ? `${unordered[1]}- ` : `${ordered![1]}${Number(ordered![2]) + 1}. `;
    const insertion = `\n${marker}`;
    value = `${value.slice(0, start)}${insertion}${value.slice(end)}`;
    await tick();
    textarea.focus();
    const nextPosition = start + insertion.length;
    textarea.setSelectionRange(nextPosition, nextPosition);
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
      <button type="button" class="rounded-md px-2.5 py-1 text-xs font-bold text-[var(--color-muted)] hover:bg-white/10 hover:text-white" title="Título de sección" onclick={() => formatHeading(2)}>Título</button>
      <button type="button" class="rounded-md px-2.5 py-1 text-xs font-semibold text-[var(--color-muted)] hover:bg-white/10 hover:text-white" title="Subtítulo" onclick={() => formatHeading(3)}>Subtítulo</button>
      <button type="button" class="rounded-md px-2.5 py-1 text-xs font-semibold text-[var(--color-purple-bright)] hover:bg-white/10 hover:text-white" title="Añadir fase con periodo y descripción" onclick={insertPhase}>＋ Fase</button>
      <button type="button" class="rounded-md px-2.5 py-1 text-xs font-semibold text-[var(--color-purple-bright)] hover:bg-white/10 hover:text-white" title="Añadir tecnologías utilizadas o previstas" onclick={insertTechnologies}>＋ Tecnologías</button>
      <span class="mx-1 h-4 w-px bg-[var(--color-border)]"></span>
      <button type="button" class="rounded-md px-2.5 py-1 text-xs text-[var(--color-muted)] hover:bg-white/10 hover:text-white" title="Lista con viñetas" onclick={() => formatList(false)}>• Lista</button>
      <button type="button" class="rounded-md px-2.5 py-1 text-xs text-[var(--color-muted)] hover:bg-white/10 hover:text-white" title="Lista numerada" onclick={() => formatList(true)}>1. Lista</button>
    </div>
    {#if preview}
      <RichDescription {value} class="min-h-28 bg-black/10 p-3 text-sm leading-relaxed text-[var(--color-muted)]" />
    {:else}
      <textarea bind:this={textarea} {id} bind:value {placeholder} {rows} onkeydown={continueList} class="block w-full resize-y bg-transparent p-3 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-muted-dim)]"></textarea>
    {/if}
  </div>
  <p class="text-[10px] text-[var(--color-muted-dim)]">Formato comercial: títulos, subtítulos, negrita, cursiva y listas.</p>
</div>
