export function normaliseEmailInput(value: string): string {
  return value.trim();
}

export function isValidEmail(value: string): boolean {
  const email = normaliseEmailInput(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function normalisePhoneInput(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('0086') && digits.length >= 13) {
    digits = digits.slice(4);
  } else if (digits.startsWith('86') && digits.length >= 11) {
    digits = digits.slice(2);
  }
  return digits.slice(0, 11);
}

export function isValidChinaPhone(value: string): boolean {
  return /^1[3-9]\d{9}$/.test(normalisePhoneInput(value));
}

export function normaliseCodeInput(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6);
}

export function maskChinaPhone(value: string): string {
  const phone = normalisePhoneInput(value);
  if (phone.length !== 11) return phone;
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

export function authErrorMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  if (
    /unknown column|table .* doesn't exist|sql|database|response.*json|unexpected end of json|field list/i.test(
      trimmed,
    )
  ) {
    return fallback;
  }
  return trimmed;
}
