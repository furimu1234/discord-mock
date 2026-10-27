import { index, integer, pgSchema, serial, varchar } from 'drizzle-orm/pg-core';
export const dbSchema = pgSchema('example');
export const lvl = dbSchema.table(
  'lvl',
  {
    id: serial().primaryKey(),
    serverId: varchar('server_id', { length: 19 }).notNull(),
    // Upstream typo duplicated 'server_id' here; correct it to 'user_id'.
    userId: varchar('user_id', { length: 19 }).notNull(),
    lvl: integer('lvl').notNull(),
  },
  (rec) => [index('user_idx').on(rec.userId, rec.serverId)],
);
