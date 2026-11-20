import { z } from 'zod';
import {
  type VerificationInputIssue,
  checkVerificationAdmission,
  checkVerificationImages,
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
    }
  | {
      /** User-uploaded image, shown to both the generation model and the semantic reviewer. */
      readonly kind: 'image';
      readonly key: string;
      readonly source: 'file';
      readonly mediaType: VerificationImageMediaType;
      readonly data: string;
    };

export type VerificationImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

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
        z
          .object({
            kind: z.literal('image'),
            key: z.string().min(1),
            source: z.literal('file'),
            mediaType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
            data: z
              .string()
              .min(1)
              .regex(/^[A-Za-z0-9+/]+={0,2}$/),
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
  const images: string[] = [];
  const descriptors = context.materials.map((material) => {
    if (material.kind === 'image') {
      const { data, ...descriptor } = material;
      images.push(data);
      return descriptor;
    }
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
  const imageBudget = checkVerificationImages(images);
  if (!imageBudget.ok) throw new VerificationContextError(imageBudget.code);
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
    context.materials.some(
      (material) =>
        material.kind === 'unavailable' || (material.kind === 'text' && !material.text.trim()),
    )
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

/** The context without image bytes: what text-only channels (JSON payloads) may carry. */
export function withoutImageData<T extends Pick<TaskVerificationContext, 'materials'>>(
  context: T,
): T {
  return {
    ...context,
    materials: context.materials.map((material) =>
      material.kind === 'image'
        ? {
            kind: 'image',
            key: material.key,
            source: material.source,
            mediaType: material.mediaType,
            note: '图片内容见随附图像',
          }
        : material,
    ),
  } as unknown as T;
}

export function verificationImages(
  context: Pick<TaskVerificationContext, 'materials'> | undefined,
): Array<{ mediaType: VerificationImageMediaType; data: string }> {
  return (context?.materials ?? []).flatMap((material) =>
    material.kind === 'image' ? [{ mediaType: material.mediaType, data: material.data }] : [],
  );
}
