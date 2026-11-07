import { describe, it, expect, vi } from 'vitest';

// Three gaps in the CV masking of PR #421, closed before merge: quoted e-mail local parts, phone labels with
// qualifier words before the number, and third-party names (references, bosses, contacts) the app does not know.
// All names, numbers and addresses below are fictitious.
vi.mock('../../packages/ai/src/client', () => ({
  bedrockGenerate: vi.fn(),
  calculateCost: vi.fn(() => 0.01),
  maxCallUsage: vi.fn(() => ({ inputTokens: 0, outputTokens: 0, costUsd: 0 })),
  BedrockTimeoutError: class BedrockTimeoutError extends Error {},
}));
vi.mock('../../packages/ai/src/budget', () => ({ checkBudget: vi.fn() }));
vi.mock('../../packages/ai/src/cache', () => ({ getCached: vi.fn(), setCached: vi.fn() }));
vi.mock('../../packages/ai/src/logger', () => ({ logInvocation: vi.fn() }));
vi.mock('../../packages/ai/src/registry', () => ({ resolveAgentId: vi.fn(), AGENT_REGISTRY: {} }));

import { redactContactDetails } from '../../packages/ai/src/pii';
import { formatCandidateCv, guideCvFromParsedDocuments } from '../../packages/ai/src/agents/interview-guide';

describe('gap 1 — quoted e-mail local parts', () => {
  it('masks a quoted local part whole, quotes included, with straight or curly quotes', () => {
    expect(redactContactDetails('"ana ruiz"@example.com')).toBe('[email]');
    expect(redactContactDetails('escribir a “ana.ruiz”@example.cr hoy')).toBe('escribir a [email] hoy');
    expect(redactContactDetails('Correo: "ana ruiz" @ example . com')).toBe('Correo: [email]');
    expect(redactContactDetails('Correo: “ana ruiz”@\nexample.com')).toBe('Correo: [email]');
    expect(redactContactDetails('"ana\\"ruiz"@example.com')).toBe('[email]');
  });

  it('masks RFC 5322 specials in an unquoted local part, and leaves quoted prose alone', () => {
    expect(redactContactDetails("o'neil.ana@example.com")).toBe('[email]');
    expect(redactContactDetails('Lideré el proyecto "Alfa" con éxito')).toBe('Lideré el proyecto "Alfa" con éxito');
    expect(redactContactDetails('dijo “hola” y escribió a ana@example.com')).toBe('dijo “hola” y escribió a [email]');
  });
});

describe('gap 2 — phone labels with qualifier words', () => {
  it('masks a 7+ digit number after a qualified label, keeping the label', () => {
    expect(redactContactDetails('Teléfono personal: 8123 456')).toBe('Teléfono personal: [teléfono]');
    expect(redactContactDetails('Celular (oficina): 555 1234')).toBe('Celular (oficina): [teléfono]');
    expect(redactContactDetails('Tel. de casa 555-1234')).toBe('Tel. de casa [teléfono]');
    expect(redactContactDetails('Móvil / WhatsApp: 7123456')).toBe('Móvil / WhatsApp: [teléfono]');
    expect(redactContactDetails('Phone (home): 555-1234')).toBe('Phone (home): [teléfono]');
    expect(redactContactDetails('Número de teléfono: 555 1234')).toBe('Número de teléfono: [teléfono]');
    expect(redactContactDetails('Tel. móvil 555-1234')).toBe('Tel. móvil [teléfono]');
  });

  it('knows the common abbreviations missing before', () => {
    expect(redactContactDetails('Tlf: 555 1234')).toBe('Tlf: [teléfono]');
    expect(redactContactDetails('Telf. 555-1234')).toBe('Telf. [teléfono]');
    expect(redactContactDetails('Fono: 555 1234')).toBe('Fono: [teléfono]');
    expect(redactContactDetails('Num.: 555 1234')).toBe('Num.: [teléfono]');
    expect(redactContactDetails('Nro. 555-1234')).toBe('Nro. [teléfono]');
  });

  it('leaves 7-digit numbers with no phone label, and short numbers after a label, alone', () => {
    expect(redactContactDetails('Gestioné un presupuesto de 2500000 colones')).toBe(
      'Gestioné un presupuesto de 2500000 colones',
    );
    expect(redactContactDetails('Equipo de 1234567 usuarios')).toBe('Equipo de 1234567 usuarios');
    expect(redactContactDetails('Teléfono personal: 12 34')).toBe('Teléfono personal: 12 34');
    expect(redactContactDetails('Contacto con 40 clientes diarios')).toBe('Contacto con 40 clientes diarios');
  });
});

describe('gap 3a — references section', () => {
  it('drops everything from a references heading followed by ":" or a line break', () => {
    expect(redactContactDetails('Ventas B2B.\nReferencias:\nAna Ruiz, Acme, 8888-7777')).toBe(
      'Ventas B2B.\n[referencias omitidas]',
    );
    expect(redactContactDetails('Ventas B2B. Referencias personales: Luis Mora (tel 555-1234)')).toBe(
      'Ventas B2B. [referencias omitidas]',
    );
    expect(redactContactDetails('Referencias laborales\nAna Ruiz — Gerente, Acme')).toBe('[referencias omitidas]');
    expect(redactContactDetails('Logros.\nREFERENCES\nJohn Doe, Acme')).toBe('Logros.\n[referencias omitidas]');
    expect(redactContactDetails('Audits. Referees: Jane Roe')).toBe('Audits. [referencias omitidas]');
    expect(redactContactDetails('Audits. Professional references: Jane Roe')).toBe('Audits. [referencias omitidas]');
  });

  it('keeps prose that merely mentions references', () => {
    expect(redactContactDetails('provided references for two audits')).toBe('provided references for two audits');
    expect(redactContactDetails('Cuenta con referencias de clientes')).toBe('Cuenta con referencias de clientes');
  });
});

describe('gap 3b — person labels and phrases', () => {
  it('masks the name after a person label with ":", keeping the label', () => {
    expect(redactContactDetails('Jefe inmediato: Ana Ruiz')).toBe('Jefe inmediato: [nombre]');
    expect(redactContactDetails('Supervisor: Luis Mora')).toBe('Supervisor: [nombre]');
    expect(redactContactDetails('Contacto: Ana Ruiz')).toBe('Contacto: [nombre]');
    expect(redactContactDetails('Referencia: Ana Ruiz')).toBe('Referencia: [nombre]');
    // Up to 4 capitalised words, particles between them; an initial; a PDF line break inside the name.
    expect(redactContactDetails('Jefe directo: María José de la Cruz Pérez, Acme')).toBe(
      'Jefe directo: [nombre], Acme',
    );
    expect(redactContactDetails('Supervisora: Ana R. Mora.')).toBe('Supervisora: [nombre].');
    expect(redactContactDetails('Jefe inmediato: Ana\nRuiz')).toBe('Jefe inmediato: [nombre]');
    // A label followed by an honorific, and a labelled contact with a phone.
    expect(redactContactDetails('Supervisor: Ing. Luis Mora')).toBe('Supervisor: [nombre]');
    expect(redactContactDetails('Contacto: Ana Ruiz 5551234')).toBe('Contacto: [nombre] [teléfono]');
  });

  it('masks the name after a phrase that introduces a person, without a colon', () => {
    expect(redactContactDetails('Reporta a Ana Ruiz desde 2020')).toBe('Reporta a [nombre] desde 2020');
    expect(redactContactDetails('reportaba a Luis Mora y Ana Ruiz')).toBe('reportaba a [nombre]');
    expect(redactContactDetails('Reporting to John Doe, VP')).toBe('Reporting to [nombre], VP');
    expect(redactContactDetails('reported to Jane Roe')).toBe('reported to [nombre]');
    expect(redactContactDetails('bajo la supervisión de Ana Ruiz')).toBe('bajo la supervisión de [nombre]');
    expect(redactContactDetails('a cargo de Luis Mora')).toBe('a cargo de [nombre]');
  });

  it('never treats a job title without ":" or a lower-case continuation as a person', () => {
    expect(redactContactDetails('Jefe de bodega')).toBe('Jefe de bodega');
    expect(redactContactDetails('Gerente de Ventas en Acme')).toBe('Gerente de Ventas en Acme');
    expect(redactContactDetails('a cargo de la gestión de inventario')).toBe('a cargo de la gestión de inventario');
    expect(redactContactDetails('reporta a la gerencia')).toBe('reporta a la gerencia');
  });

  it('never lets a given first name shield the surname after a cue (cue pass first; it also takes an earlier mask)', () => {
    expect(redactContactDetails('Supervisor: Ana Ruiz', ['Ana'])).toBe('Supervisor: [nombre]');
    expect(redactContactDetails('Jefe: 王', ['王'])).toBe('Jefe: [nombre]');
  });
});

describe('gap 3c — honorifics', () => {
  it.each([
    'Sr.',
    'Sra.',
    'Srta.',
    'Don',
    'Doña',
    'Lic.',
    'Licda.',
    'Ing.',
    'Dr.',
    'Dra.',
    'Mr.',
    'Mrs.',
    'Ms.',
    'Prof.',
  ])('masks the name after %s, keeping the honorific', (honorific) => {
    expect(redactContactDetails(`Trabajé con ${honorific} Luis Mora Pérez en Acme`)).toBe(
      `Trabajé con ${honorific} [nombre] en Acme`,
    );
  });

  it('masks a chain of honorifics, upper-case forms with a period, and Spanish lower-case forms', () => {
    expect(redactContactDetails('Sr. Don Luis Mora')).toBe('Sr. [nombre]');
    expect(redactContactDetails('ING. LUIS MORA')).toBe('ING. [nombre]');
    expect(redactContactDetails('con el ing. Luis Mora y don Pedro Páez')).toBe('con el ing. [nombre] y don [nombre]');
    expect(redactContactDetails('la señora Ana Ruiz y doña Rosa Vega')).toBe('la señora [nombre] y doña [nombre]');
  });

  it('keeps degrees, job titles and "MS Office", which are not people', () => {
    expect(redactContactDetails('Lic. en Administración')).toBe('Lic. en Administración');
    expect(redactContactDetails('Sr. Software Engineer')).toBe('Sr. Software Engineer');
    expect(redactContactDetails('Sr. Account Executive')).toBe('Sr. Account Executive');
    expect(redactContactDetails('Ing. Industrial')).toBe('Ing. Industrial');
    expect(redactContactDetails('Manejo de MS Excel y MS Project')).toBe('Manejo de MS Excel y MS Project');
    expect(redactContactDetails('Manejo de Ms Office y Ms Excel')).toBe('Manejo de Ms Office y Ms Excel');
    expect(redactContactDetails('tiene un don para las ventas')).toBe('tiene un don para las ventas');
  });
});

describe('documented limit — a bare name with no cue', () => {
  it('is masked only when it is one of the given names (there is no NER)', () => {
    expect(redactContactDetails('trabajé con Ana Ruiz')).toBe('trabajé con Ana Ruiz');
    expect(redactContactDetails('trabajé con Ana Ruiz', ['Ana Ruiz'])).toBe('trabajé con [nombre]');
  });
});

describe('formatCandidateCv — every CV field goes through the new masking', () => {
  it('masks all three gaps in the summary and the experience, and keeps the job title', () => {
    const out = formatCandidateCv(
      {
        summary: 'Ventas B2B. Correo “ana ruiz”@example.cr, Teléfono personal: 8123 456.\nReferencias:\nLuis Mora',
        experience: [
          {
            title: 'Sr. Account Executive',
            company: 'Acme',
            startYear: 2019,
            endYear: 2023,
            description: 'Jefe inmediato: Luis Mora. Reportaba a Jane Roe. Tel. de casa 555-1234',
          },
        ],
      },
      [],
    );
    expect(out).toBe(
      'Summary: Ventas B2B. Correo [email], Teléfono personal: [teléfono].\n[referencias omitidas]\n' +
        '- Sr. Account Executive — Acme (2019–2023): Jefe inmediato: [nombre]. Reportaba a [nombre]. Tel. de casa [teléfono]',
    );
  });
});

describe('Codex round 13 on #421', () => {
  it('masks a phone split by any Unicode space separator (en, em, figure, ideographic, line separator)', () => {
    for (const sep of ['\u2002', '\u2003', '\u2007', '\u3000', '\u205f', '\u2028']) {
      const cv = formatCandidateCv({ summary: `Teléfono: 8888${sep}7777. Contacto alterno 8888${sep}6666.` });
      expect(cv).not.toMatch(/7777|6666/);
    }
  });

  it('masks every part of a surname-first parsed name ("Dvorak, Ana") in the final CV block', () => {
    const cv = guideCvFromParsedDocuments([
      {
        parsedData: {
          name: 'Dvorak, Ana',
          summary: 'Mi nombre es Ana Dvorak; DVOŘÁK lideró el equipo.',
          experience: [],
        },
      },
    ]);
    const out = formatCandidateCv(cv, ['Ana', 'Ruiz']);
    expect(out).not.toMatch(/dvo/i);
    expect(out).toContain('Mi nombre es [nombre] [nombre]');
  });
});

describe('Codex round 14 on #421: invisible characters', () => {
  it('a soft hyphen or zero-width mark inside a name or phone does not stop the masking (final CV block)', () => {
    for (const mark of ['\u00ad', '\u200b', '\u2060', '\ufeff', '\u034f', '\ufe0f']) {
      const cv = guideCvFromParsedDocuments([
        { parsedData: { name: 'José Pérez', summary: `José Pe${mark}rez, Tel: 8888${mark}7777`, experience: [] } },
      ]);
      const out = formatCandidateCv(cv) ?? '';
      expect(out).not.toMatch(/rez|7777/);
    }
  });

  it('a soft hyphen inside a supplied masking term is ignored too', () => {
    expect(redactContactDetails('Habló Pérez.', ['Pé\u00adrez'])).toBe('Habló [nombre].');
  });
});

describe('Codex round 15 on #421: separator and invisible-character classes', () => {
  it('removes every default-ignorable code point, supplementary variation selectors included', () => {
    for (const mark of ['\u{E0100}', '\u{E01EF}', '\u{E0020}', '\u115f']) {
      const out = formatCandidateCv({ summary: `Tel: 8888${mark}7777 y 8888${mark}6666` }) ?? '';
      expect(out).not.toMatch(/7777|6666/);
    }
  });

  it('joins digit groups split by any punctuation or symbol, not a fixed list', () => {
    for (const sep of ['•', '·', '|', '~', '_', '*', '∙', '‧', '◦', ':', ', ', ' • ']) {
      const out = formatCandidateCv({ summary: `Contact: +1 202${sep}555${sep}0123` }) ?? '';
      expect(out).not.toMatch(/555|0123/);
    }
  });

  it('still keeps a short number in prose', () => {
    expect(redactContactDetails('Lideré 12 personas en 3 países.')).toBe('Lideré 12 personas en 3 países.');
  });
});

describe('Codex round 16 on #421', () => {
  it('masks a phone padded with long runs of spaces, tabs or blank lines', () => {
    for (const gap of ['     ', '\t\t\t\t\t', ' \n\n\n ', '  \u2003\u2003  ']) {
      const out = formatCandidateCv({ summary: `Tel: +506${gap}8888${gap}7777` }) ?? '';
      expect(out).not.toMatch(/8888|7777/);
    }
  });

  it('masks addresses whose letters carry combining marks (Devanagari, Thai, decomposed accents)', () => {
    for (const address of [
      'अनिता@example.com',
      'สมชาย@example.co.th',
      'jose\u0301@example.com',
      'ana@exa\u0301mple.com',
    ]) {
      expect(redactContactDetails(`Correo ${address} hoy`)).toBe('Correo [email] hoy');
    }
  });
});
