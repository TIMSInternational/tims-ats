import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const db = new PrismaClient();

// Helpers
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}
function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}
function hoursFromNow(n: number): Date {
  return new Date(Date.now() + n * 60 * 60 * 1000);
}

async function main() {
  console.log('Seeding TIMS ATS demo data (org-level)...\n');

  // ===========================
  // 0. Lookup existing org + users
  // ===========================
  const org = await db.organization.findUnique({ where: { slug: 'tims-international' } });
  if (!org) {
    console.error('ERROR: Run seed.ts first to create TIMS International org.');
    process.exit(1);
  }

  const company = await db.company.findFirst({ where: { organizationId: org.id } });
  const unit = await db.businessUnit.findFirst({ where: { organizationId: org.id } });
  const team = await db.team.findFirst({ where: { organizationId: org.id } });

  if (!company || !unit || !team) {
    console.error('ERROR: Company/unit/team not found. Run seed.ts first.');
    process.exit(1);
  }

  // Existing users by email
  const existingUsers = await db.user.findMany({
    where: { organizationId: org.id },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  const userByEmail: Record<string, { id: string; firstName: string; lastName: string }> = {};
  for (const u of existingUsers) {
    userByEmail[u.email] = { id: u.id, firstName: u.firstName, lastName: u.lastName };
  }

  const federico = userByEmail['federico@nexadev.ai'];
  const admin = userByEmail['admin@tims.co'];
  const hr = userByEmail['hr@tims.co'];
  const recruiter = userByEmail['recruiter@tims.co'];
  const leader = userByEmail['leader@tims.co'];
  const employee = userByEmail['employee@tims.co'];

  if (!federico || !admin || !hr || !recruiter || !leader || !employee) {
    console.error('ERROR: Test users not found. Run seed-users.ts first.');
    console.error('Found:', Object.keys(userByEmail));
    process.exit(1);
  }

  // ===========================
  // 1. Additional display-only users (for nine-box, teams, compensation, etc.)
  // ===========================
  const extraUserDefs = [
    { firstName: 'Valentina', lastName: 'Herrera', email: 'valentina.herrera@tims.co', jobTitle: 'Product Designer' },
    { firstName: 'Santiago', lastName: 'Ospina', email: 'santiago.ospina@tims.co', jobTitle: 'Backend Developer' },
    { firstName: 'Camila', lastName: 'Restrepo', email: 'camila.restrepo@tims.co', jobTitle: 'Data Analyst' },
    { firstName: 'Juan', lastName: 'Alvarez', email: 'juan.alvarez@tims.co', jobTitle: 'DevOps Engineer' },
    { firstName: 'Isabella', lastName: 'Cardenas', email: 'isabella.cardenas@tims.co', jobTitle: 'QA Lead' },
    { firstName: 'Daniel', lastName: 'Vargas', email: 'daniel.vargas@tims.co', jobTitle: 'Frontend Developer' },
    { firstName: 'Gabriela', lastName: 'Luna', email: 'gabriela.luna@tims.co', jobTitle: 'HR Analyst' },
    { firstName: 'Mateo', lastName: 'Rios', email: 'mateo.rios@tims.co', jobTitle: 'Sales Manager' },
    { firstName: 'Lucia', lastName: 'Castro', email: 'lucia.castro@tims.co', jobTitle: 'Marketing Lead' },
    { firstName: 'Nicolas', lastName: 'Betancur', email: 'nicolas.betancur@tims.co', jobTitle: 'Finance Analyst' },
  ];

  const extraUsers: Record<string, { id: string; firstName: string; lastName: string }> = {};
  for (const eu of extraUserDefs) {
    const existing = await db.user.findFirst({
      where: { organizationId: org.id, email: eu.email },
      select: { id: true, firstName: true, lastName: true },
    });
    if (existing) {
      extraUsers[eu.email] = existing;
    } else {
      const created = await db.user.create({
        data: {
          organizationId: org.id,
          supabaseUserId: randomUUID(),
          email: eu.email,
          firstName: eu.firstName,
          lastName: eu.lastName,
          jobTitle: eu.jobTitle,
          companyId: company.id,
          businessUnitId: unit.id,
          locale: 'es',
          timezone: 'America/Bogota',
        },
        select: { id: true, firstName: true, lastName: true },
      });
      extraUsers[eu.email] = created;
    }
  }
  const allUsers = { ...userByEmail, ...extraUsers };
  const allUserIds = Object.values(allUsers).map((u) => u.id);
  console.log(`[Users] ${Object.keys(extraUsers).length} extra display users ready`);

  // Create a second team
  const team2 = await db.team.findFirst({ where: { organizationId: org.id, name: 'Equipo Producto' } })
    ?? await db.team.create({
      data: { organizationId: org.id, businessUnitId: unit.id, name: 'Equipo Producto', leaderId: leader.id },
    });

  // Assign users to teams
  const teamAssignments = [
    { userId: leader.id, teamId: team.id, role: 'lead' },
    { userId: employee.id, teamId: team.id, role: 'member' },
    { userId: extraUsers['santiago.ospina@tims.co']!.id, teamId: team.id, role: 'member' },
    { userId: extraUsers['juan.alvarez@tims.co']!.id, teamId: team.id, role: 'member' },
    { userId: extraUsers['daniel.vargas@tims.co']!.id, teamId: team.id, role: 'member' },
    { userId: extraUsers['isabella.cardenas@tims.co']!.id, teamId: team.id, role: 'member' },
    { userId: extraUsers['valentina.herrera@tims.co']!.id, teamId: team2.id, role: 'member' },
    { userId: extraUsers['camila.restrepo@tims.co']!.id, teamId: team2.id, role: 'member' },
    { userId: extraUsers['lucia.castro@tims.co']!.id, teamId: team2.id, role: 'member' },
    { userId: extraUsers['mateo.rios@tims.co']!.id, teamId: team2.id, role: 'member' },
  ];
  for (const ta of teamAssignments) {
    await db.userTeam.upsert({
      where: { userId_teamId: { userId: ta.userId, teamId: ta.teamId } },
      update: {},
      create: ta,
    });
  }
  console.log(`[Teams] ${teamAssignments.length} team assignments`);

  // ===========================
  // 2. Candidates (20)
  // ===========================
  const candidateDefs = [
    { firstName: 'Ana', lastName: 'Martinez', email: 'ana.martinez@gmail.com', phone: '+57 310 123 4567', source: 'linkedin', poolType: 'active', location: 'Bogota, CO', currentTitle: 'Senior Developer', currentCompany: 'MercadoLibre', yearsExperience: 7, skills: ['TypeScript', 'React', 'Node.js', 'AWS'] },
    { firstName: 'Pedro', lastName: 'Gutierrez', email: 'pedro.gutierrez@hotmail.com', phone: '+57 311 234 5678', source: 'referral', poolType: 'active', location: 'Medellin, CO', currentTitle: 'Tech Lead', currentCompany: 'Rappi', yearsExperience: 9, skills: ['Python', 'Django', 'PostgreSQL', 'Docker'] },
    { firstName: 'Luisa', lastName: 'Morales', email: 'luisa.morales@outlook.com', phone: '+57 312 345 6789', source: 'portal', poolType: 'active', location: 'Cali, CO', currentTitle: 'UX Designer', currentCompany: 'Globant', yearsExperience: 5, skills: ['Figma', 'User Research', 'Prototyping', 'Design Systems'] },
    { firstName: 'Diego', lastName: 'Ramirez', email: 'diego.ramirez@gmail.com', phone: '+57 313 456 7890', source: 'linkedin', poolType: 'active', location: 'Bogota, CO', currentTitle: 'DevOps Engineer', currentCompany: 'Nubank', yearsExperience: 6, skills: ['Kubernetes', 'Terraform', 'CI/CD', 'AWS'] },
    { firstName: 'Carolina', lastName: 'Jimenez', email: 'carolina.jimenez@gmail.com', phone: '+57 314 567 8901', source: 'job_board', poolType: 'active', location: 'Barranquilla, CO', currentTitle: 'Data Scientist', currentCompany: 'Bancolombia', yearsExperience: 4, skills: ['Python', 'ML', 'TensorFlow', 'SQL'] },
    { firstName: 'Alejandro', lastName: 'Sanchez', email: 'alejandro.sanchez@yahoo.com', phone: '+57 315 678 9012', source: 'referral', poolType: 'active', location: 'Bogota, CO', currentTitle: 'Product Manager', currentCompany: 'iFood', yearsExperience: 8, skills: ['Agile', 'Product Strategy', 'Analytics', 'Roadmapping'] },
    { firstName: 'Natalia', lastName: 'Torres', email: 'natalia.torres@gmail.com', phone: '+57 316 789 0123', source: 'portal', poolType: 'passive', location: 'Medellin, CO', currentTitle: 'QA Engineer', currentCompany: 'Endava', yearsExperience: 3, skills: ['Cypress', 'Selenium', 'API Testing', 'Jest'] },
    { firstName: 'Matias', lastName: 'Lopez', email: 'matias.lopez@gmail.com', phone: '+57 317 890 1234', source: 'linkedin', poolType: 'active', location: 'Bogota, CO', currentTitle: 'Full Stack Developer', currentCompany: 'Platzi', yearsExperience: 5, skills: ['Next.js', 'TypeScript', 'GraphQL', 'PostgreSQL'] },
    { firstName: 'Juliana', lastName: 'Cruz', email: 'juliana.cruz@outlook.com', phone: '+57 318 901 2345', source: 'university', poolType: 'active', location: 'Manizales, CO', currentTitle: 'Junior Developer', currentCompany: null, yearsExperience: 1, skills: ['JavaScript', 'React', 'CSS', 'Git'] },
    { firstName: 'Sebastian', lastName: 'Ortiz', email: 'sebastian.ortiz@gmail.com', phone: '+57 319 012 3456', source: 'linkedin', poolType: 'passive', location: 'Bogota, CO', currentTitle: 'Cloud Architect', currentCompany: 'AWS', yearsExperience: 12, skills: ['AWS', 'Azure', 'GCP', 'Microservices'] },
    { firstName: 'Mariana', lastName: 'Velasquez', email: 'mariana.velasquez@gmail.com', phone: '+57 320 123 4567', source: 'referral', poolType: 'active', location: 'Bogota, CO', currentTitle: 'HR Business Partner', currentCompany: 'Avianca', yearsExperience: 6, skills: ['Talent Management', 'Comp & Benefits', 'Employee Relations'] },
    { firstName: 'Felipe', lastName: 'Pineda', email: 'felipe.pineda@hotmail.com', phone: '+57 321 234 5678', source: 'portal', poolType: 'active', location: 'Cartagena, CO', currentTitle: 'Marketing Manager', currentCompany: 'Grupo Exito', yearsExperience: 7, skills: ['Digital Marketing', 'SEO', 'Analytics', 'Content Strategy'] },
    { firstName: 'Andrea', lastName: 'Suarez', email: 'andrea.suarez@gmail.com', phone: '+57 322 345 6789', source: 'linkedin', poolType: 'passive', location: 'Bogota, CO', currentTitle: 'Finance Manager', currentCompany: 'Ecopetrol', yearsExperience: 10, skills: ['FP&A', 'SAP', 'Financial Modeling', 'Excel'] },
    { firstName: 'David', lastName: 'Rojas', email: 'david.rojas@gmail.com', phone: '+57 323 456 7890', source: 'job_board', poolType: 'active', location: 'Bucaramanga, CO', currentTitle: 'Backend Developer', currentCompany: null, yearsExperience: 3, skills: ['Java', 'Spring Boot', 'MySQL', 'Redis'] },
    { firstName: 'Paola', lastName: 'Gomez', email: 'paola.gomez@outlook.com', phone: '+57 324 567 8901', source: 'portal', poolType: 'active', location: 'Bogota, CO', currentTitle: 'Scrum Master', currentCompany: 'Pragma', yearsExperience: 4, skills: ['Scrum', 'Kanban', 'JIRA', 'Facilitation'] },
    { firstName: 'Ricardo', lastName: 'Navarro', email: 'ricardo.navarro@gmail.com', phone: '+57 325 678 9012', source: 'referral', poolType: 'active', location: 'Medellin, CO', currentTitle: 'iOS Developer', currentCompany: 'Rappi', yearsExperience: 6, skills: ['Swift', 'SwiftUI', 'Objective-C', 'CoreData'] },
    { firstName: 'Camila', lastName: 'Aguirre', email: 'camila.aguirre@gmail.com', phone: '+57 326 789 0123', source: 'linkedin', poolType: 'passive', location: 'Bogota, CO', currentTitle: 'Security Engineer', currentCompany: 'Globant', yearsExperience: 5, skills: ['Pentesting', 'OWASP', 'SOC', 'Compliance'] },
    { firstName: 'Jorge', lastName: 'Duarte', email: 'jorge.duarte@yahoo.com', phone: '+57 327 890 1234', source: 'university', poolType: 'active', location: 'Pereira, CO', currentTitle: 'Data Engineer', currentCompany: null, yearsExperience: 2, skills: ['Python', 'Spark', 'Airflow', 'BigQuery'] },
    { firstName: 'Daniela', lastName: 'Mejia', email: 'daniela.mejia@gmail.com', phone: '+57 328 901 2345', source: 'portal', poolType: 'active', location: 'Bogota, CO', currentTitle: 'Account Executive', currentCompany: 'HubSpot', yearsExperience: 4, skills: ['SaaS Sales', 'CRM', 'Negotiation', 'Pipeline Management'] },
    { firstName: 'Oscar', lastName: 'Castillo', email: 'oscar.castillo@outlook.com', phone: '+57 329 012 3456', source: 'linkedin', poolType: 'active', location: 'Bogota, CO', currentTitle: 'Android Developer', currentCompany: 'MercadoLibre', yearsExperience: 5, skills: ['Kotlin', 'Jetpack Compose', 'MVVM', 'Firebase'] },
  ];

  const candidates: Record<string, { id: string }> = {};
  for (const cd of candidateDefs) {
    const existing = await db.candidate.findFirst({
      where: { organizationId: org.id, email: cd.email },
      select: { id: true },
    });
    if (existing) {
      candidates[cd.email] = existing;
    } else {
      const c = await db.candidate.create({
        data: {
          organizationId: org.id,
          firstName: cd.firstName,
          lastName: cd.lastName,
          email: cd.email,
          phone: cd.phone,
          source: cd.source,
          poolType: cd.poolType,
          location: cd.location,
          currentTitle: cd.currentTitle,
          currentCompany: cd.currentCompany,
          yearsExperience: cd.yearsExperience,
          skills: cd.skills,
          createdById: recruiter.id,
          createdAt: daysAgo(Math.floor(Math.random() * 60) + 5),
        },
        select: { id: true },
      });
      candidates[cd.email] = c;
    }
  }
  console.log(`[Candidates] ${Object.keys(candidates).length} candidates`);

  // Tags for some candidates
  const tagDefs = [
    { email: 'ana.martinez@gmail.com', tags: ['top-performer', 'bilingual', 'referral-eligible'] },
    { email: 'pedro.gutierrez@hotmail.com', tags: ['senior', 'leadership-potential'] },
    { email: 'sebastian.ortiz@gmail.com', tags: ['passive-outreach', 'high-salary'] },
    { email: 'luisa.morales@outlook.com', tags: ['portfolio-reviewed', 'design-system-exp'] },
    { email: 'matias.lopez@gmail.com', tags: ['full-stack', 'startup-experience'] },
  ];
  for (const td of tagDefs) {
    const cand = candidates[td.email];
    if (!cand) continue;
    for (const tag of td.tags) {
      await db.candidateTag.upsert({
        where: { candidateId_tag: { candidateId: cand.id, tag } },
        update: {},
        create: { organizationId: org.id, candidateId: cand.id, tag, source: 'recruiter' },
      });
    }
  }
  console.log(`[Tags] Tagged ${tagDefs.length} candidates`);

  // ===========================
  // 3. Vacancies (8)
  // ===========================
  const vacancyDefs = [
    { title: 'Senior Full Stack Developer', description: 'Buscamos un desarrollador Full Stack con experiencia en React y Node.js para liderar el desarrollo de nuestra plataforma SaaS.', positions: 2, priority: 'high', status: 'published', contractType: 'indefinido', location: 'Bogota, CO', remotePolicy: 'hybrid', salary: { min: 8000000, max: 14000000, currency: 'COP' }, createdBy: recruiter.id, assignedTo: recruiter.id, daysAgoCreated: 30 },
    { title: 'UX/UI Designer', description: 'Disenador UX/UI para crear experiencias de usuario excepcionales en nuestros productos digitales.', positions: 1, priority: 'medium', status: 'published', contractType: 'indefinido', location: 'Medellin, CO', remotePolicy: 'remote', salary: { min: 5000000, max: 9000000, currency: 'COP' }, createdBy: hr.id, assignedTo: recruiter.id, daysAgoCreated: 25 },
    { title: 'DevOps Engineer', description: 'Ingeniero DevOps para gestionar infraestructura cloud y pipelines CI/CD.', positions: 1, priority: 'high', status: 'published', contractType: 'indefinido', location: 'Bogota, CO', remotePolicy: 'hybrid', salary: { min: 9000000, max: 15000000, currency: 'COP' }, createdBy: leader.id, assignedTo: recruiter.id, daysAgoCreated: 20 },
    { title: 'Data Scientist', description: 'Cientifico de datos para construir modelos predictivos de recursos humanos.', positions: 1, priority: 'medium', status: 'published', contractType: 'indefinido', location: 'Bogota, CO', remotePolicy: 'remote', salary: { min: 7000000, max: 12000000, currency: 'COP' }, createdBy: hr.id, assignedTo: recruiter.id, daysAgoCreated: 15 },
    { title: 'Product Manager', description: 'Product Manager para definir la vision y roadmap de nuestro producto ATS.', positions: 1, priority: 'high', status: 'published', contractType: 'indefinido', location: 'Bogota, CO', remotePolicy: 'hybrid', salary: { min: 10000000, max: 18000000, currency: 'COP' }, createdBy: admin.id, assignedTo: recruiter.id, daysAgoCreated: 10 },
    { title: 'QA Automation Engineer', description: 'Ingeniero QA para automatizar pruebas end-to-end y garantizar calidad del software.', positions: 1, priority: 'low', status: 'draft', contractType: 'indefinido', location: 'Bogota, CO', remotePolicy: 'hybrid', salary: { min: 5000000, max: 8000000, currency: 'COP' }, createdBy: leader.id, assignedTo: null, daysAgoCreated: 5 },
    { title: 'Junior Frontend Developer', description: 'Desarrollador frontend junior con conocimientos de React y TypeScript.', positions: 2, priority: 'low', status: 'closed', contractType: 'termino_fijo', location: 'Bogota, CO', remotePolicy: 'onsite', salary: { min: 2500000, max: 4500000, currency: 'COP' }, createdBy: recruiter.id, assignedTo: recruiter.id, daysAgoCreated: 60, closedAt: daysAgo(10), closedReason: 'filled' },
    { title: 'Cloud Architect', description: 'Arquitecto cloud senior para disenar soluciones escalables en AWS.', positions: 1, priority: 'high', status: 'frozen', contractType: 'indefinido', location: 'Bogota, CO', remotePolicy: 'remote', salary: { min: 15000000, max: 25000000, currency: 'COP' }, createdBy: admin.id, assignedTo: recruiter.id, daysAgoCreated: 40 },
  ];

  const vacancies: { id: string; title: string }[] = [];
  for (const vd of vacancyDefs) {
    const existing = await db.vacancy.findFirst({
      where: { organizationId: org.id, title: vd.title },
      select: { id: true, title: true },
    });
    if (existing) {
      vacancies.push(existing);
    } else {
      const v = await db.vacancy.create({
        data: {
          organizationId: org.id,
          companyId: company.id,
          businessUnitId: unit.id,
          teamId: team.id,
          title: vd.title,
          description: vd.description,
          positions: vd.positions,
          priority: vd.priority,
          status: vd.status,
          contractType: vd.contractType,
          location: vd.location,
          remotePolicy: vd.remotePolicy,
          salary: vd.salary,
          createdBy: vd.createdBy,
          assignedTo: vd.assignedTo,
          closedAt: vd.closedAt ?? null,
          closedReason: vd.closedReason ?? null,
          settings: {},
          createdAt: daysAgo(vd.daysAgoCreated),
        },
        select: { id: true, title: true },
      });
      vacancies.push(v);
    }
  }
  console.log(`[Vacancies] ${vacancies.length} vacancies`);

  // Job Profiles for open vacancies
  for (const v of vacancies.slice(0, 5)) {
    const exists = await db.jobProfile.findUnique({ where: { vacancyId: v.id } });
    if (!exists) {
      await db.jobProfile.create({
        data: {
          organizationId: org.id,
          vacancyId: v.id,
          discTargets: { D: 65, I: 55, S: 45, C: 70 },
          competencies: { leadership: 4, communication: 4, technical: 5, teamwork: 4, innovation: 3 },
          requirements: { education: 'Profesional en Ingenieria de Sistemas o afines', experience: '5+ anos', languages: ['Espanol nativo', 'Ingles B2+'] },
        },
      });
    }
  }
  console.log(`[JobProfiles] Created for open vacancies`);

  // Publication Channels
  for (const v of vacancies.filter((_, i) => [0, 1, 2, 3, 4].includes(i))) {
    const chExists = await db.publicationChannel.findFirst({ where: { vacancyId: v.id } });
    if (!chExists) {
      const channels = [
        { channelName: 'LinkedIn Jobs', channelType: 'job_board', status: 'published', publishedAt: daysAgo(15) },
        { channelName: 'Portal Interno', channelType: 'internal', status: 'published', publishedAt: daysAgo(20) },
        { channelName: 'CompuTrabajo', channelType: 'job_board', status: 'published', publishedAt: daysAgo(12) },
      ];
      for (const ch of channels) {
        await db.publicationChannel.create({
          data: { organizationId: org.id, vacancyId: v.id, ...ch },
        });
      }
    }
  }
  console.log(`[Channels] Publication channels created`);

  // ===========================
  // 4. Pipeline Stages + Applications
  // ===========================
  const stageNames = ['Aplicado', 'Screening', 'Entrevista RRHH', 'Prueba Tecnica', 'Entrevista Final', 'Oferta', 'Contratado'];

  // Create stages for open vacancies (first 5)
  const vacancyStages: Record<string, { id: string; name: string; order: number }[]> = {};
  for (const v of vacancies.slice(0, 5)) {
    const existingStages = await db.pipelineStage.findMany({
      where: { vacancyId: v.id },
      select: { id: true, name: true, order: true },
      orderBy: { order: 'asc' },
    });
    if (existingStages.length > 0) {
      vacancyStages[v.id] = existingStages;
    } else {
      const stages: { id: string; name: string; order: number }[] = [];
      for (let i = 0; i < stageNames.length; i++) {
        const s = await db.pipelineStage.create({
          data: {
            organizationId: org.id,
            vacancyId: v.id,
            name: stageNames[i]!,
            order: i,
            slaHours: [24, 48, 72, 96, 48, 24, 8][i],
            isDefault: i === 0,
          },
          select: { id: true, name: true, order: true },
        });
        stages.push(s);
      }
      vacancyStages[v.id] = stages;
    }
  }
  console.log(`[Stages] Pipeline stages for ${Object.keys(vacancyStages).length} vacancies`);

  // Applications: distribute candidates across vacancies and stages
  const applicationMap: { candidateEmail: string; vacancyIdx: number; stageIdx: number; status: string; source: string }[] = [
    // Senior Full Stack (vacancy 0) — heavily populated
    { candidateEmail: 'ana.martinez@gmail.com', vacancyIdx: 0, stageIdx: 5, status: 'active', source: 'linkedin' },
    { candidateEmail: 'matias.lopez@gmail.com', vacancyIdx: 0, stageIdx: 4, status: 'active', source: 'portal' },
    { candidateEmail: 'david.rojas@gmail.com', vacancyIdx: 0, stageIdx: 3, status: 'active', source: 'job_board' },
    { candidateEmail: 'pedro.gutierrez@hotmail.com', vacancyIdx: 0, stageIdx: 2, status: 'active', source: 'referral' },
    { candidateEmail: 'juliana.cruz@outlook.com', vacancyIdx: 0, stageIdx: 1, status: 'active', source: 'university' },
    { candidateEmail: 'oscar.castillo@outlook.com', vacancyIdx: 0, stageIdx: 0, status: 'active', source: 'linkedin' },
    { candidateEmail: 'ricardo.navarro@gmail.com', vacancyIdx: 0, stageIdx: 1, status: 'rejected', source: 'referral' },
    // UX/UI Designer (vacancy 1)
    { candidateEmail: 'luisa.morales@outlook.com', vacancyIdx: 1, stageIdx: 4, status: 'active', source: 'portal' },
    { candidateEmail: 'valentina.herrera@tims.co', vacancyIdx: 1, stageIdx: 2, status: 'active', source: 'internal' },
    // DevOps (vacancy 2)
    { candidateEmail: 'diego.ramirez@gmail.com', vacancyIdx: 2, stageIdx: 3, status: 'active', source: 'linkedin' },
    { candidateEmail: 'juan.alvarez@tims.co', vacancyIdx: 2, stageIdx: 1, status: 'active', source: 'internal' },
    { candidateEmail: 'camila.aguirre@gmail.com', vacancyIdx: 2, stageIdx: 2, status: 'active', source: 'linkedin' },
    // Data Scientist (vacancy 3)
    { candidateEmail: 'carolina.jimenez@gmail.com', vacancyIdx: 3, stageIdx: 3, status: 'active', source: 'job_board' },
    { candidateEmail: 'jorge.duarte@yahoo.com', vacancyIdx: 3, stageIdx: 0, status: 'active', source: 'university' },
    // Product Manager (vacancy 4)
    { candidateEmail: 'alejandro.sanchez@yahoo.com', vacancyIdx: 4, stageIdx: 4, status: 'active', source: 'referral' },
    { candidateEmail: 'daniela.mejia@gmail.com', vacancyIdx: 4, stageIdx: 2, status: 'active', source: 'portal' },
    { candidateEmail: 'paola.gomez@outlook.com', vacancyIdx: 4, stageIdx: 1, status: 'active', source: 'portal' },
    { candidateEmail: 'felipe.pineda@hotmail.com', vacancyIdx: 4, stageIdx: 0, status: 'rejected', source: 'portal' },
  ];

  const applications: { id: string; candidateEmail: string; vacancyIdx: number }[] = [];
  for (const am of applicationMap) {
    const vacancy = vacancies[am.vacancyIdx];
    const cand = candidates[am.candidateEmail];
    // candidateEmail might be an internal user email — check candidates first, fall back to creating one
    if (!vacancy || !cand) continue;

    const stages = vacancyStages[vacancy.id];
    if (!stages || !stages[am.stageIdx]) continue;

    const existing = await db.application.findFirst({
      where: { candidateId: cand.id, vacancyId: vacancy.id },
      select: { id: true },
    });
    if (existing) {
      applications.push({ id: existing.id, candidateEmail: am.candidateEmail, vacancyIdx: am.vacancyIdx });
    } else {
      const app = await db.application.create({
        data: {
          organizationId: org.id,
          candidateId: cand.id,
          vacancyId: vacancy.id,
          currentStageId: stages[am.stageIdx]!.id,
          source: am.source,
          status: am.status,
          appliedAt: daysAgo(Math.floor(Math.random() * 25) + 3),
          rejectedAt: am.status === 'rejected' ? daysAgo(2) : null,
          rejectedReason: am.status === 'rejected' ? 'No cumple requisitos minimos' : null,
        },
        select: { id: true },
      });
      applications.push({ id: app.id, candidateEmail: am.candidateEmail, vacancyIdx: am.vacancyIdx });
    }
  }
  console.log(`[Applications] ${applications.length} applications`);

  // ===========================
  // 5. Assessment Types + Assignments + Results + FitScores
  // ===========================
  const assessmentTypeDefs = [
    { name: 'DISC Personality Profile', code: 'disc', description: 'Evaluacion de perfil de personalidad DISC', duration: 30 },
    { name: 'Prueba Tecnica', code: 'technical', description: 'Evaluacion de competencias tecnicas del cargo', duration: 120 },
    { name: 'Test Cognitivo', code: 'cognitive', description: 'Evaluacion de habilidades cognitivas y razonamiento logico', duration: 45 },
    { name: 'English Proficiency', code: 'english', description: 'Evaluacion de nivel de ingles', duration: 60 },
  ];

  const assessmentTypes: Record<string, { id: string }> = {};
  for (const at of assessmentTypeDefs) {
    const existing = await db.assessmentType.findFirst({
      where: { organizationId: org.id, code: at.code },
      select: { id: true },
    });
    if (existing) {
      assessmentTypes[at.code] = existing;
    } else {
      const created = await db.assessmentType.create({
        data: { organizationId: org.id, ...at },
        select: { id: true },
      });
      assessmentTypes[at.code] = created;
    }
  }
  console.log(`[AssessmentTypes] ${Object.keys(assessmentTypes).length} types`);

  // Assign assessments to candidates in technical/final stages
  const assessmentAssignments: { candidateEmail: string; vacancyIdx: number; code: string; status: string; score: number | null }[] = [
    { candidateEmail: 'ana.martinez@gmail.com', vacancyIdx: 0, code: 'disc', status: 'completed', score: 82 },
    { candidateEmail: 'ana.martinez@gmail.com', vacancyIdx: 0, code: 'technical', status: 'completed', score: 91 },
    { candidateEmail: 'ana.martinez@gmail.com', vacancyIdx: 0, code: 'english', status: 'completed', score: 88 },
    { candidateEmail: 'matias.lopez@gmail.com', vacancyIdx: 0, code: 'disc', status: 'completed', score: 75 },
    { candidateEmail: 'matias.lopez@gmail.com', vacancyIdx: 0, code: 'technical', status: 'completed', score: 85 },
    { candidateEmail: 'david.rojas@gmail.com', vacancyIdx: 0, code: 'technical', status: 'in_progress', score: null },
    { candidateEmail: 'luisa.morales@outlook.com', vacancyIdx: 1, code: 'disc', status: 'completed', score: 79 },
    { candidateEmail: 'diego.ramirez@gmail.com', vacancyIdx: 2, code: 'technical', status: 'completed', score: 88 },
    { candidateEmail: 'diego.ramirez@gmail.com', vacancyIdx: 2, code: 'disc', status: 'completed', score: 71 },
    { candidateEmail: 'carolina.jimenez@gmail.com', vacancyIdx: 3, code: 'technical', status: 'completed', score: 84 },
    { candidateEmail: 'carolina.jimenez@gmail.com', vacancyIdx: 3, code: 'cognitive', status: 'completed', score: 92 },
    { candidateEmail: 'alejandro.sanchez@yahoo.com', vacancyIdx: 4, code: 'disc', status: 'completed', score: 86 },
    { candidateEmail: 'alejandro.sanchez@yahoo.com', vacancyIdx: 4, code: 'english', status: 'pending', score: null },
  ];

  for (const aa of assessmentAssignments) {
    const cand = candidates[aa.candidateEmail];
    const vacancy = vacancies[aa.vacancyIdx];
    const at = assessmentTypes[aa.code];
    if (!cand || !vacancy || !at) continue;

    const existing = await db.assessmentAssignment.findFirst({
      where: { candidateId: cand.id, vacancyId: vacancy.id, assessmentTypeId: at.id },
      select: { id: true },
    });
    if (!existing) {
      const assignment = await db.assessmentAssignment.create({
        data: {
          organizationId: org.id,
          candidateId: cand.id,
          vacancyId: vacancy.id,
          assessmentTypeId: at.id,
          status: aa.status,
          assignedById: recruiter.id,
          assignedAt: daysAgo(15),
          startedAt: aa.status !== 'pending' ? daysAgo(14) : null,
          completedAt: aa.status === 'completed' ? daysAgo(12) : null,
          expiresAt: daysFromNow(7),
        },
        select: { id: true },
      });

      if (aa.status === 'completed' && aa.score !== null) {
        await db.assessmentResult.create({
          data: {
            organizationId: org.id,
            assignmentId: assignment.id,
            rawScore: aa.score,
            normalizedScore: aa.score,
            percentile: Math.min(99, aa.score + Math.floor(Math.random() * 10) - 5),
            breakdown: aa.code === 'disc'
              ? { D: 55 + Math.floor(Math.random() * 30), I: 40 + Math.floor(Math.random() * 30), S: 35 + Math.floor(Math.random() * 30), C: 50 + Math.floor(Math.random() * 30) }
              : { sections: [{ name: 'Section A', score: aa.score - 5 }, { name: 'Section B', score: aa.score + 3 }] },
            interpretation: { summary: `Candidato con puntaje ${aa.score}/100`, recommendation: aa.score >= 80 ? 'Altamente recomendado' : 'Recomendado con observaciones' },
          },
        });
      }
    }
  }
  console.log(`[Assessments] ${assessmentAssignments.length} assignments`);

  // FitScores for advanced candidates
  const fitScoreDefs = [
    { email: 'ana.martinez@gmail.com', vacancyIdx: 0, score: 92 },
    { email: 'matias.lopez@gmail.com', vacancyIdx: 0, score: 85 },
    { email: 'luisa.morales@outlook.com', vacancyIdx: 1, score: 88 },
    { email: 'diego.ramirez@gmail.com', vacancyIdx: 2, score: 90 },
    { email: 'carolina.jimenez@gmail.com', vacancyIdx: 3, score: 87 },
    { email: 'alejandro.sanchez@yahoo.com', vacancyIdx: 4, score: 91 },
    { email: 'pedro.gutierrez@hotmail.com', vacancyIdx: 0, score: 78 },
    { email: 'david.rojas@gmail.com', vacancyIdx: 0, score: 72 },
  ];

  for (const fs of fitScoreDefs) {
    const cand = candidates[fs.email];
    const vacancy = vacancies[fs.vacancyIdx];
    if (!cand || !vacancy) continue;
    await db.fitScore.upsert({
      where: { candidateId_vacancyId: { candidateId: cand.id, vacancyId: vacancy.id } },
      update: {},
      create: {
        organizationId: org.id,
        candidateId: cand.id,
        vacancyId: vacancy.id,
        overallScore: fs.score,
        breakdown: { technical: fs.score - 3, cultural: fs.score + 2, experience: fs.score - 1 },
        weights: { technical: 0.4, cultural: 0.3, experience: 0.3 },
      },
    });
  }
  console.log(`[FitScores] ${fitScoreDefs.length} scores`);

  // ===========================
  // 6. Interviews (12)
  // ===========================
  const interviewDefs: { candidateEmail: string; vacancyIdx: number; type: string; status: string; scheduledAt: Date; duration: number; location: string }[] = [
    { candidateEmail: 'ana.martinez@gmail.com', vacancyIdx: 0, type: 'technical', status: 'completed', scheduledAt: daysAgo(8), duration: 60, location: 'Google Meet' },
    { candidateEmail: 'ana.martinez@gmail.com', vacancyIdx: 0, type: 'final', status: 'completed', scheduledAt: daysAgo(3), duration: 45, location: 'Oficina Bogota' },
    { candidateEmail: 'matias.lopez@gmail.com', vacancyIdx: 0, type: 'technical', status: 'completed', scheduledAt: daysAgo(5), duration: 60, location: 'Google Meet' },
    { candidateEmail: 'matias.lopez@gmail.com', vacancyIdx: 0, type: 'final', status: 'scheduled', scheduledAt: daysFromNow(2), duration: 45, location: 'Oficina Bogota' },
    { candidateEmail: 'pedro.gutierrez@hotmail.com', vacancyIdx: 0, type: 'hr', status: 'completed', scheduledAt: daysAgo(10), duration: 30, location: 'Google Meet' },
    { candidateEmail: 'luisa.morales@outlook.com', vacancyIdx: 1, type: 'portfolio', status: 'completed', scheduledAt: daysAgo(6), duration: 45, location: 'Zoom' },
    { candidateEmail: 'luisa.morales@outlook.com', vacancyIdx: 1, type: 'final', status: 'scheduled', scheduledAt: daysFromNow(3), duration: 45, location: 'Google Meet' },
    { candidateEmail: 'diego.ramirez@gmail.com', vacancyIdx: 2, type: 'technical', status: 'completed', scheduledAt: daysAgo(4), duration: 90, location: 'Google Meet' },
    { candidateEmail: 'carolina.jimenez@gmail.com', vacancyIdx: 3, type: 'technical', status: 'scheduled', scheduledAt: hoursFromNow(26), duration: 60, location: 'Google Meet' },
    { candidateEmail: 'alejandro.sanchez@yahoo.com', vacancyIdx: 4, type: 'case_study', status: 'completed', scheduledAt: daysAgo(7), duration: 90, location: 'Oficina Bogota' },
    { candidateEmail: 'alejandro.sanchez@yahoo.com', vacancyIdx: 4, type: 'final', status: 'scheduled', scheduledAt: daysFromNow(1), duration: 45, location: 'Oficina Bogota' },
    { candidateEmail: 'ricardo.navarro@gmail.com', vacancyIdx: 0, type: 'hr', status: 'cancelled', scheduledAt: daysAgo(12), duration: 30, location: 'Google Meet' },
  ];

  const interviews: { id: string; candidateEmail: string }[] = [];
  for (const id of interviewDefs) {
    const cand = candidates[id.candidateEmail];
    const vacancy = vacancies[id.vacancyIdx];
    if (!cand || !vacancy) continue;

    // Find matching application
    const app = await db.application.findFirst({
      where: { candidateId: cand.id, vacancyId: vacancy.id },
      select: { id: true },
    });

    const existing = await db.interview.findFirst({
      where: { candidateId: cand.id, vacancyId: vacancy.id, type: id.type, scheduledAt: id.scheduledAt },
      select: { id: true },
    });
    if (existing) {
      interviews.push({ id: existing.id, candidateEmail: id.candidateEmail });
    } else {
      const interview = await db.interview.create({
        data: {
          organizationId: org.id,
          candidateId: cand.id,
          vacancyId: vacancy.id,
          applicationId: app?.id ?? null,
          type: id.type,
          status: id.status,
          scheduledAt: id.scheduledAt,
          duration: id.duration,
          location: id.location,
          meetingUrl: id.location.includes('Meet') ? 'https://meet.google.com/abc-defg-hij' : id.location.includes('Zoom') ? 'https://zoom.us/j/123456789' : null,
          cancelledAt: id.status === 'cancelled' ? daysAgo(13) : null,
          cancelReason: id.status === 'cancelled' ? 'Candidato desistio del proceso' : null,
          createdById: recruiter.id,
        },
        select: { id: true },
      });
      interviews.push({ id: interview.id, candidateEmail: id.candidateEmail });

      // Add evaluators
      const evaluators = id.type === 'technical' || id.type === 'case_study'
        ? [{ userId: leader.id, role: 'lead' }, { userId: recruiter.id, role: 'observer' }]
        : id.type === 'final'
          ? [{ userId: admin.id, role: 'lead' }, { userId: hr.id, role: 'panel' }]
          : [{ userId: recruiter.id, role: 'lead' }];

      for (const ev of evaluators) {
        await db.interviewEvaluator.create({
          data: {
            interviewId: interview.id,
            userId: ev.userId,
            role: ev.role,
            status: id.status === 'completed' ? 'completed' : 'pending',
          },
        });
      }
    }
  }
  console.log(`[Interviews] ${interviews.length} interviews`);

  // ===========================
  // 7. Offers (5)
  // ===========================
  const offerDefs: { candidateEmail: string; vacancyIdx: number; status: string; salary: number; currency: string; contractType: string; startDate: Date }[] = [
    { candidateEmail: 'ana.martinez@gmail.com', vacancyIdx: 0, status: 'accepted', salary: 12000000, currency: 'COP', contractType: 'indefinido', startDate: daysFromNow(15) },
    { candidateEmail: 'luisa.morales@outlook.com', vacancyIdx: 1, status: 'sent', salary: 8000000, currency: 'COP', contractType: 'indefinido', startDate: daysFromNow(30) },
    { candidateEmail: 'diego.ramirez@gmail.com', vacancyIdx: 2, status: 'draft', salary: 13000000, currency: 'COP', contractType: 'indefinido', startDate: daysFromNow(45) },
    { candidateEmail: 'alejandro.sanchez@yahoo.com', vacancyIdx: 4, status: 'sent', salary: 15000000, currency: 'COP', contractType: 'indefinido', startDate: daysFromNow(20) },
    { candidateEmail: 'juliana.cruz@outlook.com', vacancyIdx: 0, status: 'rejected', salary: 3500000, currency: 'COP', contractType: 'termino_fijo', startDate: daysFromNow(30) },
  ];

  for (const od of offerDefs) {
    const cand = candidates[od.candidateEmail];
    const vacancy = vacancies[od.vacancyIdx];
    if (!cand || !vacancy) continue;

    const app = await db.application.findFirst({
      where: { candidateId: cand.id, vacancyId: vacancy.id },
      select: { id: true },
    });

    const existing = await db.offer.findFirst({
      where: { candidateId: cand.id, vacancyId: vacancy.id },
      select: { id: true },
    });
    if (!existing) {
      const offer = await db.offer.create({
        data: {
          organizationId: org.id,
          candidateId: cand.id,
          vacancyId: vacancy.id,
          applicationId: app?.id ?? null,
          status: od.status,
          salary: od.salary,
          currency: od.currency,
          contractType: od.contractType,
          startDate: od.startDate,
          benefits: { healthInsurance: true, dentalPlan: true, gymMembership: true, homeOfficeStipend: 200000, trainingBudget: 3000000 },
          sentAt: ['sent', 'accepted', 'rejected'].includes(od.status) ? daysAgo(5) : null,
          respondedAt: ['accepted', 'rejected'].includes(od.status) ? daysAgo(2) : null,
          expiresAt: daysFromNow(10),
          createdById: hr.id,
        },
        select: { id: true },
      });

      // Approval chain for sent/accepted offers
      if (['sent', 'accepted'].includes(od.status)) {
        await db.offerApproval.createMany({
          data: [
            { organizationId: org.id, offerId: offer.id, approverId: leader.id, step: 1, status: 'approved', decidedAt: daysAgo(7) },
            { organizationId: org.id, offerId: offer.id, approverId: admin.id, step: 2, status: 'approved', decidedAt: daysAgo(6) },
          ],
        });
      }
    }
  }
  console.log(`[Offers] ${offerDefs.length} offers`);

  // ===========================
  // 8. Onboarding Plans (3)
  // ===========================
  const onboardingDefs = [
    { userId: employee.id, buddyId: extraUsers['santiago.ospina@tims.co']!.id, startDate: daysAgo(25), phase: 'day31_60', status: 'active' },
    { userId: extraUsers['valentina.herrera@tims.co']!.id, buddyId: hr.id, startDate: daysAgo(55), phase: 'day61_90', status: 'active' },
    { userId: extraUsers['daniel.vargas@tims.co']!.id, buddyId: leader.id, startDate: daysAgo(100), phase: 'completed', status: 'completed' },
  ];

  for (const ob of onboardingDefs) {
    const existing = await db.onboardingPlan.findFirst({
      where: { organizationId: org.id, userId: ob.userId },
      select: { id: true },
    });
    if (!existing) {
      const plan = await db.onboardingPlan.create({
        data: {
          organizationId: org.id,
          userId: ob.userId,
          buddyId: ob.buddyId,
          startDate: ob.startDate,
          phase: ob.phase,
          status: ob.status,
          riskScore: ob.status === 'completed' ? 0.1 : ob.phase === 'day61_90' ? 0.25 : 0.15,
          completedAt: ob.status === 'completed' ? daysAgo(10) : null,
          createdById: hr.id,
        },
        select: { id: true },
      });

      // Tasks for each plan
      const tasks = [
        { title: 'Configurar equipo de trabajo', responsible: 'IT', phase: 'day1_30', completed: true },
        { title: 'Tour por la oficina', responsible: 'Buddy', phase: 'day1_30', completed: true },
        { title: 'Reunion con equipo directo', responsible: 'Lider', phase: 'day1_30', completed: true },
        { title: 'Completar capacitacion de seguridad', responsible: 'Empleado', phase: 'day1_30', completed: ob.phase !== 'day1_30' },
        { title: 'Primer proyecto asignado', responsible: 'Lider', phase: 'day31_60', completed: ob.status === 'completed' || ob.phase === 'day61_90' },
        { title: 'Feedback 30 dias', responsible: 'RRHH', phase: 'day31_60', completed: ob.status === 'completed' || ob.phase === 'day61_90' },
        { title: 'Evaluacion de desempeno 60 dias', responsible: 'Lider', phase: 'day61_90', completed: ob.status === 'completed' },
        { title: 'Encuesta de satisfaccion onboarding', responsible: 'Empleado', phase: 'day61_90', completed: ob.status === 'completed' },
      ];

      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i]!;
        await db.onboardingTask.create({
          data: {
            organizationId: org.id,
            planId: plan.id,
            title: t.title,
            responsible: t.responsible,
            phase: t.phase,
            order: i,
            completed: t.completed,
            completedAt: t.completed ? daysAgo(Math.floor(Math.random() * 20) + 1) : null,
            completedById: t.completed ? hr.id : null,
          },
        });
      }
    }
  }
  console.log(`[Onboarding] ${onboardingDefs.length} plans with tasks`);

  // ===========================
  // 9. Performance — OKRs, Coaching, Feedback, Recognition
  // ===========================
  const okrDefs = [
    { userId: employee.id, title: 'Mejorar cobertura de pruebas unitarias', period: '2026', progress: 0.65, keyResults: [
      { title: 'Alcanzar 80% de cobertura en modulos criticos', targetValue: 80, currentValue: 65, unit: '%', status: 'on_track' },
      { title: 'Documentar 10 guias de testing', targetValue: 10, currentValue: 7, unit: 'guias', status: 'on_track' },
    ]},
    { userId: leader.id, title: 'Reducir time-to-hire en un 20%', period: '2026', progress: 0.45, keyResults: [
      { title: 'Time-to-hire promedio < 25 dias', targetValue: 25, currentValue: 30, unit: 'dias', status: 'at_risk' },
      { title: 'Tasa de ofertas aceptadas > 85%', targetValue: 85, currentValue: 78, unit: '%', status: 'at_risk' },
    ]},
    { userId: extraUsers['valentina.herrera@tims.co']!.id, title: 'Redisenar el design system', period: '2026', progress: 0.80, keyResults: [
      { title: 'Migrar 100% de componentes a nueva libreria', targetValue: 100, currentValue: 80, unit: '%', status: 'on_track' },
      { title: 'Reducir inconsistencias de UI a 0', targetValue: 0, currentValue: 3, unit: 'issues', status: 'on_track' },
    ]},
    { userId: extraUsers['santiago.ospina@tims.co']!.id, title: 'Optimizar rendimiento de API', period: '2026', progress: 0.55, keyResults: [
      { title: 'P95 latencia < 200ms', targetValue: 200, currentValue: 280, unit: 'ms', status: 'at_risk' },
      { title: 'Eliminar N+1 queries (0 restantes)', targetValue: 0, currentValue: 4, unit: 'queries', status: 'behind' },
    ]},
    { userId: hr.id, title: 'Implementar programa de bienestar', period: '2026', progress: 0.90, keyResults: [
      { title: 'Participacion > 70% en actividades', targetValue: 70, currentValue: 72, unit: '%', status: 'on_track' },
      { title: 'eNPS score > 40', targetValue: 40, currentValue: 38, unit: 'score', status: 'on_track' },
    ]},
  ];

  for (const okrDef of okrDefs) {
    const existingOkr = await db.okr.findFirst({
      where: { organizationId: org.id, userId: okrDef.userId, period: okrDef.period, title: okrDef.title },
      select: { id: true },
    });
    if (!existingOkr) {
      const okr = await db.okr.create({
        data: {
          organizationId: org.id,
          userId: okrDef.userId,
          title: okrDef.title,
          period: okrDef.period,
          status: 'active',
          progress: okrDef.progress,
          createdById: okrDef.userId === hr.id ? admin.id : hr.id,
        },
        select: { id: true },
      });
      for (const kr of okrDef.keyResults) {
        await db.keyResult.create({
          data: { organizationId: org.id, okrId: okr.id, ...kr },
        });
      }
    }
  }
  console.log(`[OKRs] ${okrDefs.length} OKRs with key results`);

  // Coaching Sessions
  const coachingDefs = [
    { employeeId: employee.id, leaderId: leader.id, scheduledAt: daysAgo(14), topic: 'Revision de progreso en cobertura de tests', status: 'completed', duration: 30 },
    { employeeId: employee.id, leaderId: leader.id, scheduledAt: daysFromNow(7), topic: 'Plan de desarrollo Q3', status: 'scheduled', duration: 45 },
    { employeeId: extraUsers['santiago.ospina@tims.co']!.id, leaderId: leader.id, scheduledAt: daysAgo(7), topic: 'Feedback sobre optimizacion de queries', status: 'completed', duration: 30 },
    { employeeId: extraUsers['valentina.herrera@tims.co']!.id, leaderId: hr.id, scheduledAt: daysFromNow(3), topic: 'Revision de design system progress', status: 'scheduled', duration: 30 },
  ];

  for (const cd of coachingDefs) {
    const existing = await db.coachingSession.findFirst({
      where: { organizationId: org.id, employeeId: cd.employeeId, scheduledAt: cd.scheduledAt },
      select: { id: true },
    });
    if (!existing) {
      const session = await db.coachingSession.create({
        data: { organizationId: org.id, ...cd, notes: cd.status === 'completed' ? 'Buen progreso. Acordamos enfocarnos en areas criticas.' : null },
        select: { id: true },
      });
      if (cd.status === 'completed') {
        await db.commitment.create({
          data: {
            organizationId: org.id,
            employeeId: cd.employeeId,
            coachingSessionId: session.id,
            description: 'Completar tareas pendientes antes de la proxima reunion',
            dueDate: daysFromNow(14),
            status: 'pending',
            createdById: cd.leaderId,
          },
        });
      }
    }
  }
  console.log(`[Coaching] ${coachingDefs.length} sessions`);

  // Feedback
  const feedbackDefs = [
    { fromUserId: leader.id, toUserId: employee.id, type: 'praise', message: 'Excelente trabajo en la implementacion del modulo de autenticacion. Codigo limpio y bien documentado.' },
    { fromUserId: hr.id, toUserId: recruiter.id, type: 'praise', message: 'Gran gestion del proceso de seleccion de Q2. Tiempos de respuesta muy buenos.' },
    { fromUserId: employee.id, toUserId: leader.id, type: 'constructive', message: 'Seria bueno tener reuniones de alineacion mas frecuentes con el equipo.' },
    { fromUserId: extraUsers['santiago.ospina@tims.co']!.id, toUserId: employee.id, type: 'praise', message: 'Muy buena colaboracion en el code review del sprint pasado.' },
    { fromUserId: admin.id, toUserId: hr.id, type: 'praise', message: 'El programa de bienestar ha tenido un impacto positivo en el clima organizacional.' },
    { fromUserId: extraUsers['camila.restrepo@tims.co']!.id, toUserId: leader.id, type: 'praise', message: 'Gracias por el apoyo en la definicion de metricas del dashboard.' },
  ];

  const existingFeedbackCount = await db.feedback.count({ where: { organizationId: org.id } });
  if (existingFeedbackCount === 0) {
    for (const fb of feedbackDefs) {
      await db.feedback.create({
        data: { organizationId: org.id, ...fb },
      });
    }
  }
  console.log(`[Feedback] ${feedbackDefs.length} entries`);

  // Recognition
  const recognitionDefs = [
    { fromUserId: admin.id, toUserId: recruiter.id, category: 'teamwork', message: 'Por liderar exitosamente la contratacion de 5 ingenieros en Q1.' },
    { fromUserId: leader.id, toUserId: employee.id, category: 'innovation', message: 'Por proponer y ejecutar la migracion a testing automatizado.' },
    { fromUserId: hr.id, toUserId: admin.id, category: 'leadership', message: 'Por guiar al equipo durante la implementacion del nuevo ATS.' },
    { fromUserId: employee.id, toUserId: extraUsers['santiago.ospina@tims.co']!.id, category: 'teamwork', message: 'Siempre disponible para pair programming y apoyo tecnico.' },
  ];

  const existingRecognitionCount = await db.recognition.count({ where: { organizationId: org.id } });
  if (existingRecognitionCount === 0) {
    for (const r of recognitionDefs) {
      await db.recognition.create({
        data: { organizationId: org.id, ...r },
      });
    }
  }
  console.log(`[Recognition] ${recognitionDefs.length} entries`);

  // ===========================
  // 10. Nine-Box Evaluations
  // ===========================
  const nineBoxDefs = [
    { userId: employee.id, potentialScore: 4.2, performanceScore: 3.8, quadrant: 'high_potential' },
    { userId: leader.id, potentialScore: 4.5, performanceScore: 4.3, quadrant: 'star' },
    { userId: extraUsers['valentina.herrera@tims.co']!.id, potentialScore: 4.0, performanceScore: 4.5, quadrant: 'star' },
    { userId: extraUsers['santiago.ospina@tims.co']!.id, potentialScore: 3.5, performanceScore: 4.0, quadrant: 'consistent_performer' },
    { userId: extraUsers['camila.restrepo@tims.co']!.id, potentialScore: 3.8, performanceScore: 3.5, quadrant: 'high_potential' },
    { userId: extraUsers['juan.alvarez@tims.co']!.id, potentialScore: 3.0, performanceScore: 4.2, quadrant: 'consistent_performer' },
    { userId: extraUsers['isabella.cardenas@tims.co']!.id, potentialScore: 4.3, performanceScore: 3.2, quadrant: 'high_potential' },
    { userId: extraUsers['daniel.vargas@tims.co']!.id, potentialScore: 2.8, performanceScore: 3.0, quadrant: 'core_player' },
    { userId: extraUsers['gabriela.luna@tims.co']!.id, potentialScore: 3.2, performanceScore: 3.8, quadrant: 'consistent_performer' },
    { userId: extraUsers['mateo.rios@tims.co']!.id, potentialScore: 2.5, performanceScore: 2.8, quadrant: 'underperformer' },
    { userId: extraUsers['lucia.castro@tims.co']!.id, potentialScore: 3.5, performanceScore: 4.0, quadrant: 'consistent_performer' },
    { userId: extraUsers['nicolas.betancur@tims.co']!.id, potentialScore: 2.0, performanceScore: 3.5, quadrant: 'solid_performer' },
    { userId: hr.id, potentialScore: 3.8, performanceScore: 4.2, quadrant: 'star' },
    { userId: recruiter.id, potentialScore: 3.5, performanceScore: 3.8, quadrant: 'consistent_performer' },
  ];

  for (const nb of nineBoxDefs) {
    await db.nineBoxEvaluation.upsert({
      where: { organizationId_userId_period: { organizationId: org.id, userId: nb.userId, period: '2026' } },
      update: {},
      create: {
        organizationId: org.id,
        userId: nb.userId,
        period: '2026',
        potentialScore: nb.potentialScore,
        performanceScore: nb.performanceScore,
        quadrant: nb.quadrant,
        confidence: 0.85,
        axisBreakdown: {
          potential: { leadership: nb.potentialScore - 0.3, learning: nb.potentialScore + 0.1, ambition: nb.potentialScore },
          performance: { results: nb.performanceScore, competencies: nb.performanceScore - 0.2, values: nb.performanceScore + 0.1 },
        },
      },
    });
  }
  console.log(`[NineBox] ${nineBoxDefs.length} evaluations`);

  // ===========================
  // 11. Succession — Critical Roles + Successors
  // ===========================
  const criticalRoleDefs = [
    { title: 'CTO', criticality: 'critical', holderId: federico.id, flightRisk: 0.15, successors: [
      { userId: leader.id, readiness: 'ready_in_1_year', type: 'internal' },
      { userId: extraUsers['santiago.ospina@tims.co']!.id, readiness: 'ready_in_2_years', type: 'internal' },
    ]},
    { title: 'HR Director', criticality: 'critical', holderId: admin.id, flightRisk: 0.20, successors: [
      { userId: hr.id, readiness: 'ready_now', type: 'internal' },
      { userId: extraUsers['gabriela.luna@tims.co']!.id, readiness: 'ready_in_2_years', type: 'internal' },
    ]},
    { title: 'Engineering Manager', criticality: 'high', holderId: leader.id, flightRisk: 0.35, successors: [
      { userId: extraUsers['isabella.cardenas@tims.co']!.id, readiness: 'ready_in_1_year', type: 'internal' },
    ]},
    { title: 'Head of Product', criticality: 'high', holderId: null, flightRisk: null, successors: [
      { userId: extraUsers['valentina.herrera@tims.co']!.id, readiness: 'ready_in_2_years', type: 'internal' },
    ]},
    { title: 'Sales Director', criticality: 'medium', holderId: extraUsers['mateo.rios@tims.co']!.id, flightRisk: 0.45, successors: [
      { userId: extraUsers['lucia.castro@tims.co']!.id, readiness: 'ready_in_1_year', type: 'internal' },
    ]},
  ];

  for (const cr of criticalRoleDefs) {
    const existing = await db.criticalRole.findFirst({
      where: { organizationId: org.id, title: cr.title },
      select: { id: true },
    });
    if (!existing) {
      const role = await db.criticalRole.create({
        data: {
          organizationId: org.id,
          title: cr.title,
          criticality: cr.criticality,
          currentHolderId: cr.holderId,
          companyId: company.id,
          unitId: unit.id,
          flightRisk: cr.flightRisk,
        },
        select: { id: true },
      });
      for (const s of cr.successors) {
        await db.successor.create({
          data: {
            organizationId: org.id,
            criticalRoleId: role.id,
            userId: s.userId,
            readiness: s.readiness,
            type: s.type,
            developmentPlan: `Plan de desarrollo para sucesion de ${cr.title}`,
            addedById: admin.id,
          },
        });
      }
    }
  }
  console.log(`[Succession] ${criticalRoleDefs.length} critical roles with successors`);

  // ===========================
  // 12. Compensation — Salary Bands, Employee Compensation, Adjustments, Benefits
  // ===========================
  const salaryBandDefs = [
    { level: 'junior', title: 'Junior', minSalary: 2500000, midSalary: 3500000, maxSalary: 4500000, currency: 'COP' },
    { level: 'mid', title: 'Mid-Level', minSalary: 4500000, midSalary: 6500000, maxSalary: 8500000, currency: 'COP' },
    { level: 'senior', title: 'Senior', minSalary: 8000000, midSalary: 11000000, maxSalary: 14000000, currency: 'COP' },
    { level: 'lead', title: 'Lead / Manager', minSalary: 12000000, midSalary: 16000000, maxSalary: 20000000, currency: 'COP' },
    { level: 'director', title: 'Director', minSalary: 18000000, midSalary: 23000000, maxSalary: 28000000, currency: 'COP' },
  ];

  const salaryBands: Record<string, { id: string }> = {};
  for (const sb of salaryBandDefs) {
    const existing = await db.salaryBand.findFirst({
      where: { organizationId: org.id, level: sb.level },
      select: { id: true },
    });
    if (existing) {
      salaryBands[sb.level] = existing;
    } else {
      const band = await db.salaryBand.create({
        data: { organizationId: org.id, ...sb },
        select: { id: true },
      });
      salaryBands[sb.level] = band;
    }
  }
  console.log(`[SalaryBands] ${Object.keys(salaryBands).length} bands`);

  // Employee compensation
  const compDefs: { userId: string; currentSalary: number; bandLevel: string; compaRatio: number }[] = [
    { userId: employee.id, currentSalary: 7000000, bandLevel: 'mid', compaRatio: 1.08 },
    { userId: leader.id, currentSalary: 16000000, bandLevel: 'lead', compaRatio: 1.00 },
    { userId: hr.id, currentSalary: 9500000, bandLevel: 'senior', compaRatio: 0.86 },
    { userId: recruiter.id, currentSalary: 6000000, bandLevel: 'mid', compaRatio: 0.92 },
    { userId: admin.id, currentSalary: 22000000, bandLevel: 'director', compaRatio: 0.96 },
    { userId: extraUsers['valentina.herrera@tims.co']!.id, currentSalary: 8500000, bandLevel: 'senior', compaRatio: 0.77 },
    { userId: extraUsers['santiago.ospina@tims.co']!.id, currentSalary: 10000000, bandLevel: 'senior', compaRatio: 0.91 },
    { userId: extraUsers['camila.restrepo@tims.co']!.id, currentSalary: 7500000, bandLevel: 'mid', compaRatio: 1.15 },
    { userId: extraUsers['juan.alvarez@tims.co']!.id, currentSalary: 11000000, bandLevel: 'senior', compaRatio: 1.00 },
    { userId: extraUsers['isabella.cardenas@tims.co']!.id, currentSalary: 9000000, bandLevel: 'senior', compaRatio: 0.82 },
    { userId: extraUsers['daniel.vargas@tims.co']!.id, currentSalary: 5500000, bandLevel: 'mid', compaRatio: 0.85 },
    { userId: extraUsers['gabriela.luna@tims.co']!.id, currentSalary: 5000000, bandLevel: 'mid', compaRatio: 0.77 },
    { userId: extraUsers['mateo.rios@tims.co']!.id, currentSalary: 14000000, bandLevel: 'lead', compaRatio: 0.88 },
    { userId: extraUsers['lucia.castro@tims.co']!.id, currentSalary: 12000000, bandLevel: 'lead', compaRatio: 0.75 },
    { userId: extraUsers['nicolas.betancur@tims.co']!.id, currentSalary: 6500000, bandLevel: 'mid', compaRatio: 1.00 },
  ];

  for (const cd of compDefs) {
    const band = salaryBands[cd.bandLevel];
    await db.employeeCompensation.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: cd.userId } },
      update: {},
      create: {
        organizationId: org.id,
        userId: cd.userId,
        currentSalary: cd.currentSalary,
        currency: 'COP',
        compaRatio: cd.compaRatio,
        bandId: band?.id ?? null,
        effectiveDate: daysAgo(180),
      },
    });
  }
  console.log(`[Compensation] ${compDefs.length} employee compensations`);

  // Salary adjustments (pending + approved)
  const adjustmentDefs = [
    { userId: employee.id, type: 'merit', previousSalary: 6500000, newSalary: 7000000, status: 'approved', reason: 'Aumento por desempeno Q1 2026' },
    { userId: extraUsers['valentina.herrera@tims.co']!.id, type: 'merit', previousSalary: 7500000, newSalary: 8500000, status: 'approved', reason: 'Promocion a Senior Designer' },
    { userId: extraUsers['daniel.vargas@tims.co']!.id, type: 'adjustment', previousSalary: 5000000, newSalary: 5500000, status: 'approved', reason: 'Ajuste por equidad salarial' },
    { userId: extraUsers['gabriela.luna@tims.co']!.id, type: 'merit', previousSalary: 5000000, newSalary: 5800000, status: 'pending', reason: 'Propuesta de aumento por desempeno Q2' },
    { userId: recruiter.id, type: 'promotion', previousSalary: 5500000, newSalary: 6000000, status: 'pending', reason: 'Promocion a Senior Recruiter' },
  ];

  const existingAdjustments = await db.salaryAdjustment.count({ where: { organizationId: org.id } });
  if (existingAdjustments === 0) {
    for (const ad of adjustmentDefs) {
      await db.salaryAdjustment.create({
        data: {
          organizationId: org.id,
          userId: ad.userId,
          type: ad.type,
          previousSalary: ad.previousSalary,
          newSalary: ad.newSalary,
          status: ad.status,
          reason: ad.reason,
          requestedById: hr.id,
          approvedById: ad.status === 'approved' ? admin.id : null,
          effectiveDate: ad.status === 'approved' ? daysAgo(30) : daysFromNow(15),
        },
      });
    }
  }
  console.log(`[Adjustments] ${adjustmentDefs.length} salary adjustments`);

  // Benefit Plans
  const benefitPlanDefs = [
    { name: 'Plan de Salud Prepagada', type: 'health', description: 'Cobertura medica prepagada con Colsanitas' },
    { name: 'Plan Dental', type: 'dental', description: 'Cobertura odontologica completa' },
    { name: 'Fondo de Empleados', type: 'savings', description: 'Ahorro cooperativo con aportes de la empresa' },
    { name: 'Seguro de Vida', type: 'life_insurance', description: 'Cobertura de seguro de vida grupal' },
    { name: 'Gimnasio & Bienestar', type: 'wellness', description: 'Subsidio para gimnasio y actividades de bienestar' },
  ];

  const benefitPlans: Record<string, { id: string }> = {};
  for (const bp of benefitPlanDefs) {
    const existing = await db.benefitPlan.findFirst({
      where: { organizationId: org.id, name: bp.name },
      select: { id: true },
    });
    if (existing) {
      benefitPlans[bp.type] = existing;
    } else {
      const plan = await db.benefitPlan.create({
        data: { organizationId: org.id, ...bp },
        select: { id: true },
      });
      benefitPlans[bp.type] = plan;
    }
  }

  // Enroll most users in health + dental
  for (const uid of allUserIds.slice(0, 12)) {
    for (const planType of ['health', 'dental']) {
      const plan = benefitPlans[planType];
      if (!plan) continue;
      await db.benefitEnrollment.upsert({
        where: { userId_benefitPlanId: { userId: uid, benefitPlanId: plan.id } },
        update: {},
        create: { organizationId: org.id, userId: uid, benefitPlanId: plan.id, status: 'active' },
      });
    }
  }
  console.log(`[Benefits] ${Object.keys(benefitPlans).length} plans, enrolled users`);

  // ===========================
  // 13. Learning — Courses + Enrollments
  // ===========================
  const courseDefs = [
    { title: 'Fundamentos de TypeScript', type: 'technical', category: 'Development', duration: 480, isRequired: false },
    { title: 'Liderazgo para Nuevos Managers', type: 'leadership', category: 'Management', duration: 720, isRequired: false },
    { title: 'Seguridad de la Informacion', type: 'compliance', category: 'Security', duration: 120, isRequired: true },
    { title: 'Diversidad e Inclusion en el Trabajo', type: 'compliance', category: 'DEI', duration: 90, isRequired: true },
    { title: 'Introduccion a Machine Learning', type: 'technical', category: 'Data Science', duration: 600, isRequired: false },
    { title: 'Comunicacion Efectiva', type: 'soft_skills', category: 'Communication', duration: 180, isRequired: false },
    { title: 'Gestion Agil de Proyectos', type: 'methodology', category: 'Project Management', duration: 360, isRequired: false },
    { title: 'AWS Cloud Practitioner', type: 'technical', category: 'Cloud', duration: 900, isRequired: false },
  ];

  const courses: Record<string, { id: string }> = {};
  for (const cd of courseDefs) {
    const existing = await db.course.findFirst({
      where: { organizationId: org.id, title: cd.title },
      select: { id: true },
    });
    if (existing) {
      courses[cd.title] = existing;
    } else {
      const course = await db.course.create({
        data: { organizationId: org.id, ...cd, createdById: hr.id },
        select: { id: true },
      });
      courses[cd.title] = course;
    }
  }
  console.log(`[Courses] ${Object.keys(courses).length} courses`);

  // Enrollments
  const enrollmentDefs: { userId: string; courseTitle: string; status: string; progress: number }[] = [
    { userId: employee.id, courseTitle: 'Fundamentos de TypeScript', status: 'completed', progress: 100 },
    { userId: employee.id, courseTitle: 'Seguridad de la Informacion', status: 'completed', progress: 100 },
    { userId: employee.id, courseTitle: 'AWS Cloud Practitioner', status: 'in_progress', progress: 45 },
    { userId: leader.id, courseTitle: 'Liderazgo para Nuevos Managers', status: 'completed', progress: 100 },
    { userId: leader.id, courseTitle: 'Seguridad de la Informacion', status: 'completed', progress: 100 },
    { userId: extraUsers['santiago.ospina@tims.co']!.id, courseTitle: 'AWS Cloud Practitioner', status: 'in_progress', progress: 70 },
    { userId: extraUsers['valentina.herrera@tims.co']!.id, courseTitle: 'Diversidad e Inclusion en el Trabajo', status: 'completed', progress: 100 },
    { userId: extraUsers['camila.restrepo@tims.co']!.id, courseTitle: 'Introduccion a Machine Learning', status: 'in_progress', progress: 55 },
    { userId: hr.id, courseTitle: 'Comunicacion Efectiva', status: 'completed', progress: 100 },
    { userId: hr.id, courseTitle: 'Gestion Agil de Proyectos', status: 'in_progress', progress: 30 },
    { userId: recruiter.id, courseTitle: 'Diversidad e Inclusion en el Trabajo', status: 'completed', progress: 100 },
    { userId: recruiter.id, courseTitle: 'Comunicacion Efectiva', status: 'not_started', progress: 0 },
  ];

  for (const ed of enrollmentDefs) {
    const course = courses[ed.courseTitle];
    if (!course) continue;
    const existing = await db.enrollment.findFirst({
      where: { organizationId: org.id, userId: ed.userId, courseId: course.id },
      select: { id: true },
    });
    if (!existing) {
      await db.enrollment.create({
        data: {
          organizationId: org.id,
          userId: ed.userId,
          courseId: course.id,
          status: ed.status,
          progress: ed.progress,
          completedAt: ed.status === 'completed' ? daysAgo(Math.floor(Math.random() * 30) + 5) : null,
        },
      });
    }
  }
  console.log(`[Enrollments] ${enrollmentDefs.length} enrollments`);

  // ===========================
  // 14. Engagement — Surveys + Responses
  // ===========================
  const surveyDefs = [
    {
      title: 'Encuesta de Clima Organizacional Q2 2026',
      type: 'climate',
      status: 'closed',
      questions: [
        { id: 'q1', text: 'Me siento valorado en mi equipo', type: 'scale', min: 1, max: 5 },
        { id: 'q2', text: 'Tengo las herramientas necesarias para hacer mi trabajo', type: 'scale', min: 1, max: 5 },
        { id: 'q3', text: 'Mi lider me da feedback regularmente', type: 'scale', min: 1, max: 5 },
        { id: 'q4', text: 'Recomendaria esta empresa como lugar de trabajo', type: 'nps', min: 0, max: 10 },
        { id: 'q5', text: 'Comentarios adicionales', type: 'open_text' },
      ],
      startsAt: daysAgo(30),
      endsAt: daysAgo(10),
      responseCount: 12,
    },
    {
      title: 'Encuesta de Onboarding',
      type: 'onboarding',
      status: 'active',
      questions: [
        { id: 'q1', text: 'El proceso de onboarding cumplio mis expectativas', type: 'scale', min: 1, max: 5 },
        { id: 'q2', text: 'Mi buddy fue util durante mis primeros dias', type: 'scale', min: 1, max: 5 },
        { id: 'q3', text: 'Sugerencias de mejora', type: 'open_text' },
      ],
      startsAt: daysAgo(5),
      endsAt: daysFromNow(25),
      responseCount: 3,
    },
    {
      title: 'Pulse Check - Junio 2026',
      type: 'pulse',
      status: 'draft',
      questions: [
        { id: 'q1', text: 'Como te sientes esta semana?', type: 'emoji', options: ['great', 'good', 'ok', 'bad', 'terrible'] },
        { id: 'q2', text: 'Tienes algun bloqueo?', type: 'yes_no' },
      ],
      startsAt: daysFromNow(3),
      endsAt: daysFromNow(10),
      responseCount: 0,
    },
  ];

  for (const sd of surveyDefs) {
    const existing = await db.survey.findFirst({
      where: { organizationId: org.id, title: sd.title },
      select: { id: true },
    });
    if (!existing) {
      const survey = await db.survey.create({
        data: {
          organizationId: org.id,
          title: sd.title,
          type: sd.type,
          status: sd.status,
          questions: sd.questions,
          startsAt: sd.startsAt,
          endsAt: sd.endsAt,
          responseCount: sd.responseCount,
          createdById: hr.id,
        },
        select: { id: true },
      });

      // Add responses for closed survey
      if (sd.status === 'closed') {
        const respondents = allUserIds.slice(0, 12);
        for (const uid of respondents) {
          await db.surveyResponse.create({
            data: {
              organizationId: org.id,
              surveyId: survey.id,
              userId: uid,
              answers: {
                q1: Math.floor(Math.random() * 2) + 3,
                q2: Math.floor(Math.random() * 2) + 3,
                q3: Math.floor(Math.random() * 2) + 3,
                q4: Math.floor(Math.random() * 4) + 6,
                q5: null,
              },
            },
          });
        }
      }
    }
  }
  console.log(`[Surveys] ${surveyDefs.length} surveys`);

  // ===========================
  // 15. Monitoring — Alert Rules + Alerts
  // ===========================
  const alertDefs = [
    { module: 'recruitment', severity: 'warning', title: 'SLA de screening excedido', message: 'La vacante "Senior Full Stack Developer" tiene 3 candidatos que exceden el SLA de screening (48h).' },
    { module: 'recruitment', severity: 'info', title: 'Nuevo candidato aplicado', message: 'Oscar Castillo aplico a la vacante "Senior Full Stack Developer" via LinkedIn.' },
    { module: 'performance', severity: 'warning', title: 'OKR en riesgo', message: 'El OKR "Reducir time-to-hire" de Andres Tafur tiene 2 key results en riesgo.' },
    { module: 'compensation', severity: 'critical', title: 'Ajuste salarial pendiente de aprobacion', message: '2 ajustes salariales llevan mas de 7 dias pendientes de aprobacion.' },
    { module: 'onboarding', severity: 'info', title: 'Onboarding completado', message: 'Daniel Vargas completo exitosamente su plan de onboarding de 90 dias.' },
    { module: 'engagement', severity: 'warning', title: 'eNPS por debajo del objetivo', message: 'El eNPS actual es 38, por debajo del objetivo de 40.' },
    { module: 'succession', severity: 'critical', title: 'Riesgo de fuga alto', message: 'Mateo Rios (Sales Director) tiene un flight risk del 45%. Solo tiene 1 sucesor identificado.' },
    { module: 'learning', severity: 'info', title: 'Certificacion obtenida', message: 'Sofia Perez completo la certificacion de TypeScript Fundamentals.' },
  ];

  const existingAlerts = await db.alert.count({ where: { organizationId: org.id } });
  if (existingAlerts === 0) {
    for (let i = 0; i < alertDefs.length; i++) {
      const ad = alertDefs[i]!;
      await db.alert.create({
        data: {
          organizationId: org.id,
          module: ad.module,
          severity: ad.severity,
          title: ad.title,
          message: ad.message,
          status: i < 6 ? 'active' : 'dismissed',
          dismissedById: i >= 6 ? admin.id : null,
          dismissedAt: i >= 6 ? daysAgo(1) : null,
          createdAt: daysAgo(Math.floor(Math.random() * 14) + 1),
        },
      });
    }
  }
  console.log(`[Alerts] ${alertDefs.length} alerts`);

  // ===========================
  // 16. Candidate Documents (for top candidates)
  // ===========================
  const docDefs = [
    { email: 'ana.martinez@gmail.com', type: 'cv', fileName: 'CV_Ana_Martinez_2026.pdf', fileSize: 245000 },
    { email: 'ana.martinez@gmail.com', type: 'cover_letter', fileName: 'Carta_Ana_Martinez.pdf', fileSize: 120000 },
    { email: 'pedro.gutierrez@hotmail.com', type: 'cv', fileName: 'CV_Pedro_Gutierrez.pdf', fileSize: 310000 },
    { email: 'luisa.morales@outlook.com', type: 'cv', fileName: 'CV_Luisa_Morales.pdf', fileSize: 280000 },
    { email: 'luisa.morales@outlook.com', type: 'portfolio', fileName: 'Portfolio_Luisa_Morales.pdf', fileSize: 4500000 },
    { email: 'diego.ramirez@gmail.com', type: 'cv', fileName: 'CV_Diego_Ramirez.pdf', fileSize: 190000 },
    { email: 'alejandro.sanchez@yahoo.com', type: 'cv', fileName: 'CV_Alejandro_Sanchez.pdf', fileSize: 220000 },
    { email: 'carolina.jimenez@gmail.com', type: 'cv', fileName: 'CV_Carolina_Jimenez.pdf', fileSize: 275000 },
    { email: 'matias.lopez@gmail.com', type: 'cv', fileName: 'CV_Matias_Lopez.pdf', fileSize: 205000 },
  ];

  for (const dd of docDefs) {
    const cand = candidates[dd.email];
    if (!cand) continue;
    const existing = await db.candidateDocument.findFirst({
      where: { candidateId: cand.id, type: dd.type },
      select: { id: true },
    });
    if (!existing) {
      await db.candidateDocument.create({
        data: {
          organizationId: org.id,
          candidateId: cand.id,
          type: dd.type,
          fileName: dd.fileName,
          fileUrl: `/uploads/candidates/${cand.id}/${dd.fileName}`,
          fileSize: dd.fileSize,
        },
      });
    }
  }
  console.log(`[Documents] ${docDefs.length} candidate documents`);

  console.log('\n=== Demo data seeded successfully! ===');
  console.log('Login as admin@tims.co / TimsAts2026! to see all org-level data.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
