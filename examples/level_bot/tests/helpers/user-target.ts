import type { MockUser } from "@discord-mock/client-js/testing";

/** UT ソースで「全員・ブラウザで選択中・ID 指定」の操作ユーザーを選択する。 */
export type TestUserTarget = "all" | "login" | { id: string };

export function resolveTestUsers(
  users: readonly MockUser[],
  target: TestUserTarget,
  selectedUserId?: string,
): MockUser[] {
  const humans = users.filter((user) => !user.bot);
  if (target === "all") {
    if (!humans.length) throw new Error("テストで操作できるダミーユーザーがいません");
    return humans;
  }
  let id: string;
  if (target === "login") {
    if (!selectedUserId) {
      throw new Error("ログイン中のダミーユーザーが未指定です。/test でユーザーを選択して実行してください");
    }
    id = selectedUserId;
  } else if (target && typeof target === "object" && typeof target.id === "string") {
    id = target.id;
  } else {
    throw new Error("users は 'all'、'login'、または { id: '...' } を指定してください");
  }
  const user = humans.find((candidate) => candidate.id === id);
  if (!user) throw new Error(`対象のダミーユーザー ID ${id} は存在しないか Bot です`);
  return [user];
}
