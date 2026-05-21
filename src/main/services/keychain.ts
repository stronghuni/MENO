import keytar from 'keytar'

const SERVICE = 'io.namuneulbo.meno'
const LEGACY_SERVICE = 'io.namuneulbo.meetingnotes'

export type SecretKey = 'notion.token' | 'huggingface.token'

/**
 * If the user previously stored this key under the old service name
 * (`io.namuneulbo.meetingnotes`), copy it into the new service entry
 * and delete the legacy one. Lazy + idempotent — runs on every read
 * but only does work the first time. Failures are non-fatal: in the
 * worst case the user re-enters the token.
 */
async function migrateLegacy(key: SecretKey): Promise<void> {
  let legacy: string | null
  try {
    legacy = await keytar.getPassword(LEGACY_SERVICE, key)
  } catch {
    return
  }
  if (!legacy) return
  try {
    const current = await keytar.getPassword(SERVICE, key)
    if (!current) {
      await keytar.setPassword(SERVICE, key, legacy)
      console.log(`[migration] keychain ${key}: meetingnotes → meno`)
    }
  } catch (e) {
    console.warn(`[migration] keychain ${key} write failed:`, e)
    return
  }
  // Drop the legacy entry separately so a delete-only failure doesn't
  // surface as a "write failed" — it's already in the new slot.
  try {
    await keytar.deletePassword(LEGACY_SERVICE, key)
  } catch {
    // ignore — legacy delete failures are cosmetic
  }
}

export function setSecret(key: SecretKey, value: string): Promise<void> {
  return keytar.setPassword(SERVICE, key, value)
}

export async function getSecret(key: SecretKey): Promise<string | null> {
  await migrateLegacy(key)
  return keytar.getPassword(SERVICE, key)
}

export async function deleteSecret(key: SecretKey): Promise<boolean> {
  // Best-effort cleanup of any straggler legacy entry.
  void keytar.deletePassword(LEGACY_SERVICE, key).catch(() => {})
  return keytar.deletePassword(SERVICE, key)
}

export async function hasSecret(key: SecretKey): Promise<boolean> {
  await migrateLegacy(key)
  const v = await keytar.getPassword(SERVICE, key)
  return Boolean(v && v.length > 0)
}
