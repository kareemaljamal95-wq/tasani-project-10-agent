import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding KARMISH database...');

  const hashedPassword = await bcrypt.hash('demo1234', 12);

  const user = await prisma.user.upsert({
    where: { email: 'demo@karmish.ai' },
    update: {},
    create: {
      email: 'demo@karmish.ai',
      name: 'Demo User',
      password: hashedPassword,
      language: 'EN',
      theme: 'DARK',
      timezone: 'UTC',
    },
  });

  console.log(`✅ Created user: ${user.email}`);

  const defaultAgents = [
    { type: 'CEO', name: 'CEO Agent', description: 'Strategic business leadership and decision making', systemPrompt: 'You are the CEO Agent. Provide strategic leadership, make high-level decisions, and oversee business operations. Think like a visionary CEO.', model: 'gpt-4o', temperature: 0.7 },
    { type: 'SALES', name: 'Sales Agent', description: 'Lead qualification and closing strategies', systemPrompt: 'You are the Sales Agent. Qualify leads, handle objections, suggest closing strategies, and generate follow-ups. Think like a top-performing salesperson.', model: 'gpt-4o', temperature: 0.7 },
    { type: 'MARKETING', name: 'Marketing Agent', description: 'Market research and campaign management', systemPrompt: 'You are the Marketing Agent. Research markets, analyze competitors, create content strategies, and optimize campaigns. Think like a CMO.', model: 'gpt-4o', temperature: 0.7 },
    { type: 'RESEARCH', name: 'Research Agent', description: 'Deep research and knowledge synthesis', systemPrompt: 'You are the Research Agent. Conduct deep research, synthesize information, and provide comprehensive analysis. Think like a research scientist.', model: 'claude-3-sonnet', temperature: 0.5 },
    { type: 'FINANCE', name: 'Finance Agent', description: 'Financial analysis and revenue optimization', systemPrompt: 'You are the Finance Agent. Analyze financial data, optimize revenue, manage budgets, and provide financial insights. Think like a CFO.', model: 'gpt-4o', temperature: 0.5 },
    { type: 'OPERATIONS', name: 'Operations Agent', description: 'Process optimization and workflow management', systemPrompt: 'You are the Operations Agent. Optimize workflows, manage processes, and ensure operational efficiency. Think like a COO.', model: 'gpt-4o-mini', temperature: 0.6 },
    { type: 'FASHION', name: 'Fashion Agent', description: 'Fashion advice and inventory management', systemPrompt: 'You are the Fashion Agent. Provide fashion advice, manage inventory, suggest trends, and optimize pricing. Think like a fashion director.', model: 'gpt-4o-mini', temperature: 0.8 },
    { type: 'CUSTOMER_SUPPORT', name: 'Support Agent', description: 'Customer support and issue resolution', systemPrompt: 'You are the Support Agent. Handle customer inquiries, resolve issues, and ensure customer satisfaction. Think like a support manager.', model: 'gpt-4o-mini', temperature: 0.5 },
  ];

  for (const agent of defaultAgents) {
    await prisma.agentConfig.upsert({
      where: { id: `${user.id}-${agent.type}` },
      update: {},
      create: {
        id: `${user.id}-${agent.type}`,
        ...agent,
        userId: user.id,
        isEnabled: true,
      },
    });
  }

  console.log(`✅ Created ${defaultAgents.length} agents`);

  const memories = [
    { content: 'User prefers morning meetings for deep work and creative tasks', type: 'PREFERENCE', importance: 'HIGH' },
    { content: 'User is building an AI-powered personal assistant platform', type: 'FACT', importance: 'HIGH' },
    { content: 'User has a goal to launch product MVP within 3 months', type: 'GOAL', importance: 'CRITICAL' },
    { content: 'User is learning TypeScript and Next.js for development', type: 'SKILL', importance: 'MEDIUM' },
    { content: 'User values work-life balance and takes weekends off', type: 'PREFERENCE', importance: 'MEDIUM' },
  ];

  for (const memory of memories) {
    await prisma.memory.create({
      data: {
        ...memory,
        userId: user.id,
        tags: [memory.type.toLowerCase()],
      },
    });
  }

  console.log(`✅ Created ${memories.length} memories`);

  const tasks = [
    { title: 'Review quarterly business strategy', priority: 'HIGH', status: 'PENDING' },
    { title: 'Prepare investor presentation', priority: 'URGENT', status: 'IN_PROGRESS' },
    { title: 'Update product roadmap', priority: 'HIGH', status: 'PENDING' },
    { title: 'Analyze competitor landscape', priority: 'MEDIUM', status: 'PENDING' },
    { title: 'Set up AI agent configurations', priority: 'MEDIUM', status: 'COMPLETED' },
  ];

  for (const task of tasks) {
    await prisma.task.create({
      data: {
        ...task,
        userId: user.id,
      },
    });
  }

  console.log(`✅ Created ${tasks.length} tasks`);

  const goals = [
    { title: 'Launch MVP within 3 months', type: 'SHORT_TERM', status: 'ACTIVE', progress: 35 },
    { title: 'Reach 1000 active users', type: 'LONG_TERM', status: 'ACTIVE', progress: 15 },
    { title: 'Build a sustainable business', type: 'LIFETIME', status: 'ACTIVE', progress: 25 },
  ];

  for (const goal of goals) {
    await prisma.goal.create({
      data: {
        ...goal,
        userId: user.id,
      },
    });
  }

  console.log(`✅ Created ${goals.length} goals`);

  const habits = [
    { name: 'Morning meditation', frequency: 'DAILY', streak: 12, bestStreak: 30, totalCompletions: 45 },
    { name: 'Read for 30 minutes', frequency: 'DAILY', streak: 8, bestStreak: 15, totalCompletions: 23 },
    { name: 'Review weekly goals', frequency: 'WEEKLY', streak: 3, bestStreak: 8, totalCompletions: 12 },
  ];

  for (const habit of habits) {
    await prisma.habit.create({
      data: {
        ...habit,
        userId: user.id,
        isActive: true,
        daysOfWeek: [1, 2, 3, 4, 5],
        timeOfDay: '09:00',
      },
    });
  }

  console.log(`✅ Created ${habits.length} habits`);

  console.log('🎉 Seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
