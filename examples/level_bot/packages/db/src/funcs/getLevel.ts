import { and, eq } from 'drizzle-orm';
import type { SchemaDB } from '../client';
import { lvl } from '../schema';

/**
 * ユーザのレベルを更新する
 * @param db drizzle
 * @param values values
 * @returns
 */
export async function getLevel(
	db: SchemaDB,
	filter: { userId: string; serverId: string },
) {
	const result = await db.query.lvl.findFirst({
		where: and(
			eq(lvl.serverId, filter.serverId),
			eq(lvl.userId, filter.userId),
		),
	});

	return result;
}
