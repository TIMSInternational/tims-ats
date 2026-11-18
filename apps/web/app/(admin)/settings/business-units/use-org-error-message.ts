'use client';

import { useI18n } from '../../../../lib/i18n';
import { PlatformApiError } from '../../../../lib/platform-api/client';
import { classifyOrgStructureError } from '../../../../lib/platform-api/org-structure';

/**
 * Maps a failed org-structure write to a translated message; backend text is never shown (settings-15).
 * The stable `code` values the C# org-structure service returns (OrgStructureErrorCodes) get their own
 * copy, so the admin still learns why a write was refused (settings-check-03).
 */
export function useOrgErrorMessage(): (error: unknown) => string {
  const { t } = useI18n();
  return (error: unknown) => {
    if (error instanceof PlatformApiError) {
      switch (error.code) {
        case 'invalid_input':
          return t.units.errorInvalidInput;
        case 'company_required':
          return t.units.errorCompanyRequired;
        case 'business_unit_inactive':
          return t.units.errorUnitInactive;
        case 'team_inactive':
          return t.units.errorTeamInactive;
        case 'user_inactive':
          return t.units.errorUserInactive;
      }
    }
    switch (classifyOrgStructureError(error)) {
      case 'has_active_teams':
        return t.units.errorHasActiveTeams;
      case 'forbidden':
        return t.units.errorForbidden;
      case 'not_found':
        return t.units.errorNotFound;
      default:
        return t.units.errorGeneric;
    }
  };
}
