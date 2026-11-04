// ---------------------------------------------------------------------------
// Copy for the localized interview emails (interview-email-templates.ts)
// ---------------------------------------------------------------------------
// Candidate-facing Spanish uses "usted" and "postulación". Functions take values
// that the caller has ALREADY escaped (see the templates file).

export type EmailLocale = 'es' | 'en';

export const INTERVIEW_TYPE_LABELS: Record<EmailLocale, Record<string, string>> = {
  es: {
    phone: 'Telefónica',
    video: 'Videoconferencia',
    technical: 'Técnica',
    cultural: 'Cultural',
    panel: 'Panel',
    onsite: 'Presencial',
    in_person: 'Presencial',
    online: 'En línea',
  },
  en: {
    phone: 'Phone',
    video: 'Video call',
    technical: 'Technical',
    cultural: 'Cultural fit',
    panel: 'Panel',
    onsite: 'In person',
    in_person: 'In person',
    online: 'Online',
  },
};

/** Types that mean "where", not "what": with a meeting link they simply become "En línea". */
export const PLACE_TYPES: ReadonlySet<string> = new Set(['onsite', 'in_person', 'online']);

export const INTERVIEW_EMAIL_COPY = {
  es: {
    subject: { invite: 'Invitación a entrevista', update: 'Entrevista reprogramada', cancel: 'Entrevista cancelada' },
    evaluatorSubject: {
      invite: 'Nueva entrevista asignada',
      update: 'Entrevista reprogramada',
      cancel: 'Entrevista cancelada',
    },
    greeting: (n: string) => `Estimado/a ${n},`,
    candidateIntro: {
      invite: (v: string, c: string) =>
        `Nos complace invitarle a una entrevista para el cargo de <strong>${v}</strong> en ${c}.`,
      update: (v: string) =>
        `Su entrevista para el cargo de <strong>${v}</strong> ha sido reprogramada. Los nuevos detalles son:`,
      cancel: (v: string) =>
        `Lamentamos informarle que la entrevista para el cargo de <strong>${v}</strong> ha sido cancelada.`,
    },
    evaluatorIntro: {
      invite: (cand: string, v: string) =>
        `Ha sido asignado/a como evaluador/a de la entrevista de <strong>${cand}</strong> para el cargo de <strong>${v}</strong>.`,
      update: (cand: string, v: string) =>
        `La entrevista de <strong>${cand}</strong> para el cargo de <strong>${v}</strong> ha sido reprogramada.`,
      cancel: (cand: string, v: string) =>
        `La entrevista de <strong>${cand}</strong> para el cargo de <strong>${v}</strong> ha sido cancelada.`,
    },
    when: 'Fecha y hora',
    previous: 'Fecha anterior',
    type: 'Tipo',
    duration: 'Duración',
    minutes: 'minutos',
    place: 'Lugar',
    link: 'Enlace',
    reason: 'Motivo',
    candidate: 'Candidato/a',
    join: 'Unirse a la entrevista',
    joinMeeting: 'Unirse a la reunión',
    room: 'Abrir sala de entrevista',
    scorecard: 'Abrir ficha de evaluación',
    scorecardNote: 'Registre su evaluación en TIMS al terminar la entrevista.',
    online: 'en línea',
    joinNote:
      'El enlace es personal y se habilita 15 minutos antes de la hora programada. Si la entrevista se reprograma, recibirá un enlace nuevo y este dejará de funcionar.',
    phoneNote: 'Le contactaremos por teléfono al número registrado en su postulación a la hora indicada.',
    cancelNextStep: 'Si la entrevista se reprograma, recibirá una nueva invitación por este medio.',
    calendarNote: 'Adjuntamos una invitación de calendario (.ics) para que la agregue a su agenda.',
    cancelCalendarNote: 'Adjuntamos la cancelación para actualizar su calendario.',
    questions: 'Si tiene preguntas, escríbanos a',
    regards: 'Cordialmente,<br>Equipo de Talento Humano',
    interview: 'Entrevista',
  },
  en: {
    subject: { invite: 'Interview invitation', update: 'Interview rescheduled', cancel: 'Interview cancelled' },
    evaluatorSubject: {
      invite: 'New interview assigned',
      update: 'Interview rescheduled',
      cancel: 'Interview cancelled',
    },
    greeting: (n: string) => `Dear ${n},`,
    candidateIntro: {
      invite: (v: string, c: string) =>
        `We are pleased to invite you to an interview for the <strong>${v}</strong> position at ${c}.`,
      update: (v: string) =>
        `Your interview for the <strong>${v}</strong> position has been rescheduled. The new details are:`,
      cancel: (v: string) =>
        `We regret to inform you that the interview for the <strong>${v}</strong> position has been cancelled.`,
    },
    evaluatorIntro: {
      invite: (cand: string, v: string) =>
        `You have been assigned as an evaluator for <strong>${cand}</strong>'s interview for the <strong>${v}</strong> position.`,
      update: (cand: string, v: string) =>
        `<strong>${cand}</strong>'s interview for the <strong>${v}</strong> position has been rescheduled.`,
      cancel: (cand: string, v: string) =>
        `<strong>${cand}</strong>'s interview for the <strong>${v}</strong> position has been cancelled.`,
    },
    when: 'Date and time',
    previous: 'Previous date',
    type: 'Type',
    duration: 'Duration',
    minutes: 'minutes',
    place: 'Location',
    link: 'Link',
    reason: 'Reason',
    candidate: 'Candidate',
    join: 'Join the interview',
    joinMeeting: 'Join the meeting',
    room: 'Open interview room',
    scorecard: 'Open the scorecard',
    scorecardNote: 'Record your evaluation in TIMS once the interview is over.',
    online: 'online',
    joinNote:
      'This link is personal and opens 15 minutes before the scheduled time. If the interview is rescheduled you will receive a new link and this one will stop working.',
    phoneNote: 'We will call you at the phone number in your application at the scheduled time.',
    cancelNextStep: 'If the interview is rescheduled, you will receive a new invitation by email.',
    calendarNote: 'A calendar invitation (.ics) is attached so you can add it to your calendar.',
    cancelCalendarNote: 'The cancellation is attached so your calendar is updated.',
    questions: 'If you have any questions, write to us at',
    regards: 'Kind regards,<br>Talent Team',
    interview: 'Interview',
  },
} as const;
