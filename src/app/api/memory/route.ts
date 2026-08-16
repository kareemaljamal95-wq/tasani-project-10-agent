import { NextRequest, NextResponse } from 'next/server';
import { MemorySystem } from '@/lib/ai/memory';

export async function POST(req: NextRequest) {
  try {
    const { content, type, importance, tags } = await req.json();
    const userId = 'demo-user';
    const memorySystem = new MemorySystem(userId);

    const memory = await memorySystem.store(content, type, importance, { tags });
    return NextResponse.json({ memory });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to store memory' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const userId = 'demo-user';
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') ?? '20');
    const type = searchParams.get('type');

    const memorySystem = new MemorySystem(userId);
    const memories = type
      ? await memorySystem.getByType(type as any, limit)
      : await memorySystem.getRecent(limit);

    return NextResponse.json({ memories });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch memories' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Memory ID required' }, { status: 400 });

    const userId = 'demo-user';
    const memorySystem = new MemorySystem(userId);
    await memorySystem.delete(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete memory' }, { status: 500 });
  }
}
