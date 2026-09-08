/** Model/runner completion is independent from verification and database delivery. */
export type PartialGenerationStopReason =
  | 'continuation_limit'
  | 'continuation_failed'
  | 'timeout'
  | 'empty_response'
  | 'provider_error'
  | 'invalid_response'
  | 'quality_rejected';

export type GenerationCompletion =
  | {
      completeness: 'complete';
      stopReason: 'end_turn' | 'deterministic' | 'awaiting_user';
    }
  | { completeness: 'partial'; stopReason: PartialGenerationStopReason };
