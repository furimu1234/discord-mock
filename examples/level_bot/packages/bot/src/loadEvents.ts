import fs from 'node:fs/promises';
import path from 'node:path';
import type { Client } from 'discord.js';

async function getAllEventFiles(dir: string): Promise<string[]> {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	const files: string[] = [];

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);

		if (entry.isDirectory()) {
			const subFiles = await getAllEventFiles(fullPath);
			files.push(...subFiles);
		} else if (entry.isFile() && entry.name.endsWith('.ts')) {
			files.push(fullPath);
		}
	}

	return files;
}

export async function loadEvents(client: Client, dir: string) {
	const files = await getAllEventFiles(dir);

	for (const file of files) {
		const filePath = path.resolve(dir, file);
		const eventModule = await import(`file://${filePath}`);
		const { name, once, execute } = eventModule;

		if (!name || !execute) continue;

		console.log('LOAD EVENT | FNAME: ', file, ' | EVENT NAME: ', name);

		if (once) {
			client.once(name, (...args) => execute(...args));
		} else {
			client.on(name, (...args) => execute(...args));
		}
	}
}
