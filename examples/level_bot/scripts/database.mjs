import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

// This runs a genuine PostgreSQL engine (WASM) in memory and exposes the
// regular PostgreSQL wire protocol to node-postgres / Drizzle via TCP.
export async function startEphemeralDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS example;
    CREATE TABLE IF NOT EXISTS example.lvl (
      id serial PRIMARY KEY,
      server_id varchar(19) NOT NULL,
      user_id varchar(19) NOT NULL,
      lvl integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS user_idx ON example.lvl(user_id, server_id);
  `);
  const socket = new PGLiteSocketServer({
    db,
    host: '127.0.0.1',
    port: 0,
    maxConnections: 4,
  });
  try {
    await socket.start();
  } catch (error) {
    await db.close();
    throw error;
  }
  const port = Number(socket.getServerConn().split(':').at(-1));
  if (!Number.isInteger(port) || port < 1) {
    await socket.stop();
    await db.close();
    throw new Error('Embedded PostgreSQL failed to allocate a TCP port');
  }
  const dsn = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`;
  return {
    dsn,
    db,
    async close() {
      await socket.stop();
      await db.close();
    },
  };
}
