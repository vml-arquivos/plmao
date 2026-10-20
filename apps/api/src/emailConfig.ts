export type EmailConfigurationInput = {
  provider?: string;
  host?: string;
  user?: string;
  password?: string;
};

export function isEmailConfigurationComplete(input: EmailConfigurationInput): boolean {
  return input.provider === 'smtp' && Boolean(input.host && input.user && input.password);
}
