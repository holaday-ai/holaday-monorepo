/**
 * REBUILD-3: blocks of the pages a run read, for the price contract's checks.
 *
 * `block_ref` is the snapshot node ref the browser issued (`e123`, `f1e5` inside a frame;
 * optionally `<tabId>/e123`). It is the most robust identifier the loop already has: the
 * executor writes it into every snapshot / read_page tree (`[ref=e123]`), the model already
 * uses it for every click, and a node's subtree is the card / list item / table row it heads.
 * The block of a ref is the visible text of that node and everything indented under it.
 *
 * Reads without refs (get_page_text, read_url, tables) use `block_ref: "text"`: the block is the
 * quote itself, so name, variant and price must all sit in one contiguous run of page text.
 */

export interface ReadPage {
  text: string;
  tabId?: string;
  sourceURL?: string;
}

/** One node of a block: its role, visible text, depth and state flags. */
export interface BlockNode {
  indent: number;
  role: string;
  text: string;
  /** `[selected]`, `[pressed]`, `[checked]` (also `=true`). */
  selected: boolean;
}

export interface ReadBlock {
  /** Visible text of the node and its subtree, one node per line. */
  text: string;
  /** The head node and every node under it, in order (url lines left out). */
  nodes: BlockNode[];
  /** The node's own snapshot lines as read (markup kept). */
  raw: string;
  /** Link targets under the node, resolved against the page address. */
  links: string[];
  page: ReadPage;
}

export const TEXT_BLOCK_REF = 'text';

const REF_RE = /^(?:([\w.:-]{1,64})[/#])?((?:f\d+)?e\d{1,6})$/i;

/** `e123`, `f1e5`, `<tabId>/e123`; null for anything else (e.g. `text`). */
export function parseBlockRef(blockRef: string): { tabId?: string; ref: string } | null {
  const match = REF_RE.exec(blockRef.trim().replace(/^\[?ref=|\]$/g, ''));
  if (!match) return null;
  return { ...(match[1] ? { tabId: match[1] } : {}), ref: match[2]!.toLowerCase() };
}

/** Comparable form: NFKC, one space for any whitespace run, lower case, no thousands commas. */
export function flatText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const ROLES = new Set(
  (
    'alert alertdialog application article banner blockquote button caption cell checkbox code ' +
    'columnheader combobox complementary contentinfo definition deletion dialog directory document ' +
    'emphasis feed figure form generic grid gridcell group heading img insertion iframe link list ' +
    'listbox listitem log main mark marquee math menu menubar menuitem menuitemcheckbox ' +
    'menuitemradio meter navigation none note option paragraph presentation progressbar radio ' +
    'radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider ' +
    'spinbutton status strong subscript superscript switch tab table tablist tabpanel term ' +
    'textbox time timer toolbar tooltip tree treegrid treeitem text'
  ).split(' '),
);

interface AriaNode {
  indent: number;
  role?: string;
  ref?: string;
  text: string;
  url?: string;
  selected?: boolean;
}

const SELECTED_ATTR = /^(?:selected|pressed|checked)(?:=true)?$/;

/** Reads a JSON-style quoted string at `at`; returns its value and the index after it. */
function quotedAt(body: string, at: number): { value: string; end: number } | null {
  if (body[at] !== '"') return null;
  for (let i = at + 1; i < body.length; i += 1) {
    if (body[i] === '\\') {
      i += 1;
      continue;
    }
    if (body[i] === '"') {
      const raw = body.slice(at, i + 1);
      try {
        return { value: JSON.parse(raw) as string, end: i + 1 };
      } catch {
        return { value: raw.slice(1, -1), end: i + 1 };
      }
    }
  }
  return null;
}

const unquote = (value: string) => {
  const v = value.trim();
  if (v.startsWith('"')) return quotedAt(v, 0)?.value ?? v;
  return v;
};

/** One line of a Playwright AI aria snapshot, or null when the line is not one. */
function ariaNode(line: string): AriaNode | null {
  const match = /^(\s*)- (.*)$/.exec(line);
  if (!match) return null;
  const indent = match[1]!.length;
  let body = match[2]!;
  // YAML single-quoted lines: - 'link "Sponsored: …" [ref=e465]':
  const quoted = /^'(.*)'(:?)$/.exec(body);
  if (quoted) body = `${quoted[1]!.replace(/''/g, "'")}${quoted[2]}`;
  const url = /^\/url:\s*(.*)$/.exec(body);
  if (url) return { indent, text: '', url: unquote(url[1]!) };
  if (/^\/[a-z]+:/.test(body)) return { indent, text: '' };
  const role = /^([a-z][a-z-]*)(?=$|[\s:[])/.exec(body);
  const hasRef = /\[ref=(?:f\d+)?e\d+\]/.test(body);
  if (!role || (!ROLES.has(role[1]!) && !hasRef)) return null;
  let rest = body.slice(role[1]!.length);
  const parts: string[] = [];
  let ref: string | undefined;
  let selected = false;
  for (;;) {
    rest = rest.replace(/^\s+/, '');
    if (!rest) break;
    if (rest.startsWith('"')) {
      const q = quotedAt(rest, 0);
      if (!q) {
        parts.push(rest);
        break;
      }
      parts.push(q.value);
      rest = rest.slice(q.end);
      continue;
    }
    if (rest.startsWith('[')) {
      const end = rest.indexOf(']');
      if (end < 0) break;
      const attr = rest.slice(1, end);
      const refAttr = /^ref=((?:f\d+)?e\d+)$/.exec(attr);
      if (refAttr) ref = refAttr[1]!.toLowerCase();
      if (SELECTED_ATTR.test(attr)) selected = true;
      rest = rest.slice(end + 1);
      continue;
    }
    if (rest.startsWith(':')) {
      const inline = rest.slice(1).trim();
      if (inline) parts.push(unquote(inline));
      break;
    }
    // Free text on the line (a non-standard tree): keep it up to the next attribute.
    const next = rest.search(/\s\[|:\s|:$/);
    parts.push(next < 0 ? rest : rest.slice(0, next));
    if (next < 0) break;
    rest = rest.slice(next);
  }
  return {
    indent,
    role: role[1]!,
    ...(ref ? { ref } : {}),
    ...(selected ? { selected } : {}),
    text: parts.filter(Boolean).join(' '),
  };
}

const toBlockNode = (node: AriaNode): BlockNode => ({
  indent: node.indent,
  role: node.role ?? 'text',
  text: node.text,
  selected: node.selected === true,
});

/** The visible text of a read: aria lines become their names and text, other lines stay. */
export function plainPageText(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const node = ariaNode(line);
      return node ? node.text : line;
    })
    .filter((line) => line.trim())
    .join('\n');
}

function resolveUrl(url: string, base: string | undefined): string | null {
  if (!url || url.includes('…')) return null;
  try {
    const resolved = new URL(url, base);
    return /^https?:$/.test(resolved.protocol) ? resolved.href : null;
  } catch {
    return null;
  }
}

/** The subtree a ref heads in one read, or null when the read has no such node. */
function blockIn(page: ReadPage, ref: string): ReadBlock | null {
  const lines = page.text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const head = ariaNode(lines[i]!);
    if (head?.ref !== ref) continue;
    const texts = head.text ? [head.text] : [];
    const nodes: BlockNode[] = [toBlockNode(head)];
    const links: string[] = [];
    let end = i + 1;
    for (let j = i + 1; j < lines.length; j += 1) {
      const node = ariaNode(lines[j]!);
      if (!node) {
        if (lines[j]!.trim()) break;
        continue;
      }
      if (node.indent <= head.indent) break;
      end = j + 1;
      if (node.url) {
        const url = resolveUrl(node.url, page.sourceURL);
        if (url) links.push(url);
      } else {
        if (node.role) nodes.push(toBlockNode(node));
        if (node.text) texts.push(node.text);
      }
    }
    return {
      text: texts.join('\n'),
      nodes,
      raw: lines.slice(i, end).join('\n'),
      links,
      page,
    };
  }
  return null;
}

/**
 * Every read block the ref names, newest read first. Refs restart per snapshot, so the same
 * ref may head different nodes in different reads; a tab-qualified ref keeps to that tab.
 */
export function blocksFor(blockRef: string, pages: readonly ReadPage[]): ReadBlock[] {
  const parsed = parseBlockRef(blockRef);
  if (!parsed) return [];
  const out: ReadBlock[] = [];
  for (let i = pages.length - 1; i >= 0; i -= 1) {
    const page = pages[i]!;
    if (parsed.tabId && page.tabId && page.tabId !== parsed.tabId) continue;
    const block = blockIn(page, parsed.ref);
    if (block) out.push(block);
  }
  return out;
}

/** The reads whose text (raw or visible) contains the quote, newest first. */
export function pagesQuoting(quote: string, pages: readonly ReadPage[]): ReadPage[] {
  const needle = flatText(quote);
  if (!needle) return [];
  return [...pages]
    .reverse()
    .filter(
      (page) =>
        flatText(page.text).includes(needle) || flatText(plainPageText(page.text)).includes(needle),
    );
}

/**
 * Review #1: what a product name may also come from — the page's own title. The `标题:` /
 * `Title:` line a read starts with, and every level-1 heading of that read.
 */
export function pageTitles(page: ReadPage): string[] {
  const titles: string[] = [];
  for (const line of page.text.split('\n')) {
    const titled = /^\s*(?:标题|title)\s*[:：]\s*(.+)$/i.exec(line);
    if (titled?.[1]) {
      titles.push(titled[1].trim());
      continue;
    }
    if (!/\[level=1\]/.test(line)) continue;
    const node = ariaNode(line);
    if (node?.role === 'heading' && node.text) titles.push(node.text);
  }
  return titles;
}
