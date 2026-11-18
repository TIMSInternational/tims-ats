// The pipeline every NEW vacancy starts with (existing vacancies keep the stages they were created with).
// A vacancy must have a first stage before either a recruiter or a public applicant can enter its
// pipeline, so these are created in the vacancy's nested create: a failed stage insert rolls the vacancy
// back as well.
//
// Names are what recruiters read on the board and what candidates read as "Etapa actual" in their
// portal, so they are plain, accented Spanish. SLAs are in hours and sized for a public-sector hiring
// process (days, not hours). Oferta and Contratado carry no SLA: there the wait is on the candidate and
// the paperwork, not on the recruiter, and a clock there only painted every card "SLA vencido".
export interface DefaultPipelineStage {
  readonly name: string;
  readonly slaHours: number | null;
}

export const DEFAULT_PIPELINE_STAGES: readonly DefaultPipelineStage[] = [
  { name: 'Postulación recibida', slaHours: 72 },
  { name: 'Preselección', slaHours: 120 },
  { name: 'Entrevista con RR. HH.', slaHours: 168 },
  { name: 'Prueba técnica', slaHours: 168 },
  { name: 'Entrevista final', slaHours: 168 },
  { name: 'Oferta', slaHours: null },
  { name: 'Contratado', slaHours: null },
];
