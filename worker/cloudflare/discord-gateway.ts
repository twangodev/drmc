import { DiscordGatewayFailure, type GatewayConnection } from '../../src/lib/server/discord/gateway'

export async function connectDiscordGateway(request: typeof fetch = fetch.bind(globalThis)): Promise<GatewayConnection> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  let response: Response
  try {
    response = await request('https://gateway.discord.gg/?v=10&encoding=json', {
      headers: { Upgrade: 'websocket', 'User-Agent': 'DiscordBot (https://github.com/twangodev/drmc, 1.0.0)' },
      redirect: 'manual',
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
  const socket = response.webSocket
  if (response.status !== 101 || !socket) {
    await response.body?.cancel()
    throw new DiscordGatewayFailure({ reason: 'upgrade_failed', status: response.status })
  }
  return {
    accept: () => socket.accept(),
    send: message => socket.send(message),
    close: code => socket.close(code),
    onMessage(listener) {
      const receive = (event: MessageEvent) => listener(event.data)
      socket.addEventListener('message', receive)
      return () => socket.removeEventListener('message', receive)
    },
    onClose(listener) {
      const close = (event: CloseEvent) => listener(event.code)
      socket.addEventListener('close', close)
      return () => socket.removeEventListener('close', close)
    },
    onError(listener) {
      socket.addEventListener('error', listener)
      return () => socket.removeEventListener('error', listener)
    },
  }
}
