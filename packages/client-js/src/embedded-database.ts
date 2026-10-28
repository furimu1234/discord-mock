import { createRequire } from "node:module";
import type * as PostgresModule from "@electric-sql/pglite";
import type * as SocketModule from "@electric-sql/pglite-socket";

export interface EmbeddedDatabaseOptions {
  sql?: string;
}
export interface EmbeddedDatabase {
  dsn: string;
  db: PostgresModule.PGlite;
  close(): Promise<void>;
}

/** 利用者の初期化SQLだけを実行し、DBとTCPリスナーをローカルで所有する。 */
export async function startEphemeralDatabase(
  options: EmbeddedDatabaseOptions = {},
): Promise<EmbeddedDatabase> {
  const require = createRequire(
    typeof __filename === "string" ? __filename : import.meta.url,
  );
  const { PGlite } = require("@electric-sql/pglite") as typeof PostgresModule;
  const { PGLiteSocketServer } =
    require("@electric-sql/pglite-socket") as typeof SocketModule;
  const db = await PGlite.create();
  let socket: InstanceType<typeof PGLiteSocketServer> | undefined;
  try {
    if (options.sql) await db.exec(options.sql);
    socket = new PGLiteSocketServer({
      db,
      host: "127.0.0.1",
      port: 0,
      maxConnections: 4,
    });
    await socket.start();
    const port = Number(socket.getServerConn().split(":").at(-1));
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("Embedded PostgreSQL failed to allocate a TCP port");
    const active = socket;
    let closing: Promise<void> | undefined;
    return {
      dsn: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`,
      db,
      close() {
        closing ??= (async () => {
          try {
            await active.stop();
          } finally {
            await db.close();
          }
        })();
        return closing;
      },
    };
  } catch (error) {
    try {
      await socket?.stop();
    } finally {
      await db.close();
    }
    throw error;
  }
}
