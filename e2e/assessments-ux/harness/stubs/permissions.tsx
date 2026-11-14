// The harness persona is an HR admin: every grant. The C# routes (mocked) are where D6 and the scopes are enforced.
export const useCan = () => () => true;
export const usePermissions = () => ({ can: () => true, isLoading: false });
