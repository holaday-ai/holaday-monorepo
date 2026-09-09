import { z } from 'zod';
import {
  type VerificationInputIssue,
  checkVerificationAdmission,
} from './verification-input-budget.js';

/** Server-owned legacy policy, never inferred from a candidate answer or material. */
export interface LegacyWorkflowContext {
  readonly id: 'douyin-livestream-review';
  readonly promptPreamble: string;
  readonly missingInputs: readonly ('liveSession' | 'dataSource')[];
  readonly routeOverride: 'generate' | 'browser';
}

export interface TaskVerificationContext {
  readonly schemaVersion: 1;
  readonly executionId: string;
  readonly executionRevision: number;
  readonly initialRequest: string;
  readonly userTurns: readonly string[];
  readonly phase: 'direct' | 'draft' | 'revise' | 'approved_execution';
  readonly workflow: {
    readonly id: string;
    readonly sections: readonly {
      readonly id: string;
      readonly title: string;
      readonly required: boolean;
      readonly sourceAnnotation: boolean;
      readonly guidance?: string;
    }[];
  } | null;
  readonly referencePlan: string | null;
  /** Prior model output, preserved as untrusted reference, never as user-supplied data. */
  readonly referenceContext?: string;
  readonly legacyWorkflow?: LegacyWorkflowContext;
  readonly materials: readonly VerificationMaterial[];
}

export type VerificationMaterial =
  | {
      readonly kind: 'text';
      readonly key: string;
      readonly source: 'file' | 'provider';
      readonly text: string;
    }
  | {
      readonly kind: 'unavailable';
      readonly key: string;
      readonly source: 'file' | 'provider';
      readonly reason: 'non_text' | 'source_body_unavailable';
    };

export class VerificationContextError extends Error {
  constructor(public readonly code: VerificationInputIssue) {
    super(code);
    this.name = 'VerificationContextError';
  }
}

const sectionSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    required: z.boolean(),
    sourceAnnotation: z.boolean(),
    guidance: z.string().optional(),
  })
  .strict();

const materialIdentity = {
  key: z.string().min(1),
  source: z.enum(['file', 'provider']),
};

const contextSchema = z
  .object({
    schemaVersion: z.literal(1),
    executionId: z.string().min(1),
    executionRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    initialRequest: z.string().min(1),
    userTurns: z.array(z.string()),
    phase: z.enum(['direct', 'draft', 'revise', 'approved_execution']),
    workflow: z
      .object({ id: z.string().min(1), sections: z.array(sectionSchema) })
      .strict()
      .nullable(),
    referencePlan: z.string().nullable(),
    referenceContext: z.string().optional(),
    legacyWorkflow: z
      .object({
        id: z.literal('douyin-livestream-review'),
        promptPreamble: z.string().refine((value) => value.trim().length > 0),
        missingInputs: z
          .array(z.enum(['liveSession', 'dataSource']))
          .max(2)
          .refine((items) => new Set(items).size === items.length),
        routeOverride: z.enum(['generate', 'browser']),
      })
      .strict()
      .refine((value) => value.missingInputs.length === 0 || value.routeOverride === 'generate')
      .optional(),
    materials: z.array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('text'), ...materialIdentity, text: z.string() }).strict(),
        z
          .object({
            kind: z.literal('unavailable'),
            ...materialIdentity,
            reason: z.enum(['non_text', 'source_body_unavailable']),
          })
          .strict(),
      ]),
    ),
  })
  .strict();

/** Accept only server-assembled data; this validates shape, not user authorization. */
export function createTaskVerificationContext(input: unknown): TaskVerificationContext {
  const parsed = contextSchema.safeParse(input);
  if (!parsed.success) throw new VerificationContextError('VERIFICATION_CONTEXT_INVALID');
  const context = parsed.data;
  const texts: string[] = [];
  const descriptors = context.materials.map((material) => {
    if (material.kind !== 'text') return material;
    const { text, ...descriptor } = material;
    texts.push(text);
    return descriptor;
  });
  const budget = checkVerificationAdmission(
    JSON.stringify({ ...context, materials: descriptors }),
    texts,
  );
  if (!budget.ok) throw new VerificationContextError(budget.code);
  // Zod has copied every allowed field. Freeze that copy, never caller-owned objects.
  return freezeSnapshot(context);
}

export function renderVerificationUserIntent(
  context: Pick<TaskVerificationContext, 'initialRequest' | 'userTurns'>,
): string {
  return (
    context.initialRequest + context.userTurns.map((turn) => `\n\n[用户补充]\n${turn}`).join('')
  );
}

export function assessVerificationMaterials(context: TaskVerificationContext): {
  complete: boolean;
  codes: readonly VerificationInputIssue[];
} {
  if (
    context.materials.some((material) => material.kind === 'unavailable' || !material.text.trim())
  ) {
    return { complete: false, codes: ['VERIFICATION_MATERIALS_INCOMPLETE'] };
  }
  return { complete: true, codes: [] };
}

function freezeSnapshot<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}
