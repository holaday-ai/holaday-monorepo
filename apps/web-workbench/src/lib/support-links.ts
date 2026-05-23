export const SUPPORT_EMAIL = 'support@holaday.ai';

export interface SupportMailOptions {
  subject: string;
  body?: string;
}

export function supportMailtoHref({
  subject,
  body,
}: SupportMailOptions): string {
  const params = new URLSearchParams();
  params.set('subject', subject);
  if (body) params.set('body', body);
  return `mailto:${SUPPORT_EMAIL}?${params.toString()}`;
}
