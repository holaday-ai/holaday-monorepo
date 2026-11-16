import type { Frame } from 'playwright';

/**
 * GOAL2 H1 (G6 r5 dm-gugong-ticket): 故宫's 票价及优惠政策 has two tabs made of plain spans
 * (`<span class="s1 now">大门票优惠政策</span><span class="s2">钟表馆、珍宝馆票价优惠政策</span>`) over one
 * list with no heading of its own. The snapshot reads both names on one line and then one list: after
 * a click on the second tab nothing says the list is that tab's, and an answer gave the halls'
 * 「学生票 5 元」 as the main ticket's. The snapshot now says which tab is the selected one, right
 * under the names (a role=tab already carries `[selected]` and is left alone).
 */
export const SELECTED_TAB_LEAD = '当前选中的标签：';

/** In-page: groups of 2–6 short sibling labels with exactly one marked as the current one. */
function selectedTabGroups(): Array<{ names: string[]; selected: string }> {
  const out: Array<{ names: string[]; selected: string }> = [];
  const active =
    /(?:^|\s)(?:now|active|current|cur|on|selected|is-active|is-selected|tab-active|actived|checked)(?:$|\s)/i;
  const boxes = document.querySelectorAll('ul,ol,div,nav,p');
  for (let at = 0; at < boxes.length && at < 6000 && out.length < 6; at += 1) {
    const kids = Array.from(boxes[at]!.children);
    if (kids.length < 2 || kids.length > 6) continue;
    const names = kids.map((kid) => (kid.textContent ?? '').trim().replace(/\s+/g, ' '));
    if (names.some((name) => name.length < 2 || name.length > 20)) continue;
    if (new Set(names).size !== names.length) continue;
    if (kids.some((kid) => kid.getAttribute('role') === 'tab')) continue;
    if (!kids.every((kid) => kid.getClientRects().length)) continue;
    const selected = kids.filter(
      (kid) =>
        kid.getAttribute('aria-selected') === 'true' ||
        active.test(kid.getAttribute('class') ?? ''),
    );
    if (selected.length !== 1) continue;
    out.push({ names, selected: names[kids.indexOf(selected[0]!)]! });
  }
  return out;
}

/** A snapshot line's own text: 「- text: 大门票优惠政策 钟表馆、珍宝馆票价优惠政策」 → the names. */
const lineText = (line: string) =>
  line
    .replace(/^\s*-\s+(?:[a-z]+\b)?(?:\s+"[^"]*")?(?:\s*\[[^\]]*\])*\s*:?\s*/i, '')
    .replace(/^"|"$/g, '')
    .trim();

/** Puts 「当前选中的标签：X」 under each line that is exactly a group's tab names. */
export function withSelectedTabs(
  tree: string,
  groups: ReadonlyArray<{ names: string[]; selected: string }>,
): string {
  if (!groups.length) return tree;
  const lines = tree.split('\n');
  const out: string[] = [];
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at]!;
    // One name per line (the real 故宫 snapshot: `- generic [ref=e276] [cursor=pointer]: 大门票优惠政策`).
    const run = groups.find((one) =>
      one.names.every((name, i) => lineText(lines[at + i] ?? '').replace(/\s+/g, ' ') === name),
    );
    if (run) {
      out.push(...lines.slice(at, at + run.names.length));
      const indent = line.match(/^\s*/)?.[0] ?? '';
      out.push(`${indent}- text: ${SELECTED_TAB_LEAD}${run.selected}`);
      at += run.names.length - 1;
      continue;
    }
    const text = lineText(line);
    const bare = text.replace(/\s+/g, '');
    const group = bare && groups.find((one) => one.names.join('').replace(/\s+/g, '') === bare);
    if (!group) {
      out.push(line);
      continue;
    }
    // Names the page sets apart only by markup (no space between the spans) read apart.
    out.push(text && line.includes(text) ? line.replace(text, group.names.join(' ')) : line);
    const indent = line.match(/^\s*/)?.[0] ?? '';
    out.push(`${indent}- text: ${SELECTED_TAB_LEAD}${group.selected}`);
  }
  return out.join('\n');
}

export async function markSelectedTabs(frame: Frame, tree: string): Promise<string> {
  const groups = await frame
    .evaluate(selectedTabGroups)
    .catch(() => [] as Array<{ names: string[]; selected: string }>);
  return withSelectedTabs(tree, groups);
}
