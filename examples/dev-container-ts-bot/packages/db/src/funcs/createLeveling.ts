import type { InferInsertModel } from 'drizzle-orm';
import type { SchemaDB } from '../client';
import { lvl } from '../schema';

type values = InferInsertModel<typeof lvl>;

/**
 * ユーザのレベルを作成する
 * @param db drizzle
 * @param values values
 * @returns
 */
export async function createLeveling(db: SchemaDB, values: values) {
	const results = await db.insert(lvl).values(values).returning();

	if (results.length === 0)
		throw new Error(`レベリング更新失敗\n${JSON.stringify(values)}`);

	return results[0];
}
