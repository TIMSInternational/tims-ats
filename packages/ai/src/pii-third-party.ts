// ---------------------------------------------------------------------------
// Third-party people in CV free text (references, bosses, contacts) — used by redactContactDetails (pii.ts).
//
// There is no NER here. A name the app does not know is found only through a deterministic CUE:
//  - a references section heading → the whole rest of the field is dropped;
//  - an honorific ("Sr.", "Lic.", "Dr.", "Mrs."), a label followed by ":" ("Jefe inmediato:", "Contacto:",
//    "Referencia:"), or a phrase ("reporta a", "bajo la supervisión de", "reporting to") → the person-like name
//    right after it (1–4 capitalised words, name particles such as "de la" / "y" allowed between them) is masked.
// Over-masking an organisation or another capitalised word in those positions is accepted; leaking a person is
// not. A bare name with no cue ("trabajé con Ana Ruiz") is NOT detected: telling a person from a company or a job
// title needs NER (Presidio, deferred), and masking every capitalised word would mask companies and titles too.
// Input is expected NFC-normalised with invisible characters removed (redactContactDetails does both first).
// ---------------------------------------------------------------------------

const NAME_MASK = '[nombre]';
const REFERENCES_MASK = '[referencias omitidas]';

// "Referencias (personales|laborales|profesionales|comerciales)", "References", "Personal references", "Referees",
// "Referências (pessoais|profissionais)" — followed by ":" or a line break, so prose such as "provided references
// for two audits" is not a heading.
const REFERENCES_HEADING =
  String.raw`(?:referencias(?:\s+(?:personales|laborales|profesionales|comerciales)(?:\s+y\s+(?:personales|laborales|profesionales|comerciales))?)?` +
  String.raw`|refer[eê]ncias(?:\s+(?:pessoais|profissionais))?|(?:(?:personal|professional|work|employment|character)\s+)?(?:references|referees))`;
const REFERENCES_SECTION = new RegExp(String.raw`(?<![\p{L}\p{N}])${REFERENCES_HEADING}[ \t*_]*(?::|\r?\n)`, 'iu');

/** Everything from a references heading to the end of the text becomes "[referencias omitidas]". */
export function cutReferencesSection(text: string): string {
  const heading = REFERENCES_SECTION.exec(text);
  return heading ? `${text.slice(0, heading.index)}${REFERENCES_MASK}` : text;
}

// Honorifics, matched CASE-SENSITIVELY: an abbreviation in title case with an optional period ("Sr.", "Mr"), in
// upper or lower case only WITH the period ("SR.", "el ing. Mora" — so "MS Excel" or "DR" are never cues); a word
// ("don", "doña", "señor…", written lower-case mid-sentence in Spanish) in lower, title or upper case.
const ABBREVIATIONS = 'Srta Sra Sr Licda Licdo Lcda Lcdo Lic Ing Dra Dr Dña Mrs Mr Ms Prof'.split(' ');
const HONORIFIC_WORDS = 'Señorita Señora Señor Doña Don'.split(' ');
const inCase = (words: string[], toCase: (w: string) => string) => words.map(toCase).join('|');
const upper = (w: string) => w.toUpperCase();
const lower = (w: string) => w.toLowerCase();
const HONORIFIC =
  `(?:(?:${ABBREVIATIONS.join('|')})\\.?|(?:${inCase(ABBREVIATIONS, upper)}|${inCase(ABBREVIATIONS, lower)})\\.` +
  `|${HONORIFIC_WORDS.join('|')}|${inCase(HONORIFIC_WORDS, upper)}|${inCase(HONORIFIC_WORDS, lower)})`;

// A capitalised word ("Ana", "O'Neil", "Ruiz-Mora", "ANA"), an initial ("R."), or an earlier mask.
const NAME_WORD = String.raw`(?:\[nombre\]|[\p{Lu}\p{Lt}]\.(?=\s)|[\p{Lu}\p{Lt}][\p{L}\p{M}'’]*(?:-[\p{L}\p{M}'’]+)*)`;
// Whitespace holding at most one line break (a PDF wrap); a blank line ends the name. Written so a run of spaces
// can be split only one way (no backtracking blow-up on long whitespace).
const SEP = String.raw`(?:[^\S\n]+(?:\n[^\S\n]*)?|\n[^\S\n]*)`;
const PARTICLE = '(?:de|del|la|las|los|y|e|da|das|do|dos|van|von|der|di|le)';
// 1–4 capitalised words with lower-case particles between them, optionally behind an honorific (case-sensitive:
// a lower-case word such as "en" in "Lic. en Administración" ends it). Sticky: matched only where a cue ends.
const PERSON = new RegExp(`(?:${HONORIFIC}${SEP})?${NAME_WORD}(?:${SEP}(?:${PARTICLE}${SEP})*${NAME_WORD}){0,3}`, 'uy');

const HONORIFIC_CUE = new RegExp(`(?<![\\p{L}\\p{N}])${HONORIFIC}\\s+`, 'gu');
// A label that introduces a person, then up to 3 qualifier words or a parenthesised one, then ":" — required, so
// a job title ("Jefe de bodega", "Gerente de Ventas en Acme") is never a cue. Case- and accent-insensitive.
const PERSON_LABEL =
  String.raw`(?:jef[ea]|supervisor[a]?|gerente|contacto|contato|contact|referencia|reference|referee|referente|encargad[oa]` +
  String.raw`|coordinador[a]?|director[a]?|manager|boss|chefe|gestor[a]?|l[ií]der|responsable|asesor[a]?|tutor[a]?|mentor[a]?|nombre|nome|name)`;
const LABEL_CUE = new RegExp(
  String.raw`${PERSON_LABEL}(?:es|s)?(?:[^\S\n]+[\p{L}\p{M}]{1,20}|[^\S\n]*\([\p{L}\p{M}\s]{1,30}\)){0,3}[ \t*_]*:[*_]*\s*`,
  'giu',
);
// Phrases that introduce a person without a colon; only capitalised words after them are masked ("a cargo de la
// gestión" stays).
const PERSON_PHRASE =
  String.raw`(?:report(?:a|aba|ando|ar|[eé]|[oó])(?:\s+directamente)?\s+al?|report(?:s|ed|ing)?(?:\s+directly)?\s+to` +
  String.raw`|bajo\s+(?:la\s+)?(?:supervisi[oó]n|direcci[oó]n|coordinaci[oó]n|jefatura|tutela)\s+del?|a\s+cargo\s+del?` +
  String.raw`|(?:supervisad|dirigid|coordinad)[oa]s?\s+por|(?:supervised|managed|mentored)\s+by|under\s+the\s+(?:supervision|direction)\s+of)`;
const PHRASE_CUE = new RegExp(String.raw`(?<![\p{L}\p{N}])${PERSON_PHRASE}(?![\p{L}\p{N}])(?:[ \t]*:)?\s+`, 'giu');

// A job title, a degree or a product after "Sr." / "Ing." / "Lic." / "Ms" ("Sr. Software Engineer", "Ing.
// Industrial", "Lic. Administración", "Ms Office") is not a person: the honorific cue is ignored when its FIRST word
// is one of these.
const TITLE_WORDS = new Set(
  (
    'software developer engineer manager account accountant sales analyst consultant director executive product project ' +
    'program data associate specialist designer architect business marketing financial finance technical systems network ' +
    'web frontend backend fullstack full operations quality research customer support administrator recruiter talent ' +
    'security cloud devops mobile advisor officer representative supervisor lead coordinator buyer planner ' +
    'industrial civil quimica quimico mecanica mecanico electrica electrico electronica electronico electromecanica ' +
    'sistemas informatica computacion agronomia agronomo ambiental biomedica telecomunicaciones administracion contaduria ' +
    'contabilidad derecho psicologia mercadeo economia finanzas enfermeria educacion comercio relaciones recursos ciencias ' +
    'ingenieria arquitectura periodismo comunicacion diseno negocios banca turismo estadistica matematica produccion ' +
    'calidad logistica office excel word powerpoint outlook access teams visio sharepoint dynamics windows sql azure'
  ).split(' '),
);
const baseLower = (word: string) => word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Replace the person-like name right after every `cue` match with "[nombre]" (the cue itself is kept). */
function maskPersonsAfter(text: string, cue: RegExp, skipFirstWords?: ReadonlySet<string>): string {
  const spans: Array<[number, number]> = [];
  for (const m of text.matchAll(cue)) {
    PERSON.lastIndex = m.index! + m[0].length;
    const person = PERSON.exec(text);
    if (!person) continue;
    if (skipFirstWords?.has(baseLower(person[0].split(/\s/)[0]!))) continue;
    spans.push([person.index, person.index + person[0].length]);
  }
  // Spans can overlap ("Sr. Don Luis": both honorifics are cues); merge them, then cut right to left.
  const merged: Array<[number, number]> = [];
  for (const [start, end] of spans.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  let out = text;
  for (const [start, end] of merged.reverse()) out = `${out.slice(0, start)}${NAME_MASK}${out.slice(end)}`;
  return out;
}

/** Mask the names that follow an honorific, a person label with ":", or a person-introducing phrase. */
export function maskCuedThirdPartyNames(text: string): string {
  // Honorifics first, so a label followed by one ("Supervisor: Ing. Luis Mora") still reaches the name.
  const out = maskPersonsAfter(text, HONORIFIC_CUE, TITLE_WORDS);
  return maskPersonsAfter(maskPersonsAfter(out, LABEL_CUE), PHRASE_CUE);
}
