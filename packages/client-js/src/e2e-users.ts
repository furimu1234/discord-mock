import type { MockUser } from "dismock/e2e";

/** UTの実行対象: 全員、Webでログイン中、単一ID、複数ID。 */
export type TestUserTarget =
  | "all"
  | "login"
  | { id: string }
  | { ids: readonly string[] };

/** IDを全件検証してから、対象を指定順に返す。 */
export function resolveTestUsers(
  users: readonly MockUser[],
  target: TestUserTarget,
  selectedUserId?: string,
): MockUser[] {
  const humans = users.filter((user) => !user.bot);
  if (target === "all") {
    if (!humans.length)
      throw new Error("テストで操作できるダミーユーザーがいません");
    return humans;
  }

  let ids: readonly string[];
  if (target === "login") {
    if (!selectedUserId) {
      throw new Error(
        "ログイン中のダミーユーザーが未指定です。/test でユーザーを選択して実行してください",
      );
    }
    ids = [selectedUserId];
  } else if (
    target &&
    typeof target === "object" &&
    "id" in target &&
    typeof target.id === "string"
  ) {
    ids = [target.id];
  } else if (
    target &&
    typeof target === "object" &&
    "ids" in target &&
    Array.isArray(target.ids)
  ) {
    ids = target.ids;
  } else {
    throw new Error(
      "users は 'all'、'login'、{ id: '...' }、または { ids: ['...', '...'] } を指定してください",
    );
  }

  if (ids.length === 0)
    throw new Error("users.ids に最低1件のユーザーIDを指定してください");
  const seen = new Set<string>();
  const selected: MockUser[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !id.trim())
      throw new Error("ユーザーIDには空でない文字列を指定してください");
    if (seen.has(id))
      throw new Error(`対象のダミーユーザー ID ${id} が重複しています`);
    seen.add(id);
    const user = humans.find((candidate) => candidate.id === id);
    if (!user)
      throw new Error(`対象のダミーユーザー ID ${id} は存在しないか Bot です`);
    selected.push(user);
  }
  return selected;
}
