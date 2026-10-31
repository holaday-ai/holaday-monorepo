/**
 * The browser tools the model is offered (cloud browser and Chrome extension). Kept here so
 * the tool-call markup filter (tool-call-markup.ts) recognises exactly these names.
 */
export const UNIFIED_BROWSER_TOOL_NAMES = [
  'snapshot',
  'click',
  'type',
  'select',
  'scroll',
  'navigate',
  'extract',
  'screenshot',
  'wait_for',
  'back',
  'download',
  'upload',
  'click_at',
  'press_key',
  'list_tabs',
  'new_tab',
  'switch_tab',
  'close_tab',
] as const;

/** Only offered to the cloud lane when BROWSER_OBSERVATION_V2 is enabled. */
export const OBSERVATION_TOOL_NAMES = [
  'read_page',
  'sections',
  'get_page_text',
  'links',
  'tables',
  'scroll_until',
  'list_tabs',
  'switch_tab',
] as const;

/** Every tool name a model call can carry: the browser tools plus the loop's own. */
export const MODEL_TOOL_NAMES: readonly string[] = [
  ...new Set([
    ...UNIFIED_BROWSER_TOOL_NAMES,
    ...OBSERVATION_TOOL_NAMES,
    'request_human',
    'finish',
    'web_search',
  ]),
];
