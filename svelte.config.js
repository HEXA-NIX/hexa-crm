import adapter from "@sveltejs/adapter-node";
import adapterStatic from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter:
      process.env.CLOUDFLARE_BUILD === "1"
        ? adapterStatic({ fallback: "200.html", strict: false })
        : adapter(),
    prerender: {
      handleUnseenRoutes: "ignore",
    },
  },
};

export default config;
