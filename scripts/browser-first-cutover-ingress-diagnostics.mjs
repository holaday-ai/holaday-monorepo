// Fixed diagnostic labels only. They never supply authorization or success.
const stages = new Set([
  'ATTACH_SCOPE',
  'ATTACH_GUARD',
  'ATTACH_BIND',
  'ATTACH_INGRESS',
  'ATTACH_GATEWAY',
  'ATTACH_OBSERVER',
  'ATTACH_FINAL_GUARD',
  'PAIR_LOCAL_CONSTRUCTOR',
  'PAIR_REMOTE_CONNECT',
  'GATEWAY_ENTRY',
  'GATEWAY_OWNER',
  'GATEWAY_OPEN',
  'GATEWAY_HANDSHAKE',
  'GATEWAY_COMMAND',
  'GATEWAY_TRANSPORT_IDENTITY',
  'RECOVERY_SCOPE_ENTRY',
  'RECOVERY_SCOPE_FOLDER',
  'RECOVERY_SCOPE_FILE',
  'RECOVERY_SCOPE_CONTENT',
  'RECOVERY_SCOPE_SHAPE',
  'RECOVERY_SCOPE_RUNTIME',
  'RECOVERY_SCOPE_TARGET',
  'RECOVERY_SCOPE_PUBLIC',
  'RECOVERY_SCOPE_SOURCE_OPTIONS',
  'RECOVERY_SCOPE_DESTINATION_OPTIONS',
  'RECOVERY_SCOPE_RECIPIENT',
  'RECOVERY_SERVER_ENTRY',
  'RECOVERY_SERVER_SCOPE_READ',
  'RECOVERY_SERVER_PUBLIC',
  'RECOVERY_SERVER_SCOPE_RECHECK',
  'RECOVERY_SERVER_READ',
  'RECOVERY_SERVER_ENVELOPE',
  'RECOVERY_SERVER_ATTACH_VALUE',
  'RECOVERY_SERVER_SCOPE_SEND',
  'RECOVERY_SERVER_SCOPE_READ_ANSWER',
  'RECOVERY_SERVER_SCOPE_ANSWER',
  'RECOVERY_SERVER_RESULT',
  'RECOVERY_SERVER_FINAL_SCOPE',
  'RECOVERY_CLIENT_ENTRY',
  'RECOVERY_CLIENT_SCOPE_INITIAL',
  'RECOVERY_CLIENT_SEND',
  'RECOVERY_CLIENT_READ',
  'RECOVERY_CLIENT_ENVELOPE',
  'RECOVERY_CLIENT_SCOPE_MESSAGE',
  'RECOVERY_CLIENT_SCOPE_CHECK',
  'RECOVERY_CLIENT_SCOPE_SEND',
  'RECOVERY_CLIENT_RESULT',
  'RECOVERY_CLIENT_SCOPE_FINAL',
  'RECOVERY_SITE_CONTEXT',
  'RECOVERY_SITE_CLOCK',
  'RECOVERY_SITE_OWNER',
  'RECOVERY_SITE_SOURCE',
  'RECOVERY_SITE_RECORD',
  'RECOVERY_SITE_PHASE',
  'RECOVERY_SITE_RUN',
  'RECOVERY_SITE_SCOPE',
  'RECOVERY_SITE_RECORD_ANCHOR',
  'RECOVERY_SITE_STOPPED_OBSERVER',
  'RECOVERY_SITE_STOPPED_BOUNDARY',
  'RECOVERY_SITE_STOPPED_SHAPE',
  'RECOVERY_SITE_BOUNDARY_WORK',
  'RECOVERY_SITE_BOUNDARY_FENCE',
  'RECOVERY_SITE_BOUNDARY_PROGRESS',
  'RECOVERY_SITE_BOUNDARY_AFTER_WORK',
  'RECOVERY_SITE_BOUNDARY_VALIDATION',

  'APPROVAL_INPUT',
  'APPROVAL_CLOCK',
  'APPROVAL_DEADLINE',
  'APPROVAL_FOLDER',
  'APPROVAL_FILE',
  'APPROVAL_CONTENT',
  'APPROVAL_CHANGED',
  'APPROVAL_JSON',
  'APPROVAL_BINDING',
  'APPROVAL_RISK',
  'SITE_APPROVAL_BEFORE',
  'SITE_FOLDER',
  'SITE_FILE',
  'SITE_CONTENT',
  'SITE_JSON',
  'SITE_SHAPE',
  'SITE_APPROVAL_AFTER',
  'SITE_CLOCK',
  'SITE_VALIDATE',
  'RECOVERY_SITE_SOURCE_SHAPE',
  'RECOVERY_SITE_SOURCE_DRIFT',
  'PORT_OUTPUT_LIMIT',
  'PORT_TERMINATED',
  'PORT_EXIT',
  'PORT_START',
  'PORT_STDIN',
  'PORT_INPUT',
  'PORT_CLOCK',
  'PORT_DEADLINE',
  'PORT_OWNER',
  'PORT_RECEIPT',
  'PORT_COMMAND',
  'PORT_JSON',
  'PORT_SHAPE',
  'PORT_RULES',
  'PORT_EXISTING',
  'PORT_POLICY',
  'FENCE_CONTEXT',
  'FENCE_RECEIPT',
  'FENCE_PORTS_BEFORE',
  'FENCE_CONFIG',
  'FENCE_PROBE',
  'FENCE_RESULT',
  'FENCE_TARGETS',
  'FENCE_ROUTE',
  'FENCE_STATUS',
  'FENCE_WRITERS',
  'FENCE_PORTS_AFTER',
  'PROBE_ENTRY',
  'PROBE_CLOCK',
  'PROBE_WRITER_READ',
  'PROBE_WRITER_SHAPE',
  'PROBE_TIMEOUT',
  'PROBE_REQUEST',
  'PROBE_RESPONSE',
  'PROBE_BODY',
  'PROBE_UPGRADE',
  'PROBE_SETTLED',
  'PROBE_WRITER_DRIFT',
  'PAIR_ENTRY',
  'PAIR_CLOCK',
  'PAIR_OWNER',
  'PAIR_EFFECTS',
  'PAIR_REVISION',
  'PAIR_PHASE',
  'PAIR_SCOPE',
  'PAIR_LOCAL_RECEIPT',
  'PAIR_REMOTE_RECEIPT',
  'PAIR_RECEIPT_SHAPE',
  'LOCAL_ENTRY',
  'LOCAL_CLOCK',
  'LOCAL_OWNER',
  'LOCAL_EFFECTS',
  'LOCAL_REVISION',
  'LOCAL_PHASE',
  'LOCAL_SCOPE',
  'LOCAL_RECEIPT',
  'STORE_CLOCK',
  'STORE_OWNER',
  'STORE_FOLDER',
  'STORE_ABSENCE',
  'STORE_FILE',
  'STORE_CONTENT',
  'STORE_READ',
  'REMOTE_ENTRY',
  'REMOTE_OWNER',
  'REMOTE_SEND',
  'REMOTE_READ',
  'REMOTE_RESULT',
  'REMOTE_FACT',
  'WIRE_CLOCK',
  'WIRE_READ',
  'WIRE_WRITE',
  'RECEIVER_ENTRY',
  'RECEIVER_SCOPE',
  'RECEIVER_IDENTITY',
  'RECEIVER_FACT',
  'RECEIVER_LOCAL',
  'RECEIVER_RESULT',
]);
export function ingressDiagnosticStage(error) {
  try {
    const cause = Object.getOwnPropertyDescriptor(error, 'cause')?.value;
    const stage = Object.getOwnPropertyDescriptor(cause, 'ingressStage')?.value;
    return stages.has(stage) ? stage : undefined;
  } catch {
    return undefined;
  }
}
export function ingressDiagnosticError(message, stage, previous) {
  const selected = ingressDiagnosticStage(previous) ?? (stages.has(stage) ? stage : undefined);
  return selected
    ? new Error(message, {
        cause: Object.freeze({
          ingressStage: selected,
          ...readinessDiagnosticFields(ownData(previous, 'cause')),
        }),
      })
    : new Error(message);
}

// Readiness diagnostics are fixed labels only, never evidence or permission.
const readinessStages = new Set([
  'READINESS_HOST_PRE_GUARD',
  'READINESS_HOST_BODY',
  'READINESS_HOST_POST_GUARD',
  'READINESS_DATABASE_PRE_GUARD',
  'READINESS_DATABASE_BODY',
  'READINESS_DATABASE_POST_GUARD',
  'READINESS_REHEARSAL_PRE_GUARD',
  'READINESS_REHEARSAL_BODY',
  'READINESS_REHEARSAL_POST_GUARD',
  'READINESS_FENCE_PRE_GUARD',
  'READINESS_FENCE_BODY',
  'READINESS_FENCE_POST_GUARD',
  'READINESS_ORDERS_PRE_GUARD',
  'READINESS_ORDERS_BODY',
  'READINESS_ORDERS_POST_GUARD',
  'READINESS_HOST_SCOPE',
  'READINESS_HOST_RECORD',
  'READINESS_HOST_INVENTORY',
  'READINESS_HOST_WORK_BEFORE',
  'READINESS_HOST_DB_WRITERS_BEFORE',
  'READINESS_HOST_OBSERVER',
  'READINESS_HOST_DB_WRITERS_AFTER',
  'READINESS_HOST_WORK_AFTER',
  'READINESS_HOST_LEGACY_VALIDATION',
  'READINESS_HOST_PRODUCERS',
  'READINESS_HOST_WRITER_VALIDATION',
  'READINESS_HOST_FINAL_GUARD',
  'READINESS_HOST_RESULT',
  'READINESS_WORK_FACTS',
  'READINESS_WORK_PERSISTED',
  'READINESS_WORK_VALIDATION',
  'READINESS_HOST_WORK_BEFORE_FACTS',
  'READINESS_HOST_WORK_BEFORE_PERSISTED',
  'READINESS_HOST_WORK_BEFORE_VALIDATION',
  'READINESS_HOST_WORK_AFTER_FACTS',
  'READINESS_HOST_WORK_AFTER_PERSISTED',
  'READINESS_HOST_WORK_AFTER_VALIDATION',
  'READINESS_WRITERS_PRE_GUARD',
  'READINESS_WRITERS_INVENTORY',
  'READINESS_WRITERS_DATABASE',
  'READINESS_WRITERS_DATABASE_VALIDATION',
  'READINESS_WRITERS_DATABASE_POST_GUARD',
  'READINESS_WRITERS_FACTS',
  'READINESS_WRITERS_POST_GUARD',
  'READINESS_WRITERS_VALIDATION',
  'READINESS_HOST_DB_WRITERS_BEFORE_PRE_GUARD',
  'READINESS_HOST_DB_WRITERS_BEFORE_INVENTORY',
  'READINESS_HOST_DB_WRITERS_BEFORE_DATABASE',
  'READINESS_HOST_DB_WRITERS_BEFORE_DATABASE_VALIDATION',
  'READINESS_HOST_DB_WRITERS_BEFORE_DATABASE_POST_GUARD',
  'READINESS_HOST_DB_WRITERS_BEFORE_FACTS',
  'READINESS_HOST_DB_WRITERS_BEFORE_POST_GUARD',
  'READINESS_HOST_DB_WRITERS_BEFORE_VALIDATION',
  'READINESS_HOST_DB_WRITERS_AFTER_PRE_GUARD',
  'READINESS_HOST_DB_WRITERS_AFTER_INVENTORY',
  'READINESS_HOST_DB_WRITERS_AFTER_DATABASE',
  'READINESS_HOST_DB_WRITERS_AFTER_DATABASE_VALIDATION',
  'READINESS_HOST_DB_WRITERS_AFTER_DATABASE_POST_GUARD',
  'READINESS_HOST_DB_WRITERS_AFTER_FACTS',
  'READINESS_HOST_DB_WRITERS_AFTER_POST_GUARD',
  'READINESS_HOST_DB_WRITERS_AFTER_VALIDATION',
]);
const readinessCauses = new Set([
  'CUTOVER_WORK_OBSERVATION_UNPROVEN',
  'CUTOVER_PRODUCTION_FACTS_UNPROVEN',
  'CUTOVER_HOST_PAIR_UNPROVEN',
  'CUTOVER_DATABASE_WRITERS_UNPROVEN',
  'CUTOVER_RETIREMENT_OBSERVATION_UNPROVEN',
  'CUTOVER_CLOUD_DISPLAY_SCOPE_UNPROVEN',
  'CUTOVER_CLOUD_OLD_BROWSER_ASSOCIATION_UNPROVEN',
  'CUTOVER_LEGACY_SOURCE_UNPROVEN',
  'CUTOVER_INVENTORY_UNPROVEN',
  'CUTOVER_PAYMENT_OBSERVATION_UNPROVEN',
  'MAINTENANCE_REHEARSAL_UNPROVEN',
  'UNCLASSIFIED',
]);
function ownData(value, key) {
  try {
    return Object.getOwnPropertyDescriptor(value, key)?.value;
  } catch {
    return undefined;
  }
}
export function readinessDiagnosticFields(value, fromError = false) {
  const record = fromError ? ownData(value, 'cause') : value;
  const fields = {};
  const stage = ownData(record, 'readinessStage');
  const cause = ownData(record, 'ingressCause');
  if (readinessStages.has(stage)) fields.readinessStage = stage;
  if (readinessCauses.has(cause)) fields.ingressCause = cause;
  return fields;
}
export function readinessDiagnosticError(error, stage) {
  const previous = readinessDiagnosticFields(ownData(error, 'cause'));
  const message = ownData(error, 'message');
  return new Error('CUTOVER_SITE_UNPROVEN', {
    cause: Object.freeze({
      ingressStage: ingressDiagnosticStage(error) ?? 'RECOVERY_SITE_RUN',
      readinessStage: previous.readinessStage ?? (readinessStages.has(stage) ? stage : undefined),
      ingressCause:
        previous.ingressCause ?? (readinessCauses.has(message) ? message : 'UNCLASSIFIED'),
    }),
  });
}

// One fixed diagnostic line on stderr, never a session/business message.
export function firstCutoverReceiverFailureLine(error, role) {
  if (!['ingress', 'gateway'].includes(role)) return '';
  return `${JSON.stringify({
    kind: 'first-cutover-receiver-failure',
    role,
    stage: ingressDiagnosticStage(error) ?? 'RECEIVER_ENTRY',
  })}\n`;
}

export function firstCutoverSshCompletion(child, role) {
  const limit = 4096;
  let bytes = Buffer.alloc(0);
  let discarded = !['ingress', 'gateway'].includes(role);
  let closed = false;
  let stderrEnded = false;
  child.stderr.on('error', () => {
    discarded = true;
    bytes = Buffer.alloc(0);
  });
  child.stderr.once('end', () => {
    stderrEnded = true;
  });
  child.stderr.on('data', (chunk) => {
    if (discarded || closed) return;
    if (!Buffer.isBuffer(chunk) || bytes.length + chunk.length > limit) {
      discarded = true;
      bytes = Buffer.alloc(0);
      return;
    }
    bytes = Buffer.concat([bytes, chunk]);
  });
  const diagnostic = () => {
    if (discarded || !stderrEnded || !bytes.length) return undefined;
    try {
      const text = bytes.toString('utf8');
      if (!Buffer.from(text).equals(bytes) || !text.endsWith('\n')) return undefined;
      const value = JSON.parse(text.slice(0, -1));
      if (
        !value ||
        Array.isArray(value) ||
        Object.keys(value).length !== 3 ||
        !['kind', 'role', 'stage'].every((key) => Object.hasOwn(value, key)) ||
        value.kind !== 'first-cutover-receiver-failure' ||
        value.role !== role ||
        !stages.has(value.stage) ||
        firstCutoverReceiverFailureLine(
          ingressDiagnosticError('CUTOVER_INGRESS_SESSION_UNPROVEN', value.stage),
          role,
        ) !== text
      )
        return undefined;
      return value.stage;
    } catch {
      return undefined;
    }
  };
  return new Promise((resolve) => {
    child.once('error', () => {
      closed = true;
      bytes = Buffer.alloc(0);
      child.stdout.destroy();
      child.stdin.destroy();
      resolve({ code: 1 });
    });
    child.once('close', (code, signal) => {
      const result = { code: signal ? 1 : code };
      const selected = result.code !== 0 ? diagnostic() : undefined;
      if (selected) result.receiverStage = selected;
      closed = true;
      bytes = Buffer.alloc(0);
      resolve(result);
    });
  });
}

// A failed connection gets one observation budget, shared by nested catches.
const receiverFailureObservations = new WeakMap();
async function observeReceiverFailure(connection, deadline, now) {
  let timer;
  try {
    const left = deadline - now();
    if (!Number.isFinite(left) || left <= 0 || !connection.completion) return undefined;
    return await Promise.race([
      connection.completion,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(undefined), Math.min(1000, left));
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

// Called only after the original failure cleanup. No success or retry path.
export async function firstCutoverReceiverFailure(error, connection, deadline, now) {
  const current = ingressDiagnosticStage(error);
  if (current && !['WIRE_READ', 'WIRE_WRITE', 'WIRE_CLOCK'].includes(current)) return error;
  try {
    if (!connection || (typeof connection !== 'object' && typeof connection !== 'function'))
      return error;
    let observation = receiverFailureObservations.get(connection);
    if (!observation) {
      observation = observeReceiverFailure(connection, deadline, now);
      receiverFailureObservations.set(connection, observation);
    }
    const result = await observation;
    const stage = Object.getOwnPropertyDescriptor(result, 'receiverStage')?.value;
    const code = Object.getOwnPropertyDescriptor(result, 'code')?.value;
    if (code === 0 || !Number.isInteger(code) || !stages.has(stage)) return error;
    const message = Object.getOwnPropertyDescriptor(error, 'message')?.value;
    return ingressDiagnosticError(
      ['CUTOVER_INGRESS_SESSION_UNPROVEN', 'CUTOVER_GATEWAY_SESSION_UNPROVEN'].includes(message)
        ? message
        : 'CUTOVER_INGRESS_SESSION_UNPROVEN',
      stage,
    );
  } catch {
    return error;
  }
}
