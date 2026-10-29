/**
 * Versioned declaration a candidate accepts when applying (WP-26). The server stores the version, the
 * locale and a SHA-256 of the exact text (see `declarationTextSha256` in `../server`, kept out of this
 * client-safe module). `invu-decl-v0` is a neutral placeholder: add a new version, never edit a shipped one.
 */
export const INTAKE_DECLARATION_TEXT_VERSIONS = ['invu-decl-v0'] as const;
export type IntakeDeclarationTextVersion = (typeof INTAKE_DECLARATION_TEXT_VERSIONS)[number];
export const INTAKE_DECLARATION_TEXT_VERSION: IntakeDeclarationTextVersion = 'invu-decl-v0';

export const INTAKE_DECLARATION_LOCALES = ['es', 'en'] as const;
export type IntakeDeclarationLocale = (typeof INTAKE_DECLARATION_LOCALES)[number];

export const INTAKE_DECLARATION_TEXT: Record<IntakeDeclarationTextVersion, Record<IntakeDeclarationLocale, string>> = {
  'invu-decl-v0': {
    es: 'Declaro que la información y los documentos que presento en esta postulación son verdaderos y que cumplo con los requisitos publicados para el puesto. Entiendo que la información falsa o incompleta puede excluir mi postulación del proceso.',
    en: 'I declare that the information and documents I submit with this application are true and that I meet the published requirements for the position. I understand that false or incomplete information may exclude my application from the process.',
  },
};
