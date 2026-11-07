import { OVERALL_NOTES_MAX, type ScorecardDraft } from './scorecard-model';

// ---------------------------------------------------------------------------
// Copying an AI suggestion into the evaluator's scorecard DRAFT. Pure, so the rules are testable:
//   - a suggested rating fills ONLY an empty rating of a competency on this card — it never overwrites a
//     rating the evaluator already gave (their judgment wins);
//   - the cited evidence is appended to the notes, de-duplicated and bounded by OVERALL_NOTES_MAX;
//   - nothing is submitted: the evaluator reviews and submits the card themselves.
// ---------------------------------------------------------------------------

export interface ScorecardSuggestion {
  /** Increments per click so the same suggestion can be applied again after the evaluator edits. */
  id: number;
  key: string;
  rating: number | null;
  noteLines: string[];
}

export interface AppliedSuggestion {
  draft: ScorecardDraft;
  ratingApplied: boolean;
  /** A rating was suggested but the evaluator's existing rating was kept. */
  ratingKept: boolean;
  notesTruncated: boolean;
}

export function applySuggestion(
  draft: ScorecardDraft,
  suggestion: Omit<ScorecardSuggestion, 'id'>,
  competencyKeys: readonly string[],
): AppliedSuggestion {
  const validRating =
    suggestion.rating !== null &&
    Number.isInteger(suggestion.rating) &&
    suggestion.rating >= 1 &&
    suggestion.rating <= 5;
  const onCard = competencyKeys.includes(suggestion.key);
  const existing = draft.ratings[suggestion.key];
  const ratingApplied = validRating && onCard && existing === undefined;
  const ratingKept = validRating && onCard && existing !== undefined;

  let notes = draft.overallNotes;
  let notesTruncated = false;
  for (const raw of suggestion.noteLines) {
    const line = raw.trim();
    if (!line || notes.includes(line)) continue;
    const next = notes.length === 0 ? line : `${notes}\n${line}`;
    if (next.length > OVERALL_NOTES_MAX) {
      notesTruncated = true;
      continue;
    }
    notes = next;
  }

  return {
    draft: {
      ...draft,
      ratings: ratingApplied ? { ...draft.ratings, [suggestion.key]: suggestion.rating as number } : draft.ratings,
      overallNotes: notes,
    },
    ratingApplied,
    ratingKept,
    notesTruncated,
  };
}
