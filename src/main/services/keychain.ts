import keytar from 'keytar'

const SERVICE = 'io.namuneulbo.meetingnotes'

export type SecretKey = 'notion.token' | 'huggingface.token'

export function setSecret(key: SecretKey, value: string): Promise<void> {
  return keytar.setPassword(SERVICE, key, value)
}

export function getSecret(key: SecretKey): Promise<string | null> {
  return keytar.getPassword(SERVICE, key)
}

export async function deleteSecret(key: SecretKey): Promise<boolean> {
  return keytar.deletePassword(SERVICE, key)
}

export async function hasSecret(key: SecretKey): Promise<boolean> {
  const v = await keytar.getPassword(SERVICE, key)
  return Boolean(v && v.length > 0)
}
