import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const userId = 'demo-user';
    let agents = await prisma.agentConfig.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });

    if (agents.length === 0) {
      const defaultAgents = [
        { type: 'CEO', name: 'CEO Agent', description: 'Strategic business leadership and decision making', systemPrompt: 'You are the CEO Agent. Provide strategic leadership and make high-level decisions.', model: 'gpt-4o', temperature: 0.7 },
        { type: 'SALES', name: 'Sales Agent', description: 'Lead qualification and closing strategies', systemPrompt: 'You are the Sales Agent. Qualify leads and close deals effectively.', model: 'gpt-4o', temperature: 0.7 },
        { type: 'MARKETING', name: 'Marketing Agent', description: 'Market research and campaign management', systemPrompt: 'You are the Marketing Agent. Drive marketing strategy and campaigns.', model: 'gpt-4o', temperature: 0.7 },
        { type: 'RESEARCH', name: 'Research Agent', description: 'Deep research and knowledge synthesis', systemPrompt: 'You are the Research Agent. Conduct thorough research and synthesize findings.', model: 'claude-3-sonnet', temperature: 0.5 },
        { type: 'FINANCE', name: 'Finance Agent', description: 'Financial analysis and revenue optimization', systemPrompt: 'You are the Finance Agent. Analyze finances and optimize revenue.', model: 'gpt-4o', temperature: 0.5 },
        { type: 'OPERATIONS', name: 'Operations Agent', description: 'Process optimization and workflow management', systemPrompt: 'You are the Operations Agent. Optimize workflows and operations.', model: 'gpt-4o-mini', temperature: 0.6 },
        { type: 'FASHION', name: 'Fashion Agent', description: 'Fashion advice and inventory management', systemPrompt: 'You are the Fashion Agent. Provide fashion expertise and manage inventory.', model: 'gpt-4o-mini', temperature: 0.8 },
        { type: 'CUSTOMER_SUPPORT', name: 'Support Agent', description: 'Customer support and issue resolution', systemPrompt: 'You are the Support Agent. Resolve customer issues with empathy and efficiency.', model: 'gpt-4o-mini', temperature: 0.5 },
      ];

      for (const agent of defaultAgents) {
        const created = await prisma.agentConfig.create({
          data: { ...agent, userId, isEnabled: true },
        });
        agents.push(created);
      }
    }

    return NextResponse.json({ agents });
  } catch (error) {
    console.error('Agents API error:', error);
    return NextResponse.json({ error: 'Failed to fetch agents' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, ...updates } = await req.json();
    const agent = await prisma.agentConfig.update({
      where: { id },
      data: updates,
    });
    return NextResponse.json({ agent });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update agent' }, { status: 500 });
  }
}
