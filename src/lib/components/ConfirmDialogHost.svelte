<script lang="ts">
  import Button from "$lib/components/Button.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import { closeConfirmDialog, confirmDialogRequest } from "$lib/stores/confirm-dialog";
</script>

<Modal open={!!$confirmDialogRequest} title={$confirmDialogRequest?.title ?? "Confirmar acción"} size="sm" onclose={() => closeConfirmDialog(false)}>
  {#if $confirmDialogRequest}
    <div class="confirm-dialog-body">
      <p>{$confirmDialogRequest.message}</p>
      <div class="confirm-dialog-actions">
        <Button variant="ghost" onclick={() => closeConfirmDialog(false)}>Cancelar</Button>
        <Button variant={$confirmDialogRequest.danger ? "danger" : "primary"} onclick={() => closeConfirmDialog(true)}>{$confirmDialogRequest.confirmLabel}</Button>
      </div>
    </div>
  {/if}
</Modal>

<style>
  .confirm-dialog-body{display:grid;gap:1.35rem}.confirm-dialog-body p{margin:0;color:var(--color-muted);font-size:.95rem;line-height:1.6}.confirm-dialog-actions{display:flex;justify-content:flex-end;gap:.65rem}
</style>
