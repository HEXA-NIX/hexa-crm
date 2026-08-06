export type TechnologyCategory = "frontend" | "backend" | "app" | "database" | "infrastructure" | "deployment" | "integrations" | "plugins" | "ai" | "tools";
export type TechnologyDefinition = { name: string; slug: string; color: string; categories: TechnologyCategory[] };

export const TECHNOLOGY_CATALOG: TechnologyDefinition[] = [
  { name: "Svelte", slug: "svelte", color: "FF3E00", categories: ["frontend"] },
  { name: "React", slug: "react", color: "61DAFB", categories: ["frontend", "app"] },
  { name: "Vue.js", slug: "vuedotjs", color: "4FC08D", categories: ["frontend"] },
  { name: "Angular", slug: "angular", color: "DD0031", categories: ["frontend"] },
  { name: "TypeScript", slug: "typescript", color: "3178C6", categories: ["frontend", "backend", "app"] },
  { name: "Node.js", slug: "nodedotjs", color: "5FA04E", categories: ["backend"] },
  { name: "Rust", slug: "rust", color: "DEA584", categories: ["backend", "app"] },
  { name: "Go", slug: "go", color: "00ADD8", categories: ["backend"] },
  { name: "Python", slug: "python", color: "3776AB", categories: ["backend", "ai"] },
  { name: "Laravel", slug: "laravel", color: "FF2D20", categories: ["backend"] },
  { name: "Flutter", slug: "flutter", color: "02569B", categories: ["app"] },
  { name: "React Native", slug: "react", color: "61DAFB", categories: ["app"] },
  { name: "Swift", slug: "swift", color: "F05138", categories: ["app"] },
  { name: "Kotlin", slug: "kotlin", color: "7F52FF", categories: ["app"] },
  { name: "Tauri", slug: "tauri", color: "24C8DB", categories: ["app"] },
  { name: "Electron", slug: "electron", color: "47848F", categories: ["app"] },
  { name: "PostgreSQL", slug: "postgresql", color: "4169E1", categories: ["database"] },
  { name: "SQLite", slug: "sqlite", color: "003B57", categories: ["database"] },
  { name: "Redis", slug: "redis", color: "FF4438", categories: ["database"] },
  { name: "Docker", slug: "docker", color: "2496ED", categories: ["infrastructure", "deployment"] },
  { name: "Linux", slug: "linux", color: "FCC624", categories: ["infrastructure"] },
  { name: "Google Cloud", slug: "googlecloud", color: "4285F4", categories: ["infrastructure", "deployment"] },
  { name: "AWS", slug: "amazonwebservices", color: "FF9900", categories: ["infrastructure", "deployment"] },
  { name: "GitHub Actions", slug: "githubactions", color: "2088FF", categories: ["deployment", "tools"] },
  { name: "Google Drive", slug: "googledrive", color: "4285F4", categories: ["integrations"] },
  { name: "Stripe", slug: "stripe", color: "635BFF", categories: ["integrations"] },
  { name: "WhatsApp", slug: "whatsapp", color: "25D366", categories: ["integrations", "plugins"] },
  { name: "Twitch", slug: "twitch", color: "9146FF", categories: ["plugins"] },
  { name: "YouTube", slug: "youtube", color: "FF0000", categories: ["plugins"] },
  { name: "OBS Studio", slug: "obsstudio", color: "302E31", categories: ["plugins"] },
  { name: "OBS WebSocket", slug: "obsstudio", color: "302E31", categories: ["plugins"] },
  { name: "Stream Deck", slug: "elgato", color: "101010", categories: ["plugins"] },
  { name: "Discord", slug: "discord", color: "5865F2", categories: ["plugins", "integrations"] },
  { name: "OpenAI", slug: "openai", color: "412991", categories: ["ai"] },
  { name: "Ollama", slug: "ollama", color: "FFFFFF", categories: ["ai"] },
  { name: "Figma", slug: "figma", color: "F24E1E", categories: ["tools"] },
  { name: "GitHub", slug: "github", color: "FFFFFF", categories: ["tools"] },
];

export function technologyDefinition(name: string): TechnologyDefinition | undefined {
  return TECHNOLOGY_CATALOG.find((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
}

export function technologyLogoUrl(name: string): string | null {
  const item = technologyDefinition(name);
  return item ? `https://cdn.simpleicons.org/${item.slug}/${item.color}` : null;
}
