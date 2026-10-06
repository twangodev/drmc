const encoder = new TextEncoder()

export class CredentialVault {
  private readonly key: Promise<CryptoKey>
  constructor(secret: string) {
    if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('TOKEN_ENCRYPTION_KEY must contain 32 hexadecimal bytes')
    const bytes = Uint8Array.from(secret.match(/../g)!, value => parseInt(value, 16))
    this.key = crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
  }

  async seal(value: unknown, purpose: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(purpose) }, await this.key, encoder.encode(JSON.stringify(value)))
    return encodeBytes(iv) + '.' + encodeBytes(new Uint8Array(ciphertext))
  }

  async open<T>(value: string, purpose: string): Promise<T> {
    const parts = value.split('.')
    if (parts.length !== 2) throw new Error('Invalid encrypted credential')
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBytes(parts[0]!), additionalData: encoder.encode(purpose) }, await this.key, decodeBytes(parts[1]!))
    return JSON.parse(new TextDecoder().decode(plaintext)) as T
  }
}

function encodeBytes(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}
function decodeBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[\w-]+$/.test(value) || value.length > 16_384) throw new Error('Invalid encrypted credential')
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0))
}
