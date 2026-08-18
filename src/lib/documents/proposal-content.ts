export function parseProposalContent(value: string): { title: string; body: string } {
  const normalized = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  const match = normalized.match(/^#\s+(.+?)(?:\n{2,}|\n|$)([\s\S]*)$/);
  if (!match) return { title: "", body: normalized };
  return { title: match[1].trim(), body: match[2].trim() };
}

export function serializeProposalContent(title: string, body: string): string {
  return [title.trim() ? `# ${title.trim()}` : "", body.trim()].filter(Boolean).join("\n\n");
}
