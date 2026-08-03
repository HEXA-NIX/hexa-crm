export type ImportedTaskDetail = {
  title: string;
  description: string;
};

export type ImportedTask = ImportedTaskDetail & {
  subtasks: ImportedTaskDetail[];
};

const LIST_ITEM = /^(\s*)(?:(?:[-*+]\s+)|(?:\d+[.)]\s+))(?:\[[ xX]\]\s*)?(.+?)\s*$/;
const DESCRIPTION_PREFIX = /^(?:descripci[oó]n|description)\s*:\s*/i;

function indentation(raw: string): number {
  return [...raw].reduce((total, char) => total + (char === "\t" ? 2 : 1), 0);
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/\s+#+\s*$/, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .replace(/^__(.+)__$/, "$1")
    .trim();
}

function appendDescription(target: ImportedTaskDetail, text: string) {
  const clean = text.replace(DESCRIPTION_PREFIX, "").trim();
  if (clean) target.description = target.description ? `${target.description}\n${clean}` : clean;
}

/**
 * Converts Markdown lists commonly returned by ChatGPT into the two-level
 * hierarchy supported by work items. Indented continuation text, or a line
 * beginning with "Descripción:", is attached to the preceding item.
 */
export function parseTaskImport(source: string): ImportedTask[] {
  const tasks: ImportedTask[] = [];
  let rootIndent: number | null = null;
  let currentRoot: ImportedTask | null = null;
  let currentItem: ImportedTaskDetail | null = null;
  let currentItemIndent = 0;

  for (const rawLine of source.split(/\r?\n/)) {
    const listMatch = rawLine.match(LIST_ITEM);
    if (listMatch) {
      const indent = indentation(listMatch[1]);
      const title = cleanTitle(listMatch[2]);
      if (!title) continue;
      if (rootIndent === null) rootIndent = indent;

      if (indent === rootIndent || currentRoot === null) {
        currentRoot = { title, description: "", subtasks: [] };
        tasks.push(currentRoot);
        currentItem = currentRoot;
      } else {
        const subtask = { title, description: "" };
        currentRoot.subtasks.push(subtask);
        currentItem = subtask;
      }
      currentItemIndent = indent;
      continue;
    }

    const text = rawLine.trim();
    if (!text || !currentItem || /^#{1,6}\s/.test(text)) continue;
    const indent = indentation(rawLine.slice(0, rawLine.length - rawLine.trimStart().length));
    if (DESCRIPTION_PREFIX.test(text) || indent > currentItemIndent) {
      appendDescription(currentItem, text);
    }
  }

  return tasks;
}

export function countImportedTasks(tasks: ImportedTask[]): number {
  return tasks.reduce((total, task) => total + 1 + task.subtasks.length, 0);
}
