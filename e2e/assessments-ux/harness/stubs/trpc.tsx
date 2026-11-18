// The two tRPC reads the assessments UX makes, answered locally (the spec mocks only the C# surface).
export const trpc = {
  organization: { getCurrent: { useQuery: () => ({ data: { id: 'org', name: 'Acme Corp' } }) } },
  candidatePortal: { myApplications: { useQuery: () => ({ data: [] }) } },
  useUtils: () => ({}),
};
