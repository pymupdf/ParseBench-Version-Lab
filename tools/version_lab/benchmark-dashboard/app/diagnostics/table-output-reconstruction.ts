import {
  parseFragment,
  type DefaultTreeAdapterTypes,
} from "parse5";

/**
 * Read-time adapter for ParseBench's ambiguous merged-table transform.
 *
 * The evaluator deliberately discards source HTML for tables it splits, while
 * retaining the original result Markdown, ground truth, transform flag, counts,
 * and pairing. This module reconstructs the human-readable segments from those
 * canonical inputs. It mirrors `table_extraction.py`, `table_splitting.py`, and
 * the relevant TRM normalization used to choose split boundaries. Every result
 * is checked against the retained counts and pairing before the UI trusts it.
 */

type HtmlNode = DefaultTreeAdapterTypes.Node;
type HtmlParent = DefaultTreeAdapterTypes.ParentNode;
type HtmlElement = DefaultTreeAdapterTypes.Element;

type TableGrid = {
  cells: string[][];
  headerRows: Set<number>;
  headerCells: Set<string>;
  columnHeaders: Map<number, Array<[number, string]>>;
};

type SplitTable = {
  normalized: TableGrid;
  display: TableGrid;
};

type SplitOption = {
  segmentCount: number;
  repeatingRows: number;
  period: number;
  tables: SplitTable[] | null;
};

type ParsedOutputTable = {
  grid: TableGrid;
  sourceMarkup: string;
};

export type OutputTablePreview = {
  markdown: string;
  reconstructed: boolean;
};

type ReconstructionInput = {
  actualMarkdown: string;
  expectedMarkdown: string;
  expectedTableCount: number;
  rawOutputTableCount: number;
  scoredOutputTableCount: number;
  unparseableOutputTableCount: number;
  pairing: Array<[number, number | null]>;
};

const SPLIT_COMBINATION_LIMIT = 256;
const COLUMN_MATCH_THRESHOLD = 0.9;

const SUPERSCRIPT_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const SUBSCRIPT_DIGITS = "₀₁₂₃₄₅₆₇₈₉";
const SUPERSCRIPT_TO_ASCII = new Map(
  Array.from("⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ").map((character, index) => [
    character,
    Array.from("0123456789+-=()ni")[index],
  ]),
);
const SUBSCRIPT_TO_ASCII = new Map(
  Array.from("₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ").map((character, index) => [
    character,
    Array.from("0123456789+-=()aehijklmnoprstuvx")[index],
  ]),
);
const SINGLE_QUOTES = new Set(Array.from("‘’‚‛`´ʼʹ＇′‵ʻˊˋ"));
const DOUBLE_QUOTES = new Set(Array.from("“”„‟〝〞＂″‶ˮ"));
const FULLWIDTH_PUNCTUATION = new Map<string, string>([
  ["，", ","],
  ["．", "."],
  ["：", ":"],
  ["；", ";"],
  ["！", "!"],
  ["？", "?"],
  ["（", "("],
  ["）", ")"],
  ["、", ","],
  ["。", "."],
]);
const SYMBOL_EQUIVALENTS = new Map<string, string>([
  ...Array.from("●○◦∙⦁·").map((character) => [character, "•"] as const),
  ...Array.from("⮾ⓧ⨂").map((character) => [character, "⊗"] as const),
]);

function parseHtmlFragment(markup: string) {
  let invalid = false;
  const fragment = parseFragment(markup, {
    onParseError: () => {
      invalid = true;
    },
  });
  return invalid ? null : fragment;
}

function isElement(node: HtmlNode): node is HtmlElement {
  return "tagName" in node;
}

function isTextNode(node: HtmlNode) {
  return node.nodeName === "#text";
}

function attribute(element: HtmlElement, name: string) {
  return element.attrs.find((item) => item.name === name)?.value ?? null;
}

function positiveSpan(element: HtmlElement, name: "colspan" | "rowspan") {
  const value = Number.parseInt(attribute(element, name) ?? "1", 10);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function childNodes(node: HtmlNode | HtmlParent) {
  return "childNodes" in node ? node.childNodes : [];
}

function topLevelTables(root: HtmlParent) {
  const tables: HtmlElement[] = [];
  const visit = (node: HtmlNode) => {
    if (isElement(node) && node.tagName === "table") {
      tables.push(node);
      return;
    }
    childNodes(node).forEach(visit);
  };
  root.childNodes.forEach(visit);
  return tables;
}

function allTables(root: HtmlParent) {
  const tables: HtmlElement[] = [];
  const visit = (node: HtmlNode) => {
    if (isElement(node) && node.tagName === "table") tables.push(node);
    childNodes(node).forEach(visit);
  };
  root.childNodes.forEach(visit);
  return tables;
}

function descendantsByTag(root: HtmlElement, tags: ReadonlySet<string>) {
  const matches: HtmlElement[] = [];
  const visit = (node: HtmlNode) => {
    if (isElement(node)) {
      if (node !== root && node.tagName === "table") return;
      if (tags.has(node.tagName)) matches.push(node);
    }
    childNodes(node).forEach(visit);
  };
  root.childNodes.forEach(visit);
  return matches;
}

function allDescendantsByTag(root: HtmlElement, tags: ReadonlySet<string>) {
  const matches: HtmlElement[] = [];
  const visit = (node: HtmlNode) => {
    if (isElement(node) && tags.has(node.tagName)) matches.push(node);
    childNodes(node).forEach(visit);
  };
  root.childNodes.forEach(visit);
  return matches;
}

function directSiblingRows(row: HtmlElement) {
  const parent = row.parentNode;
  if (!parent || !("childNodes" in parent)) return [];
  return parent.childNodes.filter(
    (node): node is HtmlElement => isElement(node) && node.tagName === "tr",
  );
}

function scriptDigit(character: string, tagName: string | null) {
  const digit = Number.parseInt(character, 10);
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) return character;
  if (tagName === "sup") return Array.from(SUPERSCRIPT_DIGITS)[digit];
  if (tagName === "sub") return Array.from(SUBSCRIPT_DIGITS)[digit];
  return character;
}

function textContent(
  node: HtmlNode,
  options: { stripLeaves?: boolean; nestedTable?: boolean; script?: string | null } = {},
): string {
  if (isTextNode(node)) {
    const value = "value" in node ? node.value : "";
    const converted = Array.from(value, (character) => scriptDigit(character, options.script ?? null)).join("");
    return options.stripLeaves ? converted.trim() : converted;
  }
  if (!isElement(node)) return "";
  if (node.tagName === "br") return " ";

  if (options.nestedTable && node.tagName === "table") {
    const pieces: string[] = [];
    const collect = (nested: HtmlNode) => {
      if (isTextNode(nested)) {
        const value = "value" in nested ? nested.value.trim() : "";
        if (value) pieces.push(value);
        return;
      }
      childNodes(nested).forEach(collect);
    };
    node.childNodes.forEach(collect);
    return pieces.join(" ");
  }

  const script = node.tagName === "sup" || node.tagName === "sub"
    ? node.tagName
    : options.script ?? null;
  return node.childNodes.map((child) => textContent(child, { ...options, script })).join("");
}

function strippedText(element: HtmlElement) {
  return element.childNodes
    .map((node) => textContent(node, { stripLeaves: true }))
    .join("")
    .trim();
}

function cellText(element: HtmlElement) {
  return element.childNodes
    .map((node) => textContent(node, { nestedTable: true }))
    .join("")
    .trim();
}

function tableRows(table: HtmlElement) {
  return descendantsByTag(table, new Set(["tr"]));
}

function rowCells(row: HtmlElement) {
  return descendantsByTag(row, new Set(["th", "td"]));
}

function parseTableElement(table: HtmlElement): TableGrid | null {
  const rows = tableRows(table);
  if (!rows.length) return null;
  const firstTableHead = descendantsByTag(table, new Set(["thead"]))[0];
  const tableHeadRows = new Set(
    firstTableHead ? descendantsByTag(firstTableHead, new Set(["tr"])) : [],
  );

  const occupied = new Map<string, string>();
  const headerRows = new Set<number>();
  const headerCells = new Set<string>();
  const columnHeaders = new Map<number, Array<[number, string]>>();

  rows.forEach((row, rowIndex) => {
    // BeautifulSoup's parser, and therefore ParseBench, treats every row in
    // <thead> as a header row even when a producer used <td> instead of <th>.
    if (tableHeadRows.has(row)) headerRows.add(rowIndex);
    let columnIndex = 0;
    for (const cell of rowCells(row)) {
      while (occupied.has(`${rowIndex}:${columnIndex}`)) columnIndex += 1;
      const value = cellText(cell);
      const rowSpan = positiveSpan(cell, "rowspan");
      const columnSpan = positiveSpan(cell, "colspan");
      const header = cell.tagName === "th";
      if (header) headerRows.add(rowIndex);

      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
        for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) {
          const rowPosition = rowIndex + rowOffset;
          const columnPosition = columnIndex + columnOffset;
          occupied.set(`${rowPosition}:${columnPosition}`, value);
          if (header) headerCells.add(`${rowPosition}:${columnPosition}`);
        }
      }
      if (header) {
        for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) {
          const column = columnIndex + columnOffset;
          const entries = columnHeaders.get(column) ?? [];
          entries.push([rowIndex, value]);
          columnHeaders.set(column, entries);
        }
      }
      columnIndex += columnSpan;
    }
  });

  if (!occupied.size) return null;
  let rowCount = 0;
  let columnCount = 0;
  for (const key of occupied.keys()) {
    const [row, column] = key.split(":").map(Number);
    rowCount = Math.max(rowCount, row + 1);
    columnCount = Math.max(columnCount, column + 1);
  }
  const cells = Array.from({ length: rowCount }, (_, row) =>
    Array.from({ length: columnCount }, (_, column) => occupied.get(`${row}:${column}`) ?? ""),
  );
  return { cells, headerRows, headerCells, columnHeaders };
}

function parseTableFragment(markup: string) {
  const fragment = parseHtmlFragment(markup);
  if (!fragment) return null;
  const tables = topLevelTables(fragment);
  if (tables.length !== 1) return null;
  return parseTableElement(tables[0]);
}

export function structuredTableFragments(markdown: string) {
  // ParseBench identifies top-level HTML tables with a depth-aware string
  // scan before it parses their cells. Keep that first stage byte-for-byte
  // compatible so malformed output fails closed instead of being remapped.
  const tables: string[] = [];
  const lower = markdown.toLowerCase();
  let searchStart = 0;
  while (searchStart < lower.length) {
    const start = lower.indexOf("<table", searchStart);
    if (start === -1) break;
    const tagNameEnd = start + "<table".length;
    if (tagNameEnd < lower.length && ![">", " ", "\t", "\n", "\r"].includes(lower[tagNameEnd])) {
      searchStart = start + 1;
      continue;
    }

    let depth = 0;
    let position = start;
    let end = -1;
    while (position < lower.length) {
      const nextOpen = lower.indexOf("<table", position + 1);
      const nextClose = lower.indexOf("</table>", position + 1);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        const nestedNameEnd = nextOpen + "<table".length;
        if (
          nestedNameEnd < lower.length &&
          ![">", " ", "\t", "\n", "\r"].includes(lower[nestedNameEnd])
        ) {
          position = nextOpen;
          continue;
        }
        depth += 1;
        position = nextOpen;
      } else if (depth === 0) {
        end = nextClose + "</table>".length;
        break;
      } else {
        depth -= 1;
        position = nextClose;
      }
    }
    if (end === -1) {
      tables.push(markdown.slice(start));
      break;
    }
    tables.push(markdown.slice(start, end));
    searchStart = end;
  }
  return tables.map((table) => table.trim()).filter(Boolean);
}

function mapCharacters(value: string, mapping: ReadonlyMap<string, string>) {
  return Array.from(value, (character) => mapping.get(character) ?? character).join("");
}

function isProtectedCombiningBase(character: string) {
  const codePoint = character.codePointAt(0) ?? 0;
  return (
    (codePoint >= 0x3040 && codePoint <= 0x309f) ||
    (codePoint >= 0x30a0 && codePoint <= 0x30ff) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
    (codePoint >= 0x1100 && codePoint <= 0x11ff) ||
    (codePoint >= 0x0b80 && codePoint <= 0x0bff) ||
    (codePoint >= 0x0c80 && codePoint <= 0x0cff)
  );
}

function normalizeText(value: string) {
  let normalized = mapCharacters(mapCharacters(value, SUPERSCRIPT_TO_ASCII), SUBSCRIPT_TO_ASCII);
  normalized = normalized.replace(
    /<((?:https?:\/\/|mailto:)[^>\s]+|[^>@\s]+@[^>@\s]+\.[^>@\s]+)>/gi,
    "$1",
  );
  normalized = normalized.replace(/<br\s*\/?>/gi, " ");
  normalized = Array.from(normalized, (character) => {
    if (SINGLE_QUOTES.has(character)) return "'";
    if (DOUBLE_QUOTES.has(character)) return '"';
    return FULLWIDTH_PUNCTUATION.get(character) ?? character;
  }).join("");
  normalized = normalized.replace(/\s+/g, " ");
  normalized = normalized.replace(/\*\*(.*?)\*\*/g, "$1");
  normalized = normalized.replace(/__(.*?)__/g, "$1");
  normalized = normalized.replace(/<\/?[bi]>/gi, "");
  normalized = normalized.replace(/\*(.*?)\*/g, "$1");
  normalized = normalized.replace(/_(.*?)_/g, "$1");
  normalized = normalized.replaceAll("_", " ");

  const decomposed = Array.from(normalized.normalize("NFD"));
  const accentStripped: string[] = [];
  for (const character of decomposed) {
    if (!/\p{Mn}/u.test(character)) {
      accentStripped.push(character);
    } else if (accentStripped.length && isProtectedCombiningBase(accentStripped.at(-1) ?? "")) {
      accentStripped.push(character);
    }
  }
  normalized = accentStripped.join("").normalize("NFC");
  normalized = normalized
    .replaceAll("＿", "_")
    .replace(/[–—‑‒−]/g, "-")
    .replaceAll("…", "...")
    .replace(/<\/?(?:ins|u|mark)>/gi, "")
    .replaceAll("~~", "")
    .replace(/\$\$/g, "")
    .replaceAll("µ", "μ");
  normalized = mapCharacters(normalized, SYMBOL_EQUIVALENTS);
  normalized = normalized.replace(/<\/?(?:s|del|strike)>/gi, "");
  normalized = normalized.replace(/<\/?span\b[^>]*>/gi, "");
  normalized = normalized.replace(/<sup[^>]*>.*?<\/sup>/gi, "");
  normalized = normalized.replace(/<sub[^>]*>.*?<\/sub>/gi, "");
  normalized = normalized.replace(/[¹²³⁰⁴-⁹]+/g, "");
  normalized = normalized.replace(/[₀-₉]+/g, "");
  normalized = normalized.replace(/-{2,}/g, "-");
  normalized = normalized.replace(/\.{2,}\s*$/g, "");
  return normalized.toLowerCase();
}

function normalizeCell(value: string) {
  let normalized = normalizeText(value);
  normalized = normalized.replace(/(?:\.\s){2,}\.?/g, "");
  normalized = normalized.replace(/\.{2,}/g, "");
  normalized = normalized.replace(/ {2,}/g, " ").trim();
  normalized = normalized.replace(/\$\s+/g, "$");
  normalized = normalized.replace(/\s+%/g, "%");
  normalized = normalized.replace(/\s+\(/g, "(");
  normalized = normalized.replace(/\s+\)/g, ")");
  normalized = normalized.replace(/\s+®/g, "®");
  normalized = normalized.replace(/(\d),(\d)/g, "$1$2");
  return normalized;
}

function projectGrid(grid: TableGrid, columns: number[]) {
  const oldToNew = new Map(columns.map((column, index) => [column, index]));
  const columnHeaders = new Map<number, Array<[number, string]>>();
  columns.forEach((oldColumn, newColumn) => {
    const entries = grid.columnHeaders.get(oldColumn);
    if (entries) columnHeaders.set(newColumn, entries.map(([row, value]) => [row, value]));
  });
  const headerCells = new Set<string>();
  for (const key of grid.headerCells) {
    const [row, oldColumn] = key.split(":").map(Number);
    const newColumn = oldToNew.get(oldColumn);
    if (newColumn != null) headerCells.add(`${row}:${newColumn}`);
  }
  return {
    cells: grid.cells.map((row) => columns.map((column) => row[column] ?? "")),
    headerRows: new Set(grid.headerRows),
    headerCells,
    columnHeaders,
  } satisfies TableGrid;
}

function normalizeGrid(grid: TableGrid): SplitTable {
  const normalizedCells = grid.cells.map((row) => row.map(normalizeCell));
  const normalizedHeaders = new Map<number, Array<[number, string]>>();
  for (const [column, entries] of grid.columnHeaders) {
    normalizedHeaders.set(
      column,
      entries.map(([row, value]) => [row, normalizeCell(value)]),
    );
  }
  const columnCount = normalizedCells[0]?.length ?? 0;
  const keepColumns = Array.from({ length: columnCount }, (_, index) => index).filter((column) => {
    const dataEmpty = normalizedCells.every((row) => (row[column] ?? "") === "");
    const headersEmpty = (normalizedHeaders.get(column) ?? []).every(([, value]) => value === "");
    return !dataEmpty || !headersEmpty;
  });
  const normalized = projectGrid(
    { ...grid, cells: normalizedCells, columnHeaders: normalizedHeaders },
    keepColumns,
  );
  return { normalized, display: projectGrid(grid, keepColumns) };
}

function detectedColumnHeaderRows(grid: TableGrid) {
  const rowCount = grid.cells.length;
  const columnCount = grid.cells[0]?.length ?? 0;
  if (!rowCount || !columnCount) return new Set<number>();

  const titleRows = new Set<number>();
  if (columnCount > 1) {
    for (let row = 0; row < rowCount; row += 1) {
      if (grid.headerRows.has(row)) break;
      const values = grid.cells[row].map((value) => value.trim());
      const nonEmpty = new Set(values.filter(Boolean));
      if (nonEmpty.size === 1 && values.every(Boolean)) titleRows.add(row);
      else break;
    }
    if (titleRows.size === rowCount) titleRows.clear();
  }

  const firstHeader = titleRows.size ? Math.max(...titleRows) + 1 : 0;
  let leadingHeaderEnd = firstHeader;
  for (let row = firstHeader; row < rowCount; row += 1) {
    if (!grid.headerRows.has(row)) break;
    const hasNonHeaderContent = grid.cells[row].some(
      (value, column) => value.trim() && !grid.headerCells.has(`${row}:${column}`),
    );
    if (hasNonHeaderContent) break;
    leadingHeaderEnd = row + 1;
  }
  const headerRows = new Set(
    Array.from({ length: leadingHeaderEnd }, (_, index) => index).filter((row) => grid.headerRows.has(row)),
  );
  if (headerRows.size) {
    const bottom = Math.max(...headerRows);
    if (grid.cells[bottom].some(
      (value, column) => value.trim() && !grid.headerCells.has(`${bottom}:${column}`),
    )) {
      headerRows.delete(bottom);
    }
  }
  return headerRows;
}

function resolvedHeaderValues(grid: TableGrid) {
  const columnCount = grid.cells[0]?.length ?? 0;
  return [...detectedColumnHeaderRows(grid)]
    .sort((left, right) => left - right)
    .map((row) => Array.from({ length: columnCount }, (_, column) => {
      const entry = (grid.columnHeaders.get(column) ?? []).find(([entryRow]) => entryRow === row);
      return entry ? normalizeCell(entry[1].trim()) : "";
    }));
}

function similarityRatio(left: string, right: string) {
  if (!left.length && !right.length) return 1;
  if (!left.length || !right.length) return 0;
  const leftChars = Array.from(left);
  const rightChars = Array.from(right);
  const shorter = leftChars.length <= rightChars.length ? leftChars : rightChars;
  const longer = leftChars.length <= rightChars.length ? rightChars : leftChars;
  let previous = new Uint32Array(shorter.length + 1);
  for (const longCharacter of longer) {
    const current = new Uint32Array(shorter.length + 1);
    for (let index = 1; index <= shorter.length; index += 1) {
      current[index] = longCharacter === shorter[index - 1]
        ? previous[index - 1] + 1
        : Math.max(previous[index], current[index - 1]);
    }
    previous = current;
  }
  return (2 * previous[shorter.length]) / (leftChars.length + rightChars.length);
}

function rowRepeats(values: string[], period: number) {
  const first = values.slice(0, period);
  const segments = values.length / period;
  for (let segment = 1; segment < segments; segment += 1) {
    const candidate = values.slice(segment * period, (segment + 1) * period);
    let matches = 0;
    for (let index = 0; index < period; index += 1) {
      const left = first[index] ?? "";
      const right = candidate[index] ?? "";
      if ((!left && !right) || similarityRatio(left.toLowerCase(), right.toLowerCase()) >= COLUMN_MATCH_THRESHOLD) {
        matches += 1;
      }
    }
    if (matches < period * 0.8) return false;
  }
  return true;
}

function sliceGrid(grid: TableGrid, start: number, end: number, retainedRows: number) {
  const columns = Array.from({ length: end - start }, (_, index) => start + index);
  const projected = projectGrid(grid, columns);
  const headerRows = new Set([...projected.headerRows].filter((row) => row < retainedRows));
  const headerCells = new Set(
    [...projected.headerCells].filter((key) => Number(key.split(":")[0]) < retainedRows),
  );
  const columnHeaders = new Map<number, Array<[number, string]>>();
  for (const [column, entries] of projected.columnHeaders) {
    const retained = entries.filter(([row]) => row < retainedRows);
    if (retained.length) columnHeaders.set(column, retained);
  }
  return {
    cells: projected.cells.slice(0, retainedRows),
    headerRows,
    headerCells,
    columnHeaders,
  } satisfies TableGrid;
}

function splitTable(table: SplitTable, period: number) {
  const columnCount = table.normalized.cells[0]?.length ?? 0;
  const tables: SplitTable[] = [];
  for (let start = 0; start < columnCount; start += period) {
    const end = start + period;
    const normalizedColumns = table.normalized.cells.map((row) => row.slice(start, end));
    let retainedRows = normalizedColumns.length;
    while (retainedRows > 0 && normalizedColumns[retainedRows - 1].every((value) => !value.trim())) {
      retainedRows -= 1;
    }
    tables.push({
      normalized: sliceGrid(table.normalized, start, end, retainedRows),
      display: sliceGrid(table.display, start, end, retainedRows),
    });
  }
  return tables;
}

function splitOptions(table: SplitTable) {
  const options: SplitOption[] = [{
    segmentCount: 1,
    repeatingRows: 0,
    period: 0,
    tables: null,
  }];
  const columnCount = table.normalized.cells[0]?.length ?? 0;
  const headerRows = resolvedHeaderValues(table.normalized);
  if (!headerRows.length || columnCount < 2) return options;

  for (let period = 1; period <= Math.floor(columnCount / 2); period += 1) {
    if (columnCount % period !== 0) continue;
    const segmentCount = columnCount / period;
    if (segmentCount < 2) continue;
    const repeatingRows = headerRows.filter((row) => rowRepeats(row, period)).length;
    if (!repeatingRows) continue;
    options.push({
      segmentCount,
      repeatingRows,
      period,
      tables: splitTable(table, period),
    });
  }
  return options;
}

function scoreOptionCombination(options: SplitOption[], expectedTableCount: number) {
  return [
    Math.abs(options.reduce((sum, option) => sum + option.segmentCount, 0) - expectedTableCount),
    -options.reduce((sum, option) => sum + option.repeatingRows, 0),
    -options.reduce((sum, option) => sum + option.period, 0),
  ] as const;
}

function scoreBefore(left: readonly number[], right: readonly number[]) {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index];
  }
  return false;
}

function selectSplitOptions(tables: SplitTable[], expectedTableCount: number): SplitOption[] | null {
  const perTable = tables.map(splitOptions);
  if (perTable.every((options) => options.length === 1)) return null;
  if (perTable.reduce((product, options) => product * options.length, 1) > SPLIT_COMBINATION_LIMIT) {
    return null;
  }

  let best: SplitOption[] | null = null;
  let bestScore: readonly number[] | null = null;
  const choose = (tableIndex: number, current: SplitOption[]) => {
    if (tableIndex === perTable.length) {
      const score = scoreOptionCombination(current, expectedTableCount);
      if (bestScore == null || scoreBefore(score, bestScore)) {
        best = [...current];
        bestScore = score;
      }
      return;
    }
    for (const option of perTable[tableIndex]) {
      current.push(option);
      choose(tableIndex + 1, current);
      current.pop();
    }
  };
  choose(0, []);
  const baseline = [Math.abs(tables.length - expectedTableCount), 0, 0] as const;
  const selected = best as SplitOption[] | null;
  const selectedScore = bestScore as readonly number[] | null;
  return selected && selectedScore && scoreBefore(selectedScore, baseline) ? selected : null;
}

function expectedTableTitles(expectedMarkdown: string) {
  const fragment = parseHtmlFragment(expectedMarkdown);
  if (!fragment) return null;
  const titles: string[] = [];
  for (const table of allTables(fragment)) {
    const rows = tableRows(table);
    const firstRow = rows[0];
    if (!firstRow) continue;
    const firstCells = allDescendantsByTag(firstRow, new Set(["th", "td"]));
    if (firstCells.length !== 1 || positiveSpan(firstCells[0], "colspan") <= 1) continue;
    const siblings = directSiblingRows(firstRow);
    const rowIndex = siblings.indexOf(firstRow);
    const secondRow = rowIndex >= 0 ? siblings[rowIndex + 1] : null;
    if (!secondRow) continue;
    const width = allDescendantsByTag(secondRow, new Set(["th", "td"]))
      .reduce((sum, cell) => sum + positiveSpan(cell, "colspan"), 0);
    if (positiveSpan(firstCells[0], "colspan") < width) continue;
    const title = strippedText(firstCells[0]);
    if (title) titles.push(title);
  }
  return titles;
}

function precedingSiblingText(table: HtmlElement) {
  const parent = table.parentNode;
  if (!parent || !("childNodes" in parent)) return "";
  const index = parent.childNodes.indexOf(table);
  for (let siblingIndex = index - 1; siblingIndex >= 0; siblingIndex -= 1) {
    const sibling = parent.childNodes[siblingIndex];
    if (isTextNode(sibling) && !("value" in sibling && sibling.value.trim())) continue;
    if (isElement(sibling)) return strippedText(sibling);
    return isTextNode(sibling) && "value" in sibling ? sibling.value.trim() : "";
  }
  return "";
}

function sourceTableColumnCount(table: HtmlElement) {
  return allDescendantsByTag(table, new Set(["tr"])).reduce(
    (maximum, row) => Math.max(
      maximum,
      allDescendantsByTag(row, new Set(["th", "td"]))
        .reduce((sum, cell) => sum + positiveSpan(cell, "colspan"), 0),
    ),
    0,
  );
}

function prependTitle(grid: TableGrid, title: string, titleColumnSpan: number) {
  const sourceColumnCount = grid.cells[0]?.length ?? 0;
  const columnCount = Math.max(sourceColumnCount, titleColumnSpan);
  const columnHeaders = new Map<number, Array<[number, string]>>();
  for (let column = 0; column < columnCount; column += 1) {
    const entries = (grid.columnHeaders.get(column) ?? [])
      .map(([row, value]) => [row + 1, value] as [number, string]);
    if (column < titleColumnSpan) entries.unshift([0, title]);
    if (entries.length) columnHeaders.set(column, entries);
  }
  return {
    cells: [
      Array.from({ length: columnCount }, (_, column) => column < titleColumnSpan ? title : ""),
      ...grid.cells.map((row) => [
        ...row,
        ...Array.from({ length: columnCount - row.length }, () => ""),
      ]),
    ],
    headerRows: new Set([0, ...[...grid.headerRows].map((row) => row + 1)]),
    headerCells: new Set([
      ...Array.from({ length: titleColumnSpan }, (_, column) => `0:${column}`),
      ...[...grid.headerCells].map((key) => {
        const [row, column] = key.split(":").map(Number);
        return `${row + 1}:${column}`;
      }),
    ]),
    columnHeaders,
  } satisfies TableGrid;
}

function parsedOutputTables(actualMarkdown: string, expectedMarkdown: string) {
  const sourceTables = structuredTableFragments(actualMarkdown);
  const parsed = sourceTables.map(parseTableFragment);
  if (parsed.some((table) => table == null)) return null;

  const expectedTitles = expectedTableTitles(expectedMarkdown);
  if (!expectedTitles) return null;
  const actualDocument = parseHtmlFragment(actualMarkdown);
  if (!actualDocument) return null;
  const documentTables = topLevelTables(actualDocument);
  if (documentTables.length !== parsed.length) return null;

  return parsed.map((table, index): ParsedOutputTable => {
    let grid = table as TableGrid;
    const domTable = documentTables[index];
    const firstRow = tableRows(domTable)[0];
    const firstCells = firstRow
      ? allDescendantsByTag(firstRow, new Set(["th", "td"]))
      : [];
    const alreadyTitled = firstCells.length === 1 && positiveSpan(firstCells[0], "colspan") > 1;
    if (!alreadyTitled && expectedTitles.length) {
      const preceding = precedingSiblingText(domTable);
      const matches = preceding && expectedTitles.some(
        (title) => similarityRatio(normalizeText(preceding), normalizeText(title)) >= 0.8,
      );
      const titleColumnSpan = sourceTableColumnCount(domTable);
      if (matches && titleColumnSpan >= 2) {
        grid = prependTitle(grid, preceding, titleColumnSpan);
      }
    }
    return { grid, sourceMarkup: sourceTables[index] };
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function tableMarkup(grid: TableGrid) {
  const rows = grid.cells.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const tag = grid.headerCells.has(`${rowIndex}:${columnIndex}`) ? "th" : "td";
      return `<${tag}>${escapeHtml(value)}</${tag}>`;
    });
    return `<tr>${cells.join("")}</tr>`;
  });
  return `<table><tbody>${rows.join("")}</tbody></table>`;
}

function validPairing(pairing: Array<[number, number | null]>, expectedCount: number, outputCount: number) {
  const expectedIndexes = new Set<number>();
  const outputIndexes = new Set<number>();
  for (const [expectedIndex, outputIndex] of pairing) {
    if (!Number.isInteger(expectedIndex) || expectedIndex < 0 || expectedIndex >= expectedCount) return false;
    if (expectedIndexes.has(expectedIndex)) return false;
    expectedIndexes.add(expectedIndex);
    if (outputIndex == null) continue;
    if (!Number.isInteger(outputIndex) || outputIndex < 0 || outputIndex >= outputCount) return false;
    if (outputIndexes.has(outputIndex)) return false;
    outputIndexes.add(outputIndex);
  }
  return expectedIndexes.size === expectedCount;
}

export function reconstructSplitTableOutput(input: ReconstructionInput): OutputTablePreview[] | null {
  if (
    input.rawOutputTableCount < 1 ||
    input.scoredOutputTableCount <= input.rawOutputTableCount ||
    input.unparseableOutputTableCount !== 0 ||
    structuredTableFragments(input.expectedMarkdown).length !== input.expectedTableCount
  ) {
    return null;
  }
  const outputTables = parsedOutputTables(input.actualMarkdown, input.expectedMarkdown);
  if (!outputTables || outputTables.length !== input.rawOutputTableCount) return null;

  const selected = selectSplitOptions(
    outputTables.map((table) => normalizeGrid(table.grid)),
    input.expectedTableCount,
  );
  if (!selected) return null;

  const reconstructed: OutputTablePreview[] = [];
  selected.forEach((option, index) => {
    if (option.tables == null) {
      const source = outputTables[index];
      reconstructed.push({
        // An unsplit table still has meaningful source HTML. Title merging is
        // used above only to reproduce the evaluator's selection input; keep
        // the original preview and reserve the derived label for real splits.
        markdown: source.sourceMarkup,
        reconstructed: false,
      });
      return;
    }
    option.tables.forEach((table) => {
      reconstructed.push({ markdown: tableMarkup(table.display), reconstructed: true });
    });
  });
  if (reconstructed.length !== input.scoredOutputTableCount) return null;
  if (!validPairing(input.pairing, input.expectedTableCount, reconstructed.length)) return null;
  return reconstructed;
}
