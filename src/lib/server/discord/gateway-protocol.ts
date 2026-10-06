/*!
 * Protocol payloads adapted from Discord-Social-RPC 0.2.3, MIT License.
 * Copyright 2026 LeonLeBreton
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

export const presenceProbeDurationMs = 45_000

export const presenceProbeActivity = {
  name: 'DRMC test',
  type: 2,
  details: 'Cloudflare presence test',
  state: 'Testing Discord OAuth presence',
} as const

export function identifyGateway(applicationId: string, accessToken: string) {
  return {
    op: 2,
    d: {
      token: `Bearer ${accessToken}`,
      intents: 0,
      properties: { os: 'linux', browser: 'drmc', device: applicationId },
      compress: false,
    },
  }
}

export interface DiscordActivity {
  name: string
  type: 2
  details: string
  state: string
  timestamps?: { start: number }
  assets?: { large_image: string; large_text: string }
}

export function updateGatewayPresence(active: boolean | DiscordActivity | null) {
  const activity = active === true ? presenceProbeActivity : active === false ? null : active
  return {
    op: 3,
    d: { since: 0, activities: activity ? [activity] : [], status: 'online', afk: false },
  }
}

export function gatewayHeartbeat(sequence: number | null) {
  return { op: 1, d: sequence }
}

export function gatewayObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
