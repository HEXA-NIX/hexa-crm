<script lang="ts">
  import DatePicker from "$lib/components/DatePicker.svelte";
  let {
    label = "",
    type = "text",
    value = $bindable(""),
    placeholder = "",
    required = false,
    step = undefined as string | undefined,
    min = undefined as string | number | undefined,
    class: className = "",
    oninput,
  }: {
    label?: string;
    type?: string;
    value?: string | number;
    placeholder?: string;
    required?: boolean;
    step?: string;
    min?: string | number;
    class?: string;
    oninput?: (event: Event & { currentTarget: HTMLInputElement }) => void;
  } = $props();
</script>

<label class="flex flex-col gap-1.5 text-sm {className}">
  {#if label}
    <span class="font-medium text-[var(--color-muted)]">{label}</span>
  {/if}
  {#if type === "date" || type === "month"}
    <DatePicker
      type={type as "date" | "month"}
      value={String(value ?? "")}
      {placeholder}
      {required}
      min={min == null ? undefined : String(min)}
      oninput={(next) => {
        value = next;
        oninput?.({ currentTarget: { value: next } } as unknown as Event & { currentTarget: HTMLInputElement });
      }}
    />
  {:else}<input
    {type}
    {placeholder}
    {required}
    {step}
    {min}
    bind:value
    {oninput}
    class="field w-full"
  />{/if}
</label>
