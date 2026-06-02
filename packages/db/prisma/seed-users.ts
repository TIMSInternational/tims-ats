import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

const db = new PrismaClient();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lzhfnjfsdwdywwnlqgqq.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = 'TimsAts2026!';

// Users to create — one per key role level
const TEST_USERS = [
  {
    email: 'admin@tims.co',
    firstName: 'Laura',
    lastName: 'Garcia',
    jobTitle: 'HR Director',
    roleSlug: 'super_admin',
  },
  {
    email: 'hr@tims.co',
    firstName: 'Maria',
    lastName: 'Rodriguez',
    jobTitle: 'HR Manager',
    roleSlug: 'hr_admin',
  },
  {
    email: 'recruiter@tims.co',
    firstName: 'Carlos',
    lastName: 'Mendez',
    jobTitle: 'Senior Recruiter',
    roleSlug: 'recruiter',
  },
  {
    email: 'leader@tims.co',
    firstName: 'Andres',
    lastName: 'Tafur',
    jobTitle: 'Engineering Manager',
    roleSlug: 'leader',
  },
  {
    email: 'employee@tims.co',
    firstName: 'Sofia',
    lastName: 'Perez',
    jobTitle: 'Software Engineer',
    roleSlug: 'employee',
  },
];

// Permissions by module and action
const PERMISSIONS: Array<{ module: string; action: string }> = [
  // Vacancy
  { module: 'vacancy', action: 'read' },
  { module: 'vacancy', action: 'create' },
  { module: 'vacancy', action: 'update' },
  { module: 'vacancy', action: 'delete' },
  { module: 'vacancy', action: 'approve' },
  { module: 'vacancy', action: 'publish' },
  // Candidate
  { module: 'candidate', action: 'read' },
  { module: 'candidate', action: 'create' },
  { module: 'candidate', action: 'update' },
  { module: 'candidate', action: 'delete' },
  // Pipeline
  { module: 'pipeline', action: 'read' },
  { module: 'pipeline', action: 'create' },
  { module: 'pipeline', action: 'update' },
  { module: 'pipeline', action: 'delete' },
  // Interview
  { module: 'interview', action: 'read' },
  { module: 'interview', action: 'create' },
  { module: 'interview', action: 'update' },
  { module: 'interview', action: 'delete' },
  // Offer
  { module: 'offer', action: 'read' },
  { module: 'offer', action: 'create' },
  { module: 'offer', action: 'update' },
  { module: 'offer', action: 'delete' },
  { module: 'offer', action: 'approve' },
  // Assessment
  { module: 'assessment', action: 'read' },
  { module: 'assessment', action: 'create' },
  { module: 'assessment', action: 'update' },
  // Onboarding
  { module: 'onboarding', action: 'read' },
  { module: 'onboarding', action: 'create' },
  { module: 'onboarding', action: 'update' },
  // Performance
  { module: 'performance', action: 'read' },
  { module: 'performance', action: 'create' },
  { module: 'performance', action: 'update' },
];

// Which roles get which permissions
const ROLE_PERMISSIONS: Record<string, Array<{ module: string; action: string }>> = {
  super_admin: PERMISSIONS, // all
  hr_admin: PERMISSIONS, // all
  recruiter: PERMISSIONS.filter((p) =>
    ['vacancy', 'candidate', 'pipeline', 'interview', 'offer', 'assessment'].includes(p.module),
  ),
  leader: [
    { module: 'vacancy', action: 'read' },
    { module: 'vacancy', action: 'approve' },
    { module: 'candidate', action: 'read' },
    { module: 'pipeline', action: 'read' },
    { module: 'interview', action: 'read' },
    { module: 'interview', action: 'create' },
    { module: 'interview', action: 'update' },
    { module: 'offer', action: 'read' },
    { module: 'offer', action: 'approve' },
    { module: 'performance', action: 'read' },
    { module: 'performance', action: 'create' },
    { module: 'performance', action: 'update' },
  ],
  employee: [
    { module: 'performance', action: 'read' },
    { module: 'onboarding', action: 'read' },
  ],
};

async function main() {
  console.log('Seeding test users with proper RBAC...\n');

  if (!SUPABASE_SERVICE_KEY) {
    console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not set. Run with:');
    console.error('  SUPABASE_SERVICE_ROLE_KEY=... npx tsx prisma/seed-users.ts');
    process.exit(1);
  }

  // Find TIMS International org
  const org = await db.organization.findUnique({ where: { slug: 'tims-international' } });
  if (!org) {
    console.error('ERROR: TIMS International org not found. Run seed.ts first.');
    process.exit(1);
  }

  const company = await db.company.findFirst({ where: { organizationId: org.id } });

  // 1. Seed all permissions
  console.log('[Permissions] Seeding...');
  for (const perm of PERMISSIONS) {
    await db.permission.upsert({
      where: { module_action: { module: perm.module, action: perm.action } },
      update: {},
      create: { module: perm.module, action: perm.action, description: `${perm.module}.${perm.action}` },
    });
  }
  console.log(`[Permissions] ${PERMISSIONS.length} permissions seeded`);

  // 2. Assign permissions to roles
  console.log('[Role Permissions] Assigning...');
  for (const [roleSlug, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await db.role.findUnique({
      where: { organizationId_slug: { organizationId: org.id, slug: roleSlug } },
    });
    if (!role) {
      console.warn(`  WARN: Role ${roleSlug} not found, skipping`);
      continue;
    }

    for (const perm of perms) {
      const permission = await db.permission.findUnique({
        where: { module_action: { module: perm.module, action: perm.action } },
      });
      if (!permission) continue;

      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id, scope: 'all' },
      });
    }
    console.log(`  [${roleSlug}] ${perms.length} permissions assigned`);
  }

  // 3. Create Supabase auth users + app users
  console.log('\n[Users] Creating test users...');
  for (const testUser of TEST_USERS) {
    // Create Supabase auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: testUser.email,
      password: PASSWORD,
      email_confirm: true,
    });

    let supabaseUserId: string;

    if (authError) {
      if (authError.message?.includes('already been registered') || authError.message?.includes('already exists')) {
        // User exists — look up their ID
        const { data: existingUsers } = await supabase.auth.admin.listUsers();
        const existing = existingUsers?.users?.find((u) => u.email === testUser.email);
        if (!existing) {
          console.error(`  ERROR: ${testUser.email} — ${authError.message}`);
          continue;
        }
        supabaseUserId = existing.id;
        console.log(`  [${testUser.email}] Supabase user already exists (${supabaseUserId})`);
      } else {
        console.error(`  ERROR: ${testUser.email} — ${authError.message}`);
        continue;
      }
    } else {
      supabaseUserId = authData.user.id;
      console.log(`  [${testUser.email}] Supabase user created (${supabaseUserId})`);
    }

    // Create app user
    const appUser = await db.user.upsert({
      where: { supabaseUserId },
      update: {
        email: testUser.email,
        firstName: testUser.firstName,
        lastName: testUser.lastName,
        jobTitle: testUser.jobTitle,
      },
      create: {
        supabaseUserId,
        organizationId: org.id,
        email: testUser.email,
        firstName: testUser.firstName,
        lastName: testUser.lastName,
        jobTitle: testUser.jobTitle,
        companyId: company?.id,
        locale: 'es',
        timezone: 'America/Bogota',
        isPlatformOwner: false,
      },
    });

    // Assign role
    const role = await db.role.findUnique({
      where: { organizationId_slug: { organizationId: org.id, slug: testUser.roleSlug } },
    });
    if (role) {
      await db.userRole.upsert({
        where: { userId_roleId: { userId: appUser.id, roleId: role.id } },
        update: {},
        create: { userId: appUser.id, roleId: role.id },
      });
    }

    console.log(`  [${testUser.email}] → ${testUser.firstName} ${testUser.lastName} (${testUser.roleSlug})`);
  }

  console.log('\n=== Test Users Created ===');
  console.log('All use password: TimsAts2026!');
  console.log('');
  console.log('  Platform Owner:  federico@nexadev.ai');
  console.log('  Super Admin:     admin@tims.co');
  console.log('  HR Admin:        hr@tims.co');
  console.log('  Recruiter:       recruiter@tims.co');
  console.log('  Leader:          leader@tims.co');
  console.log('  Employee:        employee@tims.co');
  console.log('');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
