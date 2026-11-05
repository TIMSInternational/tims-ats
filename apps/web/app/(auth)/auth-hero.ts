// What the staff auth screens' left panel advertises. In the pilot launch scope it lists only the
// modules the pilot actually ships (recruitment → interviews → offers → onboarding), never a module
// hidden by the scope. Pure, so node tests can assert the pilot list directly.
import { readLaunchScope, type LaunchScope } from '../../lib/launch-scope';

export type HeroPillKey =
  | 'recruitment'
  | 'interviews'
  | 'offers'
  | 'onboarding'
  | 'assessments'
  | 'performance'
  | 'nineBox'
  | 'analytics';

const PILOT_PILLS: readonly HeroPillKey[] = ['recruitment', 'interviews', 'offers', 'onboarding'];
const FULL_PILLS: readonly HeroPillKey[] = [
  'recruitment',
  'assessments',
  'onboarding',
  'performance',
  'nineBox',
  'analytics',
];

export function authHeroPills(scope: LaunchScope = readLaunchScope()): readonly HeroPillKey[] {
  return scope === 'pilot' ? PILOT_PILLS : FULL_PILLS;
}
