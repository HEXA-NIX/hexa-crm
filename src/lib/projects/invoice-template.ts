export type InvoiceTemplate = {
  logo_data_url: string;
  accent_color: string;
  footer: string;
  show_payment_details: boolean;
};

export const defaultInvoiceTemplate: InvoiceTemplate = {
  logo_data_url: "",
  accent_color: "#8b5cf6",
  footer: "Gracias por confiar en nosotros.",
  show_payment_details: true,
};

export function invoiceTemplateLabel(template: InvoiceTemplate): string {
  return template.show_payment_details ? "Plantilla con datos de pago" : "Plantilla básica";
}
