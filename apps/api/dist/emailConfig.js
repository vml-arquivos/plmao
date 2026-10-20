export function isEmailConfigurationComplete(input) {
    return input.provider === 'smtp' && Boolean(input.host && input.user && input.password);
}
