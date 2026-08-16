import { prisma } from '@/lib/prisma';

export type MemoryType = 'FACT' | 'PREFERENCE' | 'GOAL' | 'SKILL' | 'CONVERSATION';
export type MemoryImportance = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface MemoryEntry {
  id: string;
  content: string;
  type: MemoryType;
  importance: MemoryImportance;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface MemorySearchParams {
  query: string;
  types?: MemoryType[];
  limit?: number;
  userId?: string;
}

export class MemorySystem {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  async store(
    content: string,
    type: string,
    importance?: string,
    options?: { tags?: string[] }
  ): Promise<MemoryEntry> {
    const memory = await prisma.memory.create({
      data: {
        content,
        type,
        importance: importance ?? 'MEDIUM',
        tags: options?.tags ?? [],
        userId: this.userId,
      },
    });

    return this.toEntry(memory);
  }

  async getRecent(limit: number = 20): Promise<MemoryEntry[]> {
    const memories = await prisma.memory.findMany({
      where: { userId: this.userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return memories.map(this.toEntry);
  }

  async getByType(type: MemoryType, limit: number = 20): Promise<MemoryEntry[]> {
    const memories = await prisma.memory.findMany({
      where: { userId: this.userId, type },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return memories.map(this.toEntry);
  }

  async search(params: MemorySearchParams): Promise<MemoryEntry[]> {
    const { query, types, limit = 10 } = params;

    const where: any = {
      userId: this.userId,
      content: { contains: query, mode: 'insensitive' },
    };

    if (types && types.length > 0) {
      where.type = { in: types };
    }

    const memories = await prisma.memory.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return memories.map(this.toEntry);
  }

  async delete(id: string): Promise<void> {
    await prisma.memory.delete({
      where: { id },
    });
  }

  private toEntry(memory: any): MemoryEntry {
    return {
      id: memory.id,
      content: memory.content,
      type: memory.type as MemoryType,
      importance: memory.importance as MemoryImportance,
      tags: memory.tags,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
    };
  }
}
