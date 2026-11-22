declare module "html2pdf.js" {
  type PdfOptions = Record<string, unknown>;
  interface PdfWorker {
    set(options: PdfOptions): PdfWorker;
    from(element: HTMLElement): PdfWorker;
    toPdf(): PdfWorker;
    get(key: "pdf"): Promise<unknown>;
    save(): Promise<void>;
    outputPdf(type: "bloburl"): Promise<string>;
  }
  export default function html2pdf(): PdfWorker;
}
