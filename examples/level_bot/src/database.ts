import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

/** Real PostgreSQL (WASM), exposed to pg / Drizzle over loopback TCP. */
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
  const socket = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0, maxConnections: 4 });
  try {
    await socket.start();
    const port = Number(socket.getServerConn().split(":").at(-1));
    if (!Number.isInteger(port) || port < 1) {
      throw new Error("Embedded PostgreSQL failed to allocate a TCP port");
    }
    return {
      dsn: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`,
      db,
      async close() {
        await socket.stop();
        await db.close();
      },
    };
  } catch (error) {
    await socket.stop();
    await db.close();
    throw error;
  }
}
