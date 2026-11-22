const MAX_PROJECT_LOGO_BYTES = 1024 * 1024;
const PROJECT_LOGO_PATTERN = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;

export function validateProjectLogo(value: string | undefined | null): string | null {
  if (!value) return null;
  const match = value.match(PROJECT_LOGO_PATTERN);
  if (!match) return "El logo debe ser una imagen PNG, JPG o WebP.";
  const padding = match[2].match(/=*$/)?.[0].length ?? 0;
  const bytes = Math.floor((match[2].length * 3) / 4) - padding;
  return bytes > MAX_PROJECT_LOGO_BYTES ? "El logo no puede superar 1 MB." : null;
}

export async function projectLogoDataUrl(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("El logo debe ser una imagen PNG, JPG o WebP.");
  }
  if (file.size > MAX_PROJECT_LOGO_BYTES) throw new Error("El logo no puede superar 1 MB.");
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
}
