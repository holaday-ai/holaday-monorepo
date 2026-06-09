/**
 * Deterministic fast-path answers for the SAFEST lightweight Q&A.
 *
 * Two — and only two — shapes are answered without a model call:
 *   1. a single binary arithmetic operation over two plain numbers
 *      (1+1, 100*23, 12 除以 3, 1 加 1 等于几), and
 *   2. the canonical greetings 你好 / 谢谢 (+ hi/hello/thanks).
 *
 * Everything else returns null so the caller falls back to the model:
 * unit conversion (摄氏→华氏), multi-step / chained math (1+2+3),
 * equations (2x+1=5), repeating/non-terminating decimals (10÷3),
 * real-time data, web actions, file generation, knowledge questions.
 *
 * Safety: this is consulted ONLY when classifyLightweightTask(intent)
 * !== null (see generate-runner), and that classifier already returns
 * null for any web / action / file / current-data signal — so a
 * must-execute intent can never reach this helper. The parser is
 * additionally conservative: no eval, single binary op, two plain
 * numbers, clean (integer or ≤4-decimal-terminating) result only.
 */

const GREETING_ANSWERS: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /^(?:你好|您好|哈喽|哈罗|嗨|hi|hello|hey)[\s!！。.,，~、…]*$/i,
    '你好！我是 HOLA DAY 智能助手，有什么可以帮你的吗？',
  ],
  [
    /^(?:谢谢|谢谢你|多谢|感谢|thanks|thank\s+you)[\s!！。.,，~、…]*$/i,
    '不客气！很高兴能帮到你，还有什么需要我做的吗？',
  ],
];

function tryGreeting(text: string): string | null {
  for (const [re, answer] of GREETING_ANSWERS) {
    if (re.test(text)) return answer;
  }
  return null;
}

/**
 * Parse a single binary arithmetic operation over two plain numbers.
 * Returns a formatted "a op b = result" string, or null when the
 * input is anything more complex than that.
 */
function tryArithmetic(text: string): string | null {
  let s = text;
  // Drop question framing so "100 * 23 等于几？" reduces to the
  // bare expression. Longest alternatives first.
  s = s
    .replace(/[？?]/g, '')
    .replace(
      /等于几|等于多少|是多少|得多少|结果是?|等于|计算|算一下|算算|请问|帮我|多少/g,
      ' ',
    );
  // Normalise operators (longest Chinese forms first).
  s = s
    .replace(/加上|加/g, '+')
    .replace(/减去|减/g, '-')
    .replace(/乘以|乘|×/g, '*')
    .replace(/除以|÷/g, '/');
  // A trailing "=" (user wrote "1+1=") is fine to drop; a mid-string
  // "=" means an equation/assertion → leave it so the regex rejects.
  s = s.replace(/\s+/g, '').replace(/=$/, '');

  const m = /^(-?\d+(?:\.\d+)?)([+\-*/])(-?\d+(?:\.\d+)?)$/.exec(s);
  if (!m) return null;

  const a = Number(m[1]);
  const op = m[2];
  const b = Number(m[3]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  let r: number;
  switch (op) {
    case '+':
      r = a + b;
      break;
    case '-':
      r = a - b;
      break;
    case '*':
      r = a * b;
      break;
    case '/':
      if (b === 0) return null;
      r = a / b;
      break;
    default:
      return null;
  }
  if (!Number.isFinite(r)) return null;

  // Only emit a clean result. Integers pass; otherwise the value must
  // terminate within 4 decimals (1.5, 2.25) — repeating decimals
  // (10/3 = 3.333…) return null so the model handles the rounding.
  let out: string;
  if (Number.isInteger(r)) {
    out = String(r);
  } else {
    const rounded = Number(r.toFixed(4));
    if (rounded !== r) return null;
    out = String(rounded);
  }

  const display = op === '*' ? '×' : op === '/' ? '÷' : op;
  return `${m[1]} ${display} ${m[3]} = ${out}`;
}

/**
 * Return a deterministic answer for the safe subset, or null to defer
 * to the model. Caps input length so only trivial prompts qualify.
 */
export function tryDeterministicLightweightAnswer(
  intent: string | null | undefined,
): string | null {
  const text = (intent ?? '').trim();
  if (!text || text.length > 40) return null;
  return tryGreeting(text) ?? tryArithmetic(text);
}
