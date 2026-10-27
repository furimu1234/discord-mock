import * as dotenv from 'dotenv';
// Preserve the upstream environment configuration, but resolve variables lazily:
// local Mock tests do not need a PostgreSQL connection or real Discord token.
dotenv.config({path: '../../.env', override: false});
function getEnvVariable(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Environment variable ${key} is missing`);
  return value;
}
export const ENV = {
  get TOKEN() { return getEnvVariable('TOKEN'); },
  get POST_URL() { return getEnvVariable('POST_URL'); },
};
