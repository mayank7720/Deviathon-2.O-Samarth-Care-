/** Standalone Node hosting always uses verified Supabase identities and RLS. */
export function serverRuntime(environment = process.env) {
  return {
    env: { ...environment, SAMARTH_AUTH_MODE: 'supabase' },
    db: undefined,
    local: false,
  };
}
