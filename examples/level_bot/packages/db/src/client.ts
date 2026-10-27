import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema.js';
export * from './funcs';
export type DBSchema = typeof schema;

export type DataBase<TResult extends PgQueryResultHKT> = PgDatabase<
	TResult,
	DBSchema
>;
export type SchemaDB = PgDatabase<PgQueryResultHKT, DBSchema>;

export const MakeDataStore = <TResult extends PgQueryResultHKT>(
	client: PgDatabase<TResult, DBSchema>,
	isTransaction?: boolean,
) => {
	const run = async <T>(
		f: (db: PgDatabase<TResult, DBSchema>) => Promise<T>,
	): Promise<T> => {
		let res: Awaited<T> | undefined = undefined;
		let error: unknown = undefined;

		try {
			if (isTransaction === undefined || isTransaction) {
				res = await client.transaction(async (tx) => {
					try {
						const result = await f(tx);
						return result;
					} catch (er) {
						error = er;
						console.log(er);
						tx.rollback();
					}
				});
			} else {
				const result = await f(client);
				res = result;
			}
		} catch (e) {
			throw error ?? e;
		}

		return res!;
	};

	return {
		do: run,
	};
};

export type DataStoreInterface = ReturnType<typeof MakeDataStore>;

export { schema };
