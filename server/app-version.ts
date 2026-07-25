import { createRequire } from 'node:module'

interface PackageManifest {
  version?: string
}

const require = createRequire(import.meta.url)
const manifest = require('../package.json') as PackageManifest

export const APP_VERSION = manifest.version || 'development'
