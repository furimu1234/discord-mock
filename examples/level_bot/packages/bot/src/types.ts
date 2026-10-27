import type {
	Interaction,
	RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { Container as ContainerInstance } from './container';

export type Container = Awaited<ReturnType<typeof ContainerInstance>>;
export type Ref<T> = { current: T };
export type ContainerRef = Ref<
	Awaited<ReturnType<typeof ContainerInstance> | undefined>
>;

export type commandExecute = (interaction: Interaction) => Promise<void>;
export type slashCommands = RESTPostAPIChatInputApplicationCommandsJSONBody[];

export interface AutoConfigInstantServer {
	servers: {
		[key: string]: {
			inviteLink: string;
			lastConnectTime: string;
			used: boolean;
		};
	}[];
}

export interface AutoConfig {
	queue: string[];
	instantServer: AutoConfigInstantServer;
}
