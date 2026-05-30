import { PrismaClient } from '@prisma/client';

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

async function main() {
  console.log('Seeding TIMS ATS database...\n');

  // 1. Create Organization
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
  console.log(`Organization: ${org.name} (${org.id})`);

  // 2. Create Company
  const company = await db.company.upsert({
    where: { id: org.id }, // will fail on first run, that's fine
    update: {},
    create: {
      organizationId: org.id,
      name: 'TIMS Colombia',
      country: 'CO',
      currency: 'COP',
      timezone: 'America/Bogota',
      language: 'es',
      legalName: 'TIMS International S.A.S',
    },
  }).catch(async () => {
    // Company might already exist
    const existing = await db.company.findFirst({ where: { organizationId: org.id } });
    if (existing) return existing;
    return db.company.create({
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
  });
  console.log(`Company: ${company.name} (${company.id})`);

  // 3. Create Business Unit
  const unit = await db.businessUnit.findFirst({ where: { organizationId: org.id } })
    ?? await db.businessUnit.create({
      data: {
        organizationId: org.id,
        companyId: company.id,
        name: 'Operaciones',
        code: 'OPS',
      },
    });
  console.log(`Business Unit: ${unit.name} (${unit.id})`);

  // 4. Create Team
  const team = await db.team.findFirst({ where: { organizationId: org.id } })
    ?? await db.team.create({
      data: {
        organizationId: org.id,
        businessUnitId: unit.id,
        name: 'Equipo Tecnologia',
      },
    });
  console.log(`Team: ${team.name} (${team.id})`);

  // 5. Create Roles
  for (const role of SYSTEM_ROLES) {
    await db.role.upsert({
      where: { organizationId_slug: { organizationId: org.id, slug: role.slug } },
      update: {},
      create: { ...role, organizationId: org.id },
    });
  }
  console.log(`Roles: ${SYSTEM_ROLES.length} system roles created`);

  // 6. Create User (linked to existing Supabase auth user)
  const SUPABASE_USER_ID = 'cd10598f-e1ee-4a1c-9b64-541d7a4a2488'; // federico@nexadev.ai

  const user = await db.user.upsert({
    where: { supabaseUserId: SUPABASE_USER_ID },
    update: {},
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
    },
  });
  console.log(`User: ${user.firstName} ${user.lastName} (${user.id})`);

  // 7. Assign super_admin role
  const superAdminRole = await db.role.findUnique({
    where: { organizationId_slug: { organizationId: org.id, slug: 'super_admin' } },
  });

  if (superAdminRole) {
    await db.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: superAdminRole.id } },
      update: {},
      create: { userId: user.id, roleId: superAdminRole.id },
    });
    console.log(`Role assigned: super_admin → ${user.email}`);
  }

  // 8. Create Subscription
  await db.subscription.upsert({
    where: { organizationId: org.id },
    update: {},
    create: {
      organizationId: org.id,
      plan: 'enterprise',
      status: 'active',
    },
  });
  console.log('Subscription: enterprise (active)');

  console.log('\nSeed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
