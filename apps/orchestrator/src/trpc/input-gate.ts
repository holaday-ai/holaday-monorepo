import { z } from 'zod';

// Only stock, synchronous Zod primitives/composites with no user callbacks.
// Refinements/transforms/default factories/lazy/custom parsers remain unknown
// unless their source explicitly opts in through pureTaskInput.
export function isBuiltinPureInput(
  value: unknown,
  ancestors = new Set<unknown>(),
): value is z.ZodTypeAny {
  if (!(value instanceof z.ZodType) || ancestors.has(value)) return false;
  const next = new Set(ancestors).add(value);
  const def = (value as z.ZodTypeAny)._def;
  const nested = (schema: unknown) => isBuiltinPureInput(schema, next);
  if (def.coerce) return false;
  switch (def.typeName) {
    case 'ZodString':
    case 'ZodNumber':
    case 'ZodBoolean':
    case 'ZodBigInt':
    case 'ZodDate':
    case 'ZodNull':
    case 'ZodUndefined':
    case 'ZodNaN':
    case 'ZodLiteral':
    case 'ZodEnum':
    case 'ZodNativeEnum':
    case 'ZodNever':
    case 'ZodAny':
    case 'ZodUnknown':
      return true;
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodReadonly':
      return nested(def.innerType);
    case 'ZodArray':
      return nested(def.type);
    case 'ZodObject':
      return Object.values(def.shape()).every(nested) && nested(def.catchall);
    case 'ZodTuple':
      return def.items.every(nested) && (!def.rest || nested(def.rest));
    case 'ZodUnion':
      return def.options.every(nested);
    case 'ZodRecord':
      return nested(def.keyType) && nested(def.valueType);
    case 'ZodIntersection':
      return nested(def.left) && nested(def.right);
    case 'ZodBranded':
      return nested(def.type);
    default:
      return false;
  }
}

/** Preserve the tRPC builder's types and method order. Only input parsers are
 * decorated; final procedure functions and output parsers are untouched. */
export function withAuditedInputs<T extends object>(
  builder: T,
  audit: (parser: unknown) => unknown,
  safePrefix = true,
): T {
  return new Proxy(builder, {
    get(target, key, receiver) {
      const original = Reflect.get(target, key, receiver);
      if (typeof original !== 'function') return original;
      return (...args: unknown[]) => {
        if (key === 'input' && safePrefix) args[0] = audit(args[0]);
        const result = Reflect.apply(original, target, args);
        return result && typeof result === 'object' && typeof result.input === 'function'
          ? withAuditedInputs(result, audit, safePrefix && key !== 'use')
          : result;
      };
    },
  });
}
