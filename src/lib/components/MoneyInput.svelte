<script lang="ts">
  import { formatMoneyInput, parseMoneyInput } from "$lib/money-input";

  let {
    id = undefined, value = $bindable(""), placeholder = "0,00", class: className = "", required = false,
    ariaLabel = "Importe en euros", oninput,
  }: {
    id?: string; value?: string | number; placeholder?: string; class?: string; required?: boolean;
    ariaLabel?: string; oninput?: (event: Event & { currentTarget: HTMLInputElement }) => void;
  } = $props();
  let display = $state(formatMoneyInput(value));
  let focused = $state(false);

  $effect(() => { if (!focused) display = formatMoneyInput(value); });

  function handleInput(event: Event & { currentTarget: HTMLInputElement }) {
    const raw = parseMoneyInput(event.currentTarget.value);
    value = raw;
    display = formatMoneyInput(raw);
    oninput?.({ ...event, currentTarget: { ...event.currentTarget, value: raw } } as Event & { currentTarget: HTMLInputElement });
  }
</script>

<input {id} class="field w-full {className}" type="text" inputmode="decimal" {placeholder} {required}
  aria-label={ariaLabel} value={display} onfocus={() => (focused = true)}
  onblur={() => { focused = false; display = formatMoneyInput(value); }} oninput={handleInput} />
