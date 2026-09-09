import type { LegacyWorkflowContext } from '../execution/task-verification-context.js';
import { renderVerificationUserIntent } from '../execution/task-verification-context.js';
import type { CoreAcceptedRequirements } from './core-task-requirements.js';
import {
  hasStructuredLivestreamData,
  resolveFixedExpertWorkflow,
} from './supercar/expert-workflows.js';

/** Only call with server-selected lineage and owner-authorized file references.
 * Loading/parsing the complete file set remains mandatory before admission.
 */
export function restoreCoreLegacyWorkflow(
  id: string,
  input: Pick<CoreAcceptedRequirements, 'initialRequest' | 'userTurns' | 'fileIds'>,
): LegacyWorkflowContext {
  const match = resolveFixedExpertWorkflow(id, renderVerificationUserIntent(input), {
    hasAttachments: input.fileIds.length > 0,
    hasManualData: hasStructuredLivestreamData(
      [input.initialRequest, ...input.userTurns].join('\n\n'),
    ),
  });
  if (!match || (match.routeOverride !== 'generate' && match.routeOverride !== 'browser'))
    throw new Error('CORE_LEGACY_WORKFLOW_UNAVAILABLE');
  return {
    id: match.id,
    promptPreamble: match.promptPreamble,
    missingInputs: [...match.missingInputs],
    routeOverride: match.routeOverride,
  };
}
