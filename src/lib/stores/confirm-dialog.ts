import { writable } from "svelte/store";

export type ConfirmDialogRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  resolve: (accepted: boolean) => void;
};

export const confirmDialogRequest = writable<ConfirmDialogRequest | null>(null);

export function confirmDialog(message: string, options: { title?: string; confirmLabel?: string; danger?: boolean } = {}) {
  return new Promise<boolean>((resolve) => {
    confirmDialogRequest.set({
      title: options.title ?? "Confirmar acción",
      message,
      confirmLabel: options.confirmLabel ?? "Confirmar",
      danger: options.danger ?? false,
      resolve,
    });
  });
}

export function closeConfirmDialog(accepted: boolean) {
  confirmDialogRequest.update((request) => {
    request?.resolve(accepted);
    return null;
  });
}
