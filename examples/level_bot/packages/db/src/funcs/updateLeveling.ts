import { type InferSelectModel, and, eq } from 'drizzle-orm';
import type { SchemaDB } from '../client';
import { lvl } from '../schema';

type values = InferSelectModel<typeof lvl>;

/**
 * ユーザのレベルを更新する
 * @param db drizzle
 * @param values values
 * @returns
 */
export async function updateLeveling(
	db: SchemaDB,
	level: number,
	serverId: string,
	userId: string,
) {
	const results = await db
		.update(lvl)
		.set({ lvl: level })
		.where(and(eq(lvl.serverId, serverId), eq(lvl.userId, userId)))
		.returning();

	if (results.length === 0)
		throw new Error(
			`レベリング更新失敗\n${JSON.stringify({ level, serverId, userId })}`,
		);

	return results[0];
}
