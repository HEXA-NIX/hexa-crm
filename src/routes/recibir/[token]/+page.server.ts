import { env } from "$env/dynamic/private";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ url }) => {
  const configured = String(env.HEXA_PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
  return { public_url: configured || url.origin };
};
