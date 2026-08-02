function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function inlineFormat(value: string) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1<em>$2</em>");
}

export function renderRichDescription(value: string) {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let listType: "ul" | "ol" | null = null;

  function closeList() {
    if (!listType) return;
    output.push(`</${listType}>`);
    listType = null;
  }

  for (const line of lines) {
    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    const nextListType = unordered ? "ul" : ordered ? "ol" : null;

    if (nextListType) {
      if (listType !== nextListType) {
        closeList();
        listType = nextListType;
        output.push(`<${nextListType}>`);
      }
      output.push(`<li>${inlineFormat((unordered?.[1] ?? ordered?.[1]) || "")}</li>`);
      continue;
    }

    closeList();
    if (!line.trim()) {
      output.push("<br>");
    } else {
      output.push(`<p>${inlineFormat(line)}</p>`);
    }
  }

  closeList();
  return output.join("");
}
