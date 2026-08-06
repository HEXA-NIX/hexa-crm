import { createHash } from "node:crypto";

export function localGowaDeviceId(sessionToken: string): string {
  const token = sessionToken.trim();
  if (token.length < 20) throw new Error("Sesión local no válida");
  return `hexa-local-${createHash("sha256").update(token).digest("hex").slice(0, 24)}`;
}
