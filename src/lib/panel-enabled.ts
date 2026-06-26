/**
 * Centralized gate for sidebar panels.
 * Reads process.env.OPENCODE_<PROVIDER>_USAGE_ENABLED.
 * Defaults to enabled when unset.
 */
export const panelEnabled = (provider: string): boolean => {
  const raw = process.env[`OPENCODE_${provider}_USAGE_ENABLED`];
  if (raw === undefined || raw === "") return true;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
};
