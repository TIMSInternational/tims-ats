// The two team-intel metric kernels moved to @tims/shared (Phase-5 Slice 6): the shared module is the
// SINGLE source the router returns AND the parity target for the C# port. Re-exported here so the
// existing import path (`./team-intel-metrics`) stays behavior-preserving.
export { computeAvgTenureYears, computeRoleDiversity } from '@tims/shared';
