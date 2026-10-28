// AMBER — print a scrypt hash for SESSION_PASSPHRASE_HASH (T4 production path).
// Usage: bun run hash-passphrase 'your passphrase'
import { scryptSync, randomBytes } from 'node:crypto'

const input = process.argv[2]
if (!input) {
  console.error('usage: bun run hash-passphrase <passphrase>')
  process.exit(1)
}
const salt = randomBytes(16)
const key = scryptSync(input, salt, 32)
console.log(`${salt.toString('base64')}.${key.toString('base64')}`)
