import { PrismaClient, OrgPlan, SubscriptionStatus, InvoiceStatus, InvitationType, InvitationStatus } from '@prisma/client';

const db = new PrismaClient();

const SYSTEM_ROLES = [
  { slug: 'super_admin', name: 'Super Administrador', description: 'Full access to all modules', isSystem: true },
  { slug: 'hr_admin', name: 'Administrador RRHH', description: 'Full access to all HR modules', isSystem: true },
  { slug: 'hrbp', name: 'HR Business Partner', description: 'Access to assigned business units', isSystem: true },
  { slug: 'recruiter', name: 'Reclutador', description: 'ATS modules only', isSystem: true },
  { slug: 'leader', name: 'Lider', description: 'Own team and assigned vacancies', isSystem: true },
  { slug: 'committee', name: 'Miembro de Comite', description: 'Review panels only', isSystem: true },
  { slug: 'employee', name: 'Colaborador', description: 'Self-service access', isSystem: true },
  { slug: 'candidate', name: 'Candidato', description: 'Portal access only', isSystem: true },
  { slug: 'external', name: 'API Externa', description: 'API access for integrations', isSystem: true },
];

// Helper: date N days ago
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

// Helper: date N days from now
function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

async function main() {
  console.log('Seeding TIMS ATS database...\n');

  // ===========================
  // 1. TIMS International (primary org)
  // ===========================
  const org = await db.organization.upsert({
    where: { slug: 'tims-international' },
    update: {},
    create: {
      name: 'TIMS International',
      slug: 'tims-international',
      domain: 'timshr.com',
      plan: 'enterprise',
      billingEmail: 'billing@timshr.com',
    },
  });
  console.log(`[Org] ${org.name}`);

  const company = await db.company.findFirst({ where: { organizationId: org.id } })
    ?? await db.company.create({
      data: {
        organizationId: org.id,
        name: 'TIMS Colombia',
        country: 'CO',
        currency: 'COP',
        timezone: 'America/Bogota',
        language: 'es',
        legalName: 'TIMS International S.A.S',
      },
    });

  const unit = await db.businessUnit.findFirst({ where: { organizationId: org.id } })
    ?? await db.businessUnit.create({
      data: { organizationId: org.id, companyId: company.id, name: 'Operaciones', code: 'OPS' },
    });

  await db.team.findFirst({ where: { organizationId: org.id } })
    ?? await db.team.create({
      data: { organizationId: org.id, businessUnitId: unit.id, name: 'Equipo Tecnologia' },
    });

  // Roles for TIMS
  for (const role of SYSTEM_ROLES) {
    await db.role.upsert({
      where: { organizationId_slug: { organizationId: org.id, slug: role.slug } },
      update: {},
      create: { ...role, organizationId: org.id },
    });
  }

  // Federico (platform owner)
  const SUPABASE_USER_ID = 'cd10598f-e1ee-4a1c-9b64-541d7a4a2488';
  const user = await db.user.upsert({
    where: { supabaseUserId: SUPABASE_USER_ID },
    update: { isPlatformOwner: true },
    create: {
      organizationId: org.id,
      supabaseUserId: SUPABASE_USER_ID,
      email: 'federico@nexadev.ai',
      firstName: 'Federico',
      lastName: 'Tafur',
      jobTitle: 'CTO',
      companyId: company.id,
      businessUnitId: unit.id,
      locale: 'es',
      timezone: 'America/Bogota',
      isPlatformOwner: true,
    },
  });

  const superAdminRole = await db.role.findUnique({
    where: { organizationId_slug: { organizationId: org.id, slug: 'super_admin' } },
  });
  if (superAdminRole) {
    await db.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: superAdminRole.id } },
      update: {},
      create: { userId: user.id, roleId: superAdminRole.id },
    });
  }

  // TIMS Subscription — backdate 11 months for MRR trend
  const timsSubCreatedAt = new Date();
  timsSubCreatedAt.setMonth(timsSubCreatedAt.getMonth() - 11);
  timsSubCreatedAt.setDate(1);
  await db.subscription.upsert({
    where: { organizationId: org.id },
    update: { createdAt: timsSubCreatedAt },
    create: { organizationId: org.id, plan: 'enterprise', status: 'active', createdAt: timsSubCreatedAt },
  });

  console.log(`[User] ${user.firstName} ${user.lastName} (platform owner)`);

  // ===========================
  // 2. Additional Organizations
  // ===========================
  const orgDefs: { name: string; slug: string; plan: OrgPlan; status: SubscriptionStatus; billingEmail: string; country: string; currency: string; monthsAgo: number }[] = [
    { name: 'Bancolombia', slug: 'bancolombia', plan: OrgPlan.enterprise, status: SubscriptionStatus.active, billingEmail: 'rrhh@bancolombia.com.co', country: 'CO', currency: 'COP', monthsAgo: 10 },
    { name: 'Rappi', slug: 'rappi', plan: OrgPlan.professional, status: SubscriptionStatus.active, billingEmail: 'people@rappi.com', country: 'CO', currency: 'USD', monthsAgo: 8 },
    { name: 'Grupo Nutresa', slug: 'grupo-nutresa', plan: OrgPlan.professional, status: SubscriptionStatus.active, billingEmail: 'talento@nutresa.com', country: 'CO', currency: 'COP', monthsAgo: 7 },
    { name: 'Ecopetrol', slug: 'ecopetrol', plan: OrgPlan.enterprise, status: SubscriptionStatus.active, billingEmail: 'rrhh@ecopetrol.com.co', country: 'CO', currency: 'COP', monthsAgo: 6 },
    { name: 'MercadoLibre Colombia', slug: 'mercadolibre-co', plan: OrgPlan.starter, status: SubscriptionStatus.active, billingEmail: 'hr@mercadolibre.com.co', country: 'CO', currency: 'USD', monthsAgo: 5 },
    { name: 'Globant', slug: 'globant', plan: OrgPlan.professional, status: SubscriptionStatus.active, billingEmail: 'people@globant.com', country: 'AR', currency: 'USD', monthsAgo: 4 },
    { name: 'StartupX', slug: 'startupx', plan: OrgPlan.trial, status: SubscriptionStatus.trialing, billingEmail: 'admin@startupx.io', country: 'CO', currency: 'USD', monthsAgo: 0 },
    { name: 'TechFlow Labs', slug: 'techflow-labs', plan: OrgPlan.trial, status: SubscriptionStatus.trialing, billingEmail: 'hello@techflow.dev', country: 'MX', currency: 'MXN', monthsAgo: 0 },
    { name: 'AgroVerde S.A.', slug: 'agroverde', plan: OrgPlan.starter, status: SubscriptionStatus.active, billingEmail: 'admin@agroverde.co', country: 'CO', currency: 'COP', monthsAgo: 3 },
    { name: 'CloudNine Solutions', slug: 'cloudnine', plan: OrgPlan.professional, status: SubscriptionStatus.past_due, billingEmail: 'billing@cloudnine.io', country: 'US', currency: 'USD', monthsAgo: 2 },
  ];

  const orgs: Record<string, typeof org> = {};
  for (const od of orgDefs) {
    const o = await db.organization.upsert({
      where: { slug: od.slug },
      update: {},
      create: {
        name: od.name,
        slug: od.slug,
        plan: od.plan,
        billingEmail: od.billingEmail,
      },
    });
    orgs[od.slug] = o;

    // Subscription — backdate createdAt so MRR trend chart shows growth
    const subCreatedAt = new Date();
    subCreatedAt.setMonth(subCreatedAt.getMonth() - od.monthsAgo);
    subCreatedAt.setDate(1);
    const periodStart = new Date();
    periodStart.setDate(1);
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + 1);
    await db.subscription.upsert({
      where: { organizationId: o.id },
      update: { createdAt: subCreatedAt },
      create: {
        organizationId: o.id,
        plan: od.plan,
        status: od.status,
        createdAt: subCreatedAt,
        trialEndsAt: od.status === 'trialing' ? daysFromNow(od.slug === 'startupx' ? 15 : 10) : null,
        currentPeriodStart: od.status === 'active' || od.status === 'past_due' ? periodStart : null,
        currentPeriodEnd: od.status === 'active' || od.status === 'past_due' ? periodEnd : null,
      },
    });

    // System roles
    for (const role of SYSTEM_ROLES.slice(0, 3)) {
      await db.role.upsert({
        where: { organizationId_slug: { organizationId: o.id, slug: role.slug } },
        update: {},
        create: { ...role, organizationId: o.id },
      });
    }

    console.log(`[Org] ${o.name} (${od.plan}/${od.status})`);
  }

  // ===========================
  // 3. Billing Profiles
  // ===========================
  const billingDefs = [
    { slug: 'tims-international', orgId: org.id, companyName: 'TIMS International S.A.S', taxId: '901234567-1', address: 'Carrera 7 #71-21 Oficina 1002', city: 'Bogota', state: 'Cundinamarca', country: 'Colombia', zipCode: '110231', billingEmail: 'billing@timshr.com', billingPhone: '+57 601 345 6789' },
    { slug: 'bancolombia', companyName: 'Bancolombia S.A.', taxId: '890903938-8', address: 'Carrera 48 #26-85', city: 'Medellin', state: 'Antioquia', country: 'Colombia', zipCode: '050015', billingEmail: 'rrhh@bancolombia.com.co', billingPhone: '+57 604 510 7272' },
    { slug: 'rappi', companyName: 'Rappi S.A.S', taxId: '900786543-2', address: 'Calle 100 #19A-30', city: 'Bogota', state: 'Cundinamarca', country: 'Colombia', zipCode: '110111', billingEmail: 'finance@rappi.com', billingPhone: '+57 601 987 6543' },
    { slug: 'ecopetrol', companyName: 'Ecopetrol S.A.', taxId: '899999068-1', address: 'Carrera 13 #36-24', city: 'Bogota', state: 'Cundinamarca', country: 'Colombia', zipCode: '110311', billingEmail: 'contabilidad@ecopetrol.com.co', billingPhone: '+57 601 234 4000' },
    { slug: 'globant', companyName: 'Globant S.A.', taxId: '30-71044895-0', address: 'Ing. Butty 240, Piso 7', city: 'Buenos Aires', state: 'CABA', country: 'Argentina', zipCode: 'C1001AFB', billingEmail: 'ap@globant.com', billingPhone: '+54 11 5789 0100' },
  ];

  for (const bp of billingDefs) {
    const orgForProfile = bp.orgId ? { id: bp.orgId } : orgs[bp.slug];
    if (!orgForProfile) continue;
    await db.billingProfile.upsert({
      where: { organizationId: orgForProfile.id },
      update: {},
      create: {
        organizationId: orgForProfile.id,
        companyName: bp.companyName,
        taxId: bp.taxId,
        address: bp.address,
        city: bp.city,
        state: bp.state,
        country: bp.country,
        zipCode: bp.zipCode,
        billingEmail: bp.billingEmail,
        billingPhone: bp.billingPhone,
      },
    });
    console.log(`[Billing] ${bp.companyName}`);
  }

  // ===========================
  // 4. Invoices with Line Items
  // ===========================
  const existingInvoices = await db.invoice.count();
  if (existingInvoices === 0) {
    const invoiceDefs: { orgSlug: string; status: InvoiceStatus; currency: string; invoiceDate: Date; dueDate?: Date | null; paidAt?: Date | null; poNumber?: string | null; memo?: string | null; emailTo?: string | null; notes?: string | null; items: { description: string; quantity: number; unitPrice: number }[] }[] = [
      // PAID invoices
      { orgSlug: 'bancolombia', status: InvoiceStatus.paid, currency: 'COP', invoiceDate: daysAgo(60), dueDate: daysAgo(30), paidAt: daysAgo(28), poNumber: 'PO-2026-0412', memo: 'Pago correspondiente al mes de abril 2026', emailTo: 'rrhh@bancolombia.com.co',
        items: [
          { description: 'Licencia TIMS ATS Enterprise - Abril 2026', quantity: 1, unitPrice: 9500000 },
          { description: 'Soporte premium 24/7', quantity: 1, unitPrice: 2000000 },
          { description: 'Modulo de IA - Screening automatico', quantity: 1, unitPrice: 1500000 },
        ]},
      { orgSlug: 'bancolombia', status: InvoiceStatus.paid, currency: 'COP', invoiceDate: daysAgo(30), dueDate: daysAgo(1), paidAt: daysAgo(3), poNumber: 'PO-2026-0512', memo: 'Pago correspondiente al mes de mayo 2026', emailTo: 'rrhh@bancolombia.com.co',
        items: [
          { description: 'Licencia TIMS ATS Enterprise - Mayo 2026', quantity: 1, unitPrice: 9500000 },
          { description: 'Soporte premium 24/7', quantity: 1, unitPrice: 2000000 },
          { description: 'Modulo de IA - Screening automatico', quantity: 1, unitPrice: 1500000 },
        ]},
      { orgSlug: 'rappi', status: InvoiceStatus.paid, currency: 'USD', invoiceDate: daysAgo(45), dueDate: daysAgo(15), paidAt: daysAgo(16), emailTo: 'finance@rappi.com',
        items: [
          { description: 'TIMS ATS Professional - April 2026', quantity: 1, unitPrice: 999 },
          { description: 'Additional users (50 seats)', quantity: 50, unitPrice: 5 },
        ]},
      { orgSlug: 'ecopetrol', status: InvoiceStatus.paid, currency: 'COP', invoiceDate: daysAgo(40), dueDate: daysAgo(10), paidAt: daysAgo(8), poNumber: 'ECO-PO-2026-287', emailTo: 'contabilidad@ecopetrol.com.co',
        items: [
          { description: 'Licencia TIMS ATS Enterprise - Abril 2026', quantity: 1, unitPrice: 12000000 },
          { description: 'Implementacion y onboarding', quantity: 40, unitPrice: 250000 },
          { description: 'Integracion SAP SuccessFactors', quantity: 1, unitPrice: 5000000 },
        ]},
      { orgSlug: 'globant', status: InvoiceStatus.paid, currency: 'USD', invoiceDate: daysAgo(35), dueDate: daysAgo(5), paidAt: daysAgo(4), emailTo: 'ap@globant.com',
        items: [
          { description: 'TIMS ATS Professional License - May 2026', quantity: 1, unitPrice: 999 },
          { description: 'AI Assessment Module', quantity: 1, unitPrice: 299 },
        ]},

      // PENDING invoices
      { orgSlug: 'rappi', status: InvoiceStatus.pending, currency: 'USD', invoiceDate: daysAgo(5), dueDate: daysFromNow(25), emailTo: 'finance@rappi.com', memo: 'Monthly platform subscription',
        items: [
          { description: 'TIMS ATS Professional - May 2026', quantity: 1, unitPrice: 999 },
          { description: 'Additional users (50 seats)', quantity: 50, unitPrice: 5 },
        ]},
      { orgSlug: 'grupo-nutresa', status: InvoiceStatus.pending, currency: 'COP', invoiceDate: daysAgo(3), dueDate: daysFromNow(27), poNumber: 'NUT-2026-0517', emailTo: 'talento@nutresa.com',
        items: [
          { description: 'Licencia TIMS ATS Professional - Junio 2026', quantity: 1, unitPrice: 4500000 },
          { description: 'Modulo de Onboarding', quantity: 1, unitPrice: 800000 },
        ]},
      { orgSlug: 'mercadolibre-co', status: InvoiceStatus.pending, currency: 'USD', invoiceDate: daysAgo(2), dueDate: daysFromNow(28), emailTo: 'hr@mercadolibre.com.co',
        items: [
          { description: 'TIMS ATS Starter - June 2026', quantity: 1, unitPrice: 499 },
        ]},
      { orgSlug: 'agroverde', status: InvoiceStatus.pending, currency: 'COP', invoiceDate: daysAgo(1), dueDate: daysFromNow(29), emailTo: 'admin@agroverde.co',
        items: [
          { description: 'Licencia TIMS ATS Starter - Junio 2026', quantity: 1, unitPrice: 2200000 },
          { description: 'Capacitacion virtual (5 horas)', quantity: 5, unitPrice: 150000 },
        ]},

      // OVERDUE invoices
      { orgSlug: 'cloudnine', status: InvoiceStatus.pending, currency: 'USD', invoiceDate: daysAgo(45), dueDate: daysAgo(15), emailTo: 'billing@cloudnine.io', notes: 'Cliente con historial de pagos tardios',
        items: [
          { description: 'TIMS ATS Professional - April 2026', quantity: 1, unitPrice: 999 },
          { description: 'AI Pipeline Optimizer', quantity: 1, unitPrice: 199 },
        ]},
      { orgSlug: 'cloudnine', status: InvoiceStatus.pending, currency: 'USD', invoiceDate: daysAgo(15), dueDate: daysAgo(1), emailTo: 'billing@cloudnine.io', notes: 'Segundo mes sin pagar - considerar suspension',
        items: [
          { description: 'TIMS ATS Professional - May 2026', quantity: 1, unitPrice: 999 },
          { description: 'AI Pipeline Optimizer', quantity: 1, unitPrice: 199 },
        ]},

      // VOID invoice
      { orgSlug: 'globant', status: InvoiceStatus.void, currency: 'USD', invoiceDate: daysAgo(50), dueDate: daysAgo(20), emailTo: 'ap@globant.com', notes: 'Anulada - factura duplicada',
        items: [
          { description: 'TIMS ATS Professional License - April 2026 (DUPLICATE)', quantity: 1, unitPrice: 999 },
        ]},

      // DRAFT invoice
      { orgSlug: 'ecopetrol', status: InvoiceStatus.draft, currency: 'COP', invoiceDate: new Date(), poNumber: 'ECO-PO-2026-341', notes: 'Pendiente aprobacion interna',
        items: [
          { description: 'Licencia TIMS ATS Enterprise - Junio 2026', quantity: 1, unitPrice: 12000000 },
          { description: 'Soporte premium 24/7', quantity: 1, unitPrice: 3000000 },
          { description: 'Modulo de Sucesion', quantity: 1, unitPrice: 2500000 },
          { description: 'Capacitacion presencial (2 dias)', quantity: 2, unitPrice: 4000000 },
        ]},
    ];

    for (const invDef of invoiceDefs) {
      const invOrg = orgs[invDef.orgSlug];
      if (!invOrg) continue;

      const subtotal = invDef.items.reduce((s, li) => s + li.quantity * li.unitPrice, 0);

      await db.invoice.create({
        data: {
          organizationId: invOrg.id,
          amount: subtotal,
          subtotal,
          currency: invDef.currency,
          status: invDef.status,
          invoiceDate: invDef.invoiceDate,
          dueDate: invDef.dueDate || null,
          poNumber: invDef.poNumber || null,
          notes: invDef.notes || null,
          memo: invDef.memo || null,
          emailTo: invDef.emailTo || null,
          paidAt: invDef.paidAt || null,
          lineItems: {
            create: invDef.items.map((li, i) => ({
              description: li.description,
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              total: li.quantity * li.unitPrice,
              sortOrder: i,
            })),
          },
        },
      });
      console.log(`[Invoice] ${invDef.orgSlug} - ${invDef.status} - ${invDef.currency} ${subtotal}`);
    }
  } else {
    console.log(`[Invoice] Skipped — ${existingInvoices} invoices already exist`);
  }

  // ===========================
  // 5. Platform Invitations
  // ===========================
  const existingInvitations = await db.platformInvitation.count();
  if (existingInvitations === 0) {
    const invitationDefs: { email: string; type: InvitationType; orgSlug: string; roleSlug?: string; status: InvitationStatus; sentAt: Date | null; acceptedAt?: Date }[] = [
      // Accepted org admin invitations
      { email: 'carlos.mendez@bancolombia.com.co', type: InvitationType.org_admin, orgSlug: 'bancolombia', status: InvitationStatus.accepted, sentAt: daysAgo(90), acceptedAt: daysAgo(88) },
      { email: 'people@rappi.com', type: InvitationType.org_admin, orgSlug: 'rappi', status: InvitationStatus.accepted, sentAt: daysAgo(75), acceptedAt: daysAgo(74) },
      { email: 'rrhh@ecopetrol.com.co', type: InvitationType.org_admin, orgSlug: 'ecopetrol', status: InvitationStatus.accepted, sentAt: daysAgo(60), acceptedAt: daysAgo(58) },
      { email: 'hr.lead@globant.com', type: InvitationType.org_admin, orgSlug: 'globant', status: InvitationStatus.accepted, sentAt: daysAgo(50), acceptedAt: daysAgo(49) },

      // Accepted user invitations
      { email: 'ana.garcia@bancolombia.com.co', type: InvitationType.user, orgSlug: 'bancolombia', roleSlug: 'recruiter', status: InvitationStatus.accepted, sentAt: daysAgo(80), acceptedAt: daysAgo(79) },
      { email: 'jorge.ruiz@rappi.com', type: InvitationType.user, orgSlug: 'rappi', roleSlug: 'hr_admin', status: InvitationStatus.accepted, sentAt: daysAgo(70), acceptedAt: daysAgo(68) },
      { email: 'maria.lopez@ecopetrol.com.co', type: InvitationType.user, orgSlug: 'ecopetrol', roleSlug: 'recruiter', status: InvitationStatus.accepted, sentAt: daysAgo(55), acceptedAt: daysAgo(53) },

      // Pending/sent invitations
      { email: 'admin@agroverde.co', type: InvitationType.org_admin, orgSlug: 'agroverde', status: InvitationStatus.sent, sentAt: daysAgo(5) },
      { email: 'talento@nutresa.com', type: InvitationType.org_admin, orgSlug: 'grupo-nutresa', status: InvitationStatus.sent, sentAt: daysAgo(3) },
      { email: 'new.recruiter@bancolombia.com.co', type: InvitationType.user, orgSlug: 'bancolombia', roleSlug: 'recruiter', status: InvitationStatus.sent, sentAt: daysAgo(2) },
      { email: 'hiring.manager@rappi.com', type: InvitationType.user, orgSlug: 'rappi', roleSlug: 'leader', status: InvitationStatus.sent, sentAt: daysAgo(1) },
      { email: 'hr@mercadolibre.com.co', type: InvitationType.org_admin, orgSlug: 'mercadolibre-co', status: InvitationStatus.pending, sentAt: null },

      // Expired invitations
      { email: 'old.admin@techstartup.co', type: InvitationType.org_admin, orgSlug: 'techflow-labs', status: InvitationStatus.expired, sentAt: daysAgo(30) },
      { email: 'exrecruiter@globant.com', type: InvitationType.user, orgSlug: 'globant', roleSlug: 'recruiter', status: InvitationStatus.expired, sentAt: daysAgo(21) },

      // Revoked
      { email: 'wrong.person@cloudnine.io', type: InvitationType.org_admin, orgSlug: 'cloudnine', status: InvitationStatus.revoked, sentAt: daysAgo(10) },
    ];

    for (const invDef of invitationDefs) {
      const invOrg = orgs[invDef.orgSlug];
      if (!invOrg) continue;

      await db.platformInvitation.create({
        data: {
          email: invDef.email,
          type: invDef.type,
          organizationId: invOrg.id,
          organizationName: invOrg.name,
          organizationSlug: invOrg.slug,
          roleSlug: invDef.roleSlug || null,
          status: invDef.status,
          invitedById: user.id,
          sentAt: invDef.sentAt || null,
          acceptedAt: invDef.acceptedAt || null,
          expiresAt: invDef.status === 'expired' ? daysAgo(1) : daysFromNow(7),
        },
      });
      console.log(`[Invitation] ${invDef.email} → ${invDef.orgSlug} (${invDef.status})`);
    }
  } else {
    console.log(`[Invitation] Skipped — ${existingInvitations} invitations already exist`);
  }

  // ===========================
  // 6. Platform Owner Emails
  // ===========================
  await db.platformOwnerEmail.upsert({
    where: { email: 'federico@nexadev.ai' },
    update: {},
    create: { email: 'federico@nexadev.ai' },
  });
  console.log(`[PlatformOwner] federico@nexadev.ai`);

  console.log('\nSeed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
