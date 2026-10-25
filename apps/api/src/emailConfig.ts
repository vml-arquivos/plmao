export type EmailConfigurationInput = {
  provider?: string;
  host?: string;
  user?: string;
  password?: string;
  apiKey?: string;
};

export function isEmailConfigurationComplete(input: EmailConfigurationInput): boolean {
  if (input.provider === 'brevo_api') return Boolean(input.apiKey);
  return input.provider === 'smtp' && Boolean(input.host && input.user && input.password);
}
