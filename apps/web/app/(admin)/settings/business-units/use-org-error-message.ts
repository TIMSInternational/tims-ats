'use client';

import { useI18n } from '../../../../lib/i18n';
import { classifyOrgStructureError } from '../../../../lib/platform-api/org-structure';

/** Maps a failed org-structure write to a translated message; backend text is never shown (settings-15). */
export function useOrgErrorMessage(): (error: unknown) => string {
  const { t } = useI18n();
  return (error: unknown) => {
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
