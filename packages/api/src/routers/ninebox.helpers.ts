// The quadrant maps now live in @tims/shared/ninebox.ts (single source of truth shared with the C#
// port, golden-fixtured). Re-exported here so existing imports (`./ninebox.helpers`) keep working.
export { quadrantToGrid, simulateQuadrantMap, quadrantPlans } from '@tims/shared';
