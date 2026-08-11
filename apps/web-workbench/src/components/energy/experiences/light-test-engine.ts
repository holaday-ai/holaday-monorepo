import type { LightTestDefinition, LightTestOutcome } from './test-content';

export function scoreLightTest(test: LightTestDefinition, answers: string[]): LightTestOutcome {
  const score = test.questions.reduce((total, question, index) => {
    return total + (question.options.find((option) => option.id === answers[index])?.points ?? 0);
  }, 0);
  const outcome = test.outcomes.find((item) => score >= item.minScore && score <= item.maxScore);
  if (!outcome) throw new Error(`No outcome for ${test.id} score ${score}`);
  return outcome;
}

export function reachableOutcomeIds(test: LightTestDefinition): string[] {
  const maximum = test.questions.reduce(
    (total, question) => total + Math.max(...question.options.map((option) => option.points)),
    0,
  );
  const ids = new Set<string>();
  for (let score = 0; score <= maximum; score += 1) {
    const outcome = test.outcomes.find((item) => score >= item.minScore && score <= item.maxScore);
    if (outcome) ids.add(outcome.id);
  }
  return [...ids];
}
