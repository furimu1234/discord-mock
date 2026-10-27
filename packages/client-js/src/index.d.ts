export interface MockClientOptions {
  baseUrl?: string;
  fetchImpl?: (url: URL, init?: { redirect: "error" }) => Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
}

export interface MockTransport {
  health(): Promise<unknown>;
}

export type EventClient = {
  emit: (...args: any[]) => any;
};

export declare function createMockClient(options?: MockClientOptions): MockTransport;

export declare class DisMockClient<C extends EventClient = EventClient> {
  readonly client: C;
  readonly transport: MockTransport;
  constructor(client: C, options?: MockClientOptions);
  health(): Promise<unknown>;
  dispatch(eventName: string, ...args: any[]): ReturnType<C["emit"]>;
  emit(eventName: string, ...args: any[]): ReturnType<C["emit"]>;
}

export declare function disMockClient<C extends EventClient>(
  client: C,
  options?: MockClientOptions
): DisMockClient<C>;

export declare function disMockMixin<TBase extends new (...args: any[]) => EventClient>(
  BaseClass: TBase,
  options?: MockClientOptions
): new (...args: ConstructorParameters<TBase>) => InstanceType<TBase> & {
  readonly mock: DisMockClient<InstanceType<TBase>>;
};

export declare const disMockClientClass: typeof disMockMixin;
