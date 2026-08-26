const technologyMarker = /\n?<!--\s*hexa-technologies:(\[[\s\S]*?\])\s*-->\s*$/;
const structuredTechnologyMarker = /\n?<!--\s*hexa-technology-groups:(\{[\s\S]*?\})\s*-->\s*$/;
export type ProposalTechnologyGroups = Record<string, string[]>;

export function parseProposalContent(value: string): { title: string; body: string; technologies: ProposalTechnologyGroups } {
  const normalized = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  const structuredMarker = normalized.match(structuredTechnologyMarker);
  const marker = normalized.match(technologyMarker);
  let technologies: ProposalTechnologyGroups = {};
  if (structuredMarker) {
    try {
      const parsed = JSON.parse(structuredMarker[1]) as Record<string, unknown>;
      technologies = Object.fromEntries(Object.entries(parsed).map(([key, items]) => [key, Array.isArray(items) ? [...new Set(items.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()))] : []]).filter(([, items]) => items.length));
    } catch { technologies = {}; }
  } else if (marker) {
    try { technologies = { tools: [...new Set((JSON.parse(marker[1]) as unknown[]).filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()))] }; } catch { technologies = {}; }
  }
  const content = normalized.replace(structuredTechnologyMarker, "").replace(technologyMarker, "").trim();
  const match = content.match(/^#\s+(.+?)(?:\n{2,}|\n|$)([\s\S]*)$/);
  if (!match) return { title: "", body: content, technologies };
  return { title: match[1].trim(), body: match[2].trim(), technologies };
}

export function serializeProposalContent(title: string, body: string, technologies: ProposalTechnologyGroups = {}): string {
  const normalized = Object.fromEntries(Object.entries(technologies).filter(([, items]) => items.length));
  const marker = Object.keys(normalized).length ? `<!-- hexa-technology-groups:${JSON.stringify(normalized)} -->` : "";
  return [title.trim() ? `# ${title.trim()}` : "", body.trim(), marker].filter(Boolean).join("\n\n");
}
