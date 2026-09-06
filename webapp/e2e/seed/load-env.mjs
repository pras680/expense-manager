// Loads local, gitignored env files so the e2e suite and its seed script
// don't need TEST_USER_EMAIL/TEST_USER_PASSWORD (or the Supabase URL/anon
// key, for the plain Node seed script which isn't Vite-processed) exported
// by hand on every run. Existing process.env values always win (Node's
// loadEnvFile, like dotenv, never overwrites a variable that's already set),
// so a CI environment's real exports still take priority over these files.
//
// Side-effect import — `import './load-env.mjs'` at the top of any script
// that needs these vars, before reading process.env.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const webappDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

for (const file of ['.env.local', '.env.e2e.local']) {
  const path = join(webappDir, file)
  if (existsSync(path)) process.loadEnvFile(path)
}
