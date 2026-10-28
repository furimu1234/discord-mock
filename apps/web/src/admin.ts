import { getElement } from "./dom.js";

interface User { id: string; username: string; bot: boolean; }
interface Role { id: string; name: string; permissions: string; color: number; }
interface Overwrite { id: string; type: 0 | 1; allow: string; deny: string; }
interface Channel { id: string; name: string; type: number; permission_overwrites: Overwrite[]; }
interface Member { user: User; roles: string[]; }
interface AdminState {
  guild: { id: string; name: string; owner_id: string; roles: Role[]; channels: Channel[] };
  users: User[];
  members: Member[];
}
interface BotConfig { command: string; args: string[]; cwd: string; }
interface BotStatus { running: boolean; pid?: number; }
interface DesktopBridge {
  config(): Promise<BotConfig>;
  saveConfig(value: BotConfig): Promise<BotConfig>;
  start(): Promise<BotStatus>;
  stop(): Promise<BotStatus>;
  restart(): Promise<BotStatus>;
  status(): Promise<BotStatus>;
}

declare global { interface Window { discordMockDesktop?: DesktopBridge; } }

const PERMISSIONS: Array<[string, bigint]> = [
  ["管理者 (Administrator)", 8n],
  ["メンバーをキック", 2n],
  ["メンバーをBAN", 4n],
  ["チャンネル管理", 16n],
  ["サーバー管理", 32n],
  ["リアクションを追加", 64n],
  ["チャンネルを見る", 1024n],
  ["メッセージを送信", 2048n],
  ["メッセージ管理", 8192n],
  ["埋め込みリンク", 16384n],
  ["ファイルを添付", 32768n],
  ["履歴を読む", 65536n],
  ["ロール管理", 268435456n],
  ["VCに接続", 1048576n],
  ["VCで発言", 2097152n],
  ["アプリコマンドを使用", 2147483648n],
];

function element<K extends keyof HTMLElementTagNameMap>(tag: K, label = ""): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag);
  if (label) item.textContent = label;
  return item;
}
function input(value = "", placeholder = ""): HTMLInputElement {
  const item = element("input");
  item.value = value;
  item.placeholder = placeholder;
  return item;
}
function action(title: string, handler: () => void): HTMLButtonElement {
  const item = element("button", title);
  item.type = "button";
  item.onclick = handler;
  return item;
}
function check(label: string, enabled: boolean, change: (value: boolean) => void): HTMLElement {
  const wrapper = element("label");
  const checkbox = element("input");
  checkbox.type = "checkbox";
  checkbox.checked = enabled;
  checkbox.onchange = () => change(checkbox.checked);
  wrapper.append(checkbox, document.createTextNode(label));
  return wrapper;
}
function field(label: string, control: HTMLElement): HTMLElement {
  const wrapper = element("label");
  wrapper.append(element("span", label), control);
  return wrapper;
}
function option(value: string, label: string): HTMLOptionElement {
  const node = element("option", label);
  node.value = value;
  return node;
}

export class AdminPage {
  private csrf = "";
  private snapshot: AdminState | null = null;
  private selectedRole = "";
  private selectedChannel = "";
  private selectedUser = "";
  private selectedMember = "";
  private readonly status = getElement("admin-status", "p");

  private async api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await fetch(`/_admin/ui/${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(method === "GET" ? {} : { "x-discord-mock-csrf": this.csrf }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const data: { message?: string } = await response.json().catch(() => ({}));
      throw new Error(data.message ?? `HTTP ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  private async run(task: () => Promise<unknown>): Promise<void> {
    try {
      await task();
      await this.refresh();
      this.status.textContent = "保存しました";
    } catch (error) {
      this.status.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  private async refresh(): Promise<void> {
    this.snapshot = await this.api<AdminState>("state");
    getElement("admin-login", "form").classList.add("hidden");
    getElement("admin-content", "div").classList.remove("hidden");
    this.render();
  }

  async initialize(): Promise<void> {
    const session = await this.api<{ authenticated: boolean; csrf: string | null }>("session");
    getElement("admin-login", "form").onsubmit = (event) => {
      event.preventDefault();
      void this.run(async () => {
        const secret = getElement("admin-secret", "input").value;
        const result = await this.api<{ csrf: string }>("login", "POST", { secret });
        this.csrf = result.csrf;
        getElement("admin-secret", "input").value = "";
      });
    };
    if (session.authenticated && session.csrf) {
      this.csrf = session.csrf;
      await this.refresh();
    }
    if (typeof window !== "undefined" && window.discordMockDesktop) await this.initializeDesktop(window.discordMockDesktop);
  }

  private render(): void {
    if (!this.snapshot) return;
    const state = this.snapshot;
    getElement("admin-guild-title", "strong").textContent = state.guild.name;
    const guildName = getElement("admin-guild-name", "input");
    if (document.activeElement !== guildName) guildName.value = state.guild.name;
    getElement("admin-guild-save", "button").onclick = () =>
      void this.run(() => this.api("guild", "PATCH", { name: guildName.value }));

    this.renderUsers(state);
    this.renderRoles(state);
    this.renderChannels(state);
    this.renderMembers(state);
  }

  private renderUsers(state: AdminState): void {
    const list = getElement("admin-users", "div");
    list.replaceChildren();
    for (const user of state.users) {
      const line = element("div");
      line.className = "admin-item";
      line.append(action(`${user.username} · ${user.id}`, () => {
        this.selectedUser = user.id;
        this.renderUsers(state);
      }));
      list.append(line);
    }
    if (!state.users.some((user) => user.id === this.selectedUser)) this.selectedUser = state.users[0]?.id ?? "";
    const user = state.users.find((item) => item.id === this.selectedUser);
    const editor = getElement("admin-user-editor", "div");
    editor.replaceChildren();
    if (user) {
      const name = input(user.username);
      editor.append(field("表示名", name));
      editor.append(action("名前を保存", () => void this.run(() =>
        this.api(`users/${user.id}`, "PATCH", { username: name.value }))));
      if (user.id !== state.guild.owner_id) {
        editor.append(action("削除", () => {
          if (confirm("ユーザーを削除しますか？")) void this.run(() => this.api(`users/${user.id}`, "DELETE"));
        }));
      }
    }
    getElement("admin-user-create", "form").onsubmit = (event) => {
      event.preventDefault();
      const name = getElement("admin-new-user", "input");
      const id = getElement("admin-new-user-id", "input");
      void this.run(async () => {
        await this.api("users", "POST", { username: name.value, ...(id.value ? { id: id.value } : {}) });
        name.value = ""; id.value = "";
      });
    };
  }

  private permissionEditor(bits: bigint, onChange: (next: bigint) => void): HTMLElement {
    const group = element("div");
    group.className = "admin-permissions";
    for (const [label, bit] of PERMISSIONS) {
      group.append(check(label, (bits & bit) !== 0n, (checked) => {
        bits = checked ? bits | bit : bits & ~bit;
        onChange(bits);
      }));
    }
    return group;
  }

  private renderRoles(state: AdminState): void {
    const list = getElement("admin-roles", "div");
    list.replaceChildren();
    if (!state.guild.roles.some((r) => r.id === this.selectedRole)) this.selectedRole = state.guild.roles[0]?.id ?? "";
    for (const role of state.guild.roles) {
      const line = element("div");
      line.className = "admin-item";
      line.append(action(`${role.name} · ${role.id}`, () => {
        this.selectedRole = role.id;
        this.renderRoles(state);
      }));
      list.append(line);
    }
    const role = state.guild.roles.find((item) => item.id === this.selectedRole);
    const editor = getElement("admin-role-editor", "div");
    editor.replaceChildren();
    if (role) {
      const name = input(role.name);
      let bits = BigInt(role.permissions);
      const decimal = input(role.permissions);
      decimal.onchange = () => {
        try {
          const next = BigInt(decimal.value);
          if (next < 0n || next > (1n << 64n) - 1n) throw new Error("out of range");
          bits = next;
          permissions.replaceWith(this.permissionEditor(bits, (value) => {
            bits = value;
            decimal.value = String(value);
          }));
        } catch { this.status.textContent = "権限は符号なし64bit整数で指定してください"; }
      };
      const permissions = this.permissionEditor(bits, (next) => {
        bits = next;
        decimal.value = String(next);
      });
      editor.append(field("名前", name), field("権限ビット（10進数）", decimal), permissions);
      editor.append(action("ロールの権限を保存", () => void this.run(() =>
        this.api(`roles/${role.id}`, "PATCH", { name: name.value, permissions: decimal.value }))));
      if (role.id !== state.guild.id) editor.append(action("削除", () => {
        if (confirm("このロールを削除しますか？")) void this.run(() => this.api(`roles/${role.id}`, "DELETE"));
      }));
    }
    getElement("admin-role-create", "form").onsubmit = (event) => {
      event.preventDefault();
      const name = getElement("admin-new-role", "input");
      const id = getElement("admin-new-role-id", "input");
      void this.run(async () => {
        await this.api("roles", "POST", { name: name.value, permissions: "0", ...(id.value ? { id: id.value } : {}) });
        name.value = ""; id.value = "";
      });
    };
  }

  private renderChannels(state: AdminState): void {
    const list = getElement("admin-channels", "div");
    list.replaceChildren();
    if (!state.guild.channels.some((c) => c.id === this.selectedChannel)) this.selectedChannel = state.guild.channels[0]?.id ?? "";
    for (const channel of state.guild.channels) {
      list.append(action(`${channel.type === 2 ? "🔊 " : "# "}${channel.name}`, () => {
        this.selectedChannel = channel.id;
        this.renderChannels(state);
      }));
    }
    const channel = state.guild.channels.find((c) => c.id === this.selectedChannel);
    const editor = getElement("admin-channel-editor", "div");
    editor.replaceChildren();
    if (channel) {
      const name = input(channel.name);
      const roles = element("select");
      for (const role of state.guild.roles) roles.append(option(role.id, role.name));
      const overrides = structuredClone(channel.permission_overwrites);
      const grid = element("div");
      const renderOverwrites = (): void => {
        grid.replaceChildren();
        const roleId = roles.value;
        let overwrite = overrides.find((entry) => entry.type === 0 && entry.id === roleId);
        if (!overwrite) {
          overwrite = { id: roleId, type: 0, allow: "0", deny: "0" };
          overrides.push(overwrite);
        }
        for (const [label, bit] of PERMISSIONS) {
          const line = element("label");
          const selector = element("select");
          selector.append(option("inherit", "継承"), option("allow", "許可"), option("deny", "拒否"));
          const allow = BigInt(overwrite.allow);
          const deny = BigInt(overwrite.deny);
          selector.value = allow & bit ? "allow" : deny & bit ? "deny" : "inherit";
          selector.onchange = () => {
            overwrite.allow = String((BigInt(overwrite.allow) & ~bit) | (selector.value === "allow" ? bit : 0n));
            overwrite.deny = String((BigInt(overwrite.deny) & ~bit) | (selector.value === "deny" ? bit : 0n));
          };
          line.append(document.createTextNode(label), selector);
          grid.append(line);
        }
      };
      roles.onchange = renderOverwrites;
      renderOverwrites();
      editor.append(field("チャンネル名", name), field("権限を編集するロール", roles), grid);
      editor.append(action("チャンネル設定を保存", () => void this.run(() =>
        this.api(`channels/${channel.id}`, "PATCH", { name: name.value, permission_overwrites: overrides.filter((o) => BigInt(o.allow) !== 0n || BigInt(o.deny) !== 0n) }))));
      editor.append(action("削除", () => {
        if (confirm("チャンネルと履歴を削除しますか？")) void this.run(() => this.api(`channels/${channel.id}`, "DELETE"));
      }));
    }
    getElement("admin-channel-create", "form").onsubmit = (event) => {
      event.preventDefault();
      const name = getElement("admin-new-channel", "input");
      const type = getElement("admin-new-channel-type", "select");
      const id = getElement("admin-new-channel-id", "input");
      void this.run(async () => {
        await this.api("channels", "POST", { name: name.value, type: Number(type.value), ...(id.value ? { id: id.value } : {}) });
        name.value = ""; id.value = "";
      });
    };
  }

  private renderMembers(state: AdminState): void {
    const select = getElement("admin-member-select", "select");
    select.replaceChildren(...state.members.filter((m) => !m.user.bot).map((m) => option(m.user.id, m.user.username)));
    if (!state.members.some((m) => m.user.id === this.selectedMember)) this.selectedMember = state.users[0]?.id ?? "";
    select.value = this.selectedMember;
    select.onchange = () => { this.selectedMember = select.value; this.renderMembers(state); };
    const editor = getElement("admin-member-roles", "div");
    editor.replaceChildren();
    const member = state.members.find((m) => m.user.id === this.selectedMember);
    if (!member) return;
    const roles = new Set(member.roles);
    for (const role of state.guild.roles.filter((r) => r.id !== state.guild.id)) {
      editor.append(check(role.name, roles.has(role.id), (enabled) => {
        if (enabled) roles.add(role.id); else roles.delete(role.id);
      }));
    }
    editor.append(action("所属ロールを保存", () => void this.run(() =>
      this.api(`members/${member.user.id}`, "PATCH", { roles: [...roles] }))));
  }

  private async initializeDesktop(bridge: DesktopBridge): Promise<void> {
    getElement("desktop-controls", "section").classList.remove("hidden");
    const command = getElement("desktop-command", "input");
    const args = getElement("desktop-args", "textarea");
    const cwd = getElement("desktop-cwd", "input");
    const status = getElement("desktop-status", "p");
    const config = await bridge.config();
    command.value = config.command;
    args.value = JSON.stringify(config.args);
    cwd.value = config.cwd;
    const updateStatus = async (): Promise<void> => {
      const info = await bridge.status();
      status.textContent = info.running ? `Bot 実行中 (PID: ${info.pid})` : "Bot 停止中";
    };
    getElement("desktop-save", "button").onclick = () => void this.run(async () => {
      const value = JSON.parse(args.value) as unknown;
      if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) throw new Error("引数は JSON 文字列配列にしてください");
      await bridge.saveConfig({ command: command.value, args: value, cwd: cwd.value });
      await updateStatus();
    });
    for (const [id, run] of [
      ["desktop-start", () => bridge.start()],
      ["desktop-stop", () => bridge.stop()],
      ["desktop-restart", () => bridge.restart()],
    ] as const) {
      getElement(id, "button").onclick = () => void this.run(async () => { await run(); await updateStatus(); });
    }
    await updateStatus();
  }
}
