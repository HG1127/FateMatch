// Vercel programmatic configuration. Requires explicitly configured preview backend.
import { createVercelSplitConfig } from './scripts/vercel-split-config.mjs'

export const config = createVercelSplitConfig(process.env)
