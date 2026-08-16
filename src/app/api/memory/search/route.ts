import { NextRequest, NextResponse } from 'next/server';
import { MemorySystem } from '@/lib/ai/memory';

export async function POST(req: NextRequest) {
  try {
    const { query, type, limit = 10 } = await req.json();
    const userId = 'demo-user';
    const memorySystem = new MemorySystem(userId);

    const results = await memorySystem.search({
      query,
      types: type ? [type] : undefined,
      limit,
      userId,
    });

    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
