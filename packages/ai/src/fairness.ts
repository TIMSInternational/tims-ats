// ---------------------------------------------------------------------------
// Fairness rules shared by every agent that evaluates a candidate.
//
// Candidates are scored by AI, so the prompts that score or rank them carry the
// same explicit instruction: judge job-relevant evidence only, and never infer,
// use or mention a protected characteristic. The agents also stop sending the
// candidate's name (a common proxy for sex and ethnicity) — see
// CANDIDATE_LABEL.
// ---------------------------------------------------------------------------

/** Neutral label used in prompts instead of the candidate's name. */
export const CANDIDATE_LABEL = 'the candidate';

export const PROTECTED_CHARACTERISTICS = [
  'age',
  'sex or gender',
  'gender identity',
  'race or ethnicity',
  'skin colour',
  'national or social origin',
  'nationality',
  'religion or belief',
  'disability or health',
  'pregnancy or parental status',
  'marital or family status',
  'political views',
  'union membership',
  'sexual orientation',
  'socioeconomic status',
] as const;

/** Appended to the system prompt of every candidate-evaluating agent. */
export const PROTECTED_ATTRIBUTES_RULE = `Fairness rules (mandatory):
- Do NOT infer, guess, use or mention any protected characteristic of the candidate: ${PROTECTED_CHARACTERISTICS.join(', ')}.
- Do not use proxies for them either (name, photo, home address, or a graduation year used as a stand-in for age).
- Score and explain ONLY from job-relevant evidence: skills, experience, qualifications and demonstrated competencies against the stated requirements.
- If the data mentions a protected characteristic, ignore it and do not repeat it.
- Refer to the person only as "${CANDIDATE_LABEL}".
- Your output is advisory; a human recruiter makes the decision.`;
