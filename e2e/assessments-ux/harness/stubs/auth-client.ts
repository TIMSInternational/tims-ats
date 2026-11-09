export function createSupabaseBrowserClient() {
  return { auth: { getSession: async () => ({ data: { session: { access_token: 'harness-token' } } }) } };
}
