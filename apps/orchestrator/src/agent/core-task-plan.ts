import type { Logger } from 'pino';
import { classifyLightweightTask } from '../execution/lightweight-task.js';
import type { ProductionModelRuntimeWiring } from '../llm/model-runtime-wiring.js';
import { generatePlan, shouldSkipPlan } from './supercar/plan-service.js';

/** An advisory first-frame plan, never proof that individual actions occurred. */
export async function prepareCoreTaskPlan(input: {
  wiring: ProductionModelRuntimeWiring;
  actorExternalId: string;
  modelDataRegion: unknown;
  intent: string;
  logger: Logger;
  persist: (planText: string) => Promise<boolean>;
  publish: (planText: string) => void;
}): Promise<string | null> {
  const shortRewrite =
    input.intent.length <= 200 &&
    /翻译|润色|改写|\btranslate\b|\brephrase\b/i.test(input.intent) &&
    !/https?:\/\/|附件|文件|报告|研究|调研|检索|对比|搜索/.test(input.intent);
  if (
    shouldSkipPlan(input.intent) ||
    classifyLightweightTask(input.intent) !== null ||
    shortRewrite
  )
    return null;
  try {
    const runtime = input.wiring.resolveCore({
      actorExternalId: input.actorExternalId,
      lane: 'plan',
      ownership: { scope: 'personal', userRegion: input.modelDataRegion },
    });
    if (runtime.kind !== 'ready') return null;
    const result = await generatePlan({
      messagesAdapter: runtime.messages('standard'),
      intent: input.intent,
      logger: input.logger,
      allowedTools: ['搜索 API', '文件处理', '生成内容'],
    });
    if (!result.planText || !(await input.persist(result.planText))) return null;
    input.publish(result.planText);
    return result.planText;
  } catch {
    input.logger.warn({ code: 'CORE_PLAN_UNAVAILABLE' }, 'Core task plan unavailable');
    return null;
  }
}
