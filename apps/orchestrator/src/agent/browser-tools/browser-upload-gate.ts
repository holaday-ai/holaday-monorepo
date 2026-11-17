import type { PreparedBrowserUpload } from './browser-upload-target.js';
import {
  type RuntimeActionDescriptor,
  type UnifiedActionDescription,
  type UnifiedActionGateOptions,
  createDescriptionActionGate,
} from './unified-action-gate.js';
import type { UnifiedBrowserAction } from './unified-tools.js';

/** Shared disclosure policy for a native handle or an extension-bound target. */
export interface PreparedUploadForGate {
  readonly description: PreparedBrowserUpload['description'] & { selectedCount?: number };
  runtimeAction(): RuntimeActionDescriptor;
  isCurrent(): Promise<boolean>;
  hostBinding(): NonNullable<UnifiedActionDescription['bindings']>[number];
}

export const uploadForbidden = (intent: string) =>
  /(?:不要|不得|禁止|勿|不许|不能)[^,，;；。\n]{0,8}(?:上传|导入)|\b(?:do not|don't|never)\s+(?:\w+\s+){0,2}(?:upload|import)\b|\bwithout\s+(?:uploading|importing)\b/i.test(
    intent,
  );
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Only a directly named upload destination can grant this disclosure without another prompt. */
export function explicitlyRequestsUpload(
  intent: string,
  target: PreparedBrowserUpload['description'],
  materials: readonly { fileId: string; name: string }[] = target.files,
  actualUrl = target.origin,
): boolean {
  if (
    uploadForbidden(intent) ||
    target.origin !== target.formOrigin ||
    target.files.some((file) => !materials.some((material) => material.fileId === file.fileId))
  )
    return false;
  // Complex/multiple directives and quoted instructions need the concrete host confirmation.
  if ((intent.match(/上传|导入|\bupload\b|\bimport\b/gi) ?? []).length !== 1) return false;
  const clean = intent.replace(/“[^”]*”|「[^」]*」|"[^"\n]*"|`[^`]*`/g, (text) =>
    /上传|导入|\bupload\b|\bimport\b/i.test(text) ? '' : text.slice(1, -1),
  );
  const clause = clean.split(/[,，;；。\n]/)[0]!.trim();
  const names = materials.map((file) => escapeRegex(file.name)).join('|') || '(?!)';
  const list = `(?:${names})(?:\\s*(?:、|和|与|and)\\s*(?:${names}))*`;
  const source = `(?:(?:附件|文件)\\s*)?${list}|(?:所有|全部|这些)?(?:附件|文件)`;
  const destination = '(https?:\\/\\/[^\\s,，;；。"<>]+|[a-z\\d-]+(?:\\.[a-z\\d-]+)+(?::\\d+)?)';
  const chinese = new RegExp(
    `^(?:请帮我|请|帮我)?\\s*(?:把|将)?\\s*(${source})\\s*(?:上传|导入)(?:到|至)\\s*${destination}\\s*(?:的?(?:文件控件|文件框|页面|后台))?$`,
    'i',
  );
  const english = new RegExp(
    `^(?:please\\s+)?(?:upload|import)\\s+((?:(?:the|these|my|attached|all)\\s+)*(?:${list}|files?|attachments?))\\s+to\\s+${destination}\\s*$`,
    'i',
  );
  const match = chinese.exec(clause) ?? english.exec(clause);
  if (!match) return false;
  const specified = materials.filter((file) => match[1]!.includes(file.name));
  if (
    specified.length &&
    target.files.some(
      (file) =>
        !specified.some((item) => item.fileId === file.fileId) ||
        materials.filter((item) => item.name === file.name).length !== 1,
    )
  )
    return false;
  try {
    const token = match[2]!;
    const requested = new URL(/^https?:/i.test(token) ? token : `https://${token}`);
    const current = new URL(actualUrl);
    return (
      !requested.username &&
      !requested.password &&
      requested.origin === target.origin &&
      current.origin === target.origin &&
      (requested.pathname === '/' || requested.pathname === current.pathname) &&
      (!requested.search || requested.search === current.search) &&
      (!requested.hash || requested.hash === current.hash)
    );
  } catch {
    return false;
  }
}

export function createBrowserUploadGate(
  prepared: PreparedUploadForGate,
  options: Omit<UnifiedActionGateOptions, 'page' | 'labelForRef'> & {
    materials?: readonly { fileId: string; name: string }[];
  },
) {
  const target = prepared.description;
  const intent = options.userIntent ?? '';
  const question = `将 ${target.files.map((file) => file.name).join('、')} 交给 ${target.origin}${target.formOrigin !== target.origin ? `（表单接收站点 ${target.formOrigin}）` : ''} 的文件控件？${target.selectedCount ? `这会替换控件里已选的 ${target.selectedCount} 个文件。` : ''}选定后网站可能立即接收这些文件。`;
  const gate = createDescriptionActionGate<UnifiedBrowserAction>({
    ...options,
    pageUrl: () => target.origin,
    onBeforeAction: async (descriptor) => {
      if (
        uploadForbidden(intent) &&
        (intent.match(/上传|导入|\bupload\b|\bimport\b/gi) ?? []).length === 1
      )
        return { allowed: false, refuse: '用户未允许上传，本次文件没有交给网页。' };
      const verdict = await options.onBeforeAction(descriptor);
      if (!verdict.allowed)
        return verdict.requiresConfirmation ? { ...verdict, question } : verdict;
      if (target.selectedCount) return { allowed: false, requiresConfirmation: true, question };
      return explicitlyRequestsUpload(
        intent,
        target,
        options.materials,
        prepared.runtimeAction().pageUrl ?? target.origin,
      )
        ? verdict
        : { allowed: false, requiresConfirmation: true, question };
    },
    describe: async () => {
      const current = await prepared.isCurrent();
      return {
        descriptors: [prepared.runtimeAction()],
        unverified: null,
        transactional: null,
        bindings: [current ? prepared.hostBinding() : null],
        objects: JSON.stringify({ target, current }),
      };
    },
  });
  return async (action: UnifiedBrowserAction, phase: 'before' | 'after') => {
    if (!(await prepared.isCurrent()))
      return { kind: 'skip' as const, message: '文件控件或接收站点已变化，请重新观察。' };
    return gate(action, phase);
  };
}
