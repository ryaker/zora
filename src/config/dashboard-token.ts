/**
 * Resolve the dashboard bearer token (#174).
 *
 * Precedence: the operator's ZORA_DASHBOARD_TOKEN environment variable wins over
 * `[steering].dashboard_token`. A project-local config.toml must not be able to
 * replace a credential the operator supplied out of band (Richard's decision on
 * #209); config is only used when the env var is unset or blank. There is
 * deliberately no opt-in knob that flips this.
 */
export function resolveDashboardToken(
  configToken: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromEnv = env['ZORA_DASHBOARD_TOKEN'];
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv;
  return configToken;
}
