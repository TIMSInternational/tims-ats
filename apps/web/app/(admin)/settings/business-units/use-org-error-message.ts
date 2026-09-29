'use client';

import { useI18n } from '../../../../lib/i18n';
import { classifyOrgStructureError } from '../../../../lib/platform-api/org-structure';

/** Maps a failed org-structure write to a translated message, falling back to the server's own text. */
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
        return error instanceof Error && error.message ? error.message : t.units.errorGeneric;
    }
  };
}
