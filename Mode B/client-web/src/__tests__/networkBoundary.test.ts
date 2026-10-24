import type { AxiosAdapter } from 'axios'
import { Wallet } from 'ethers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { axiosBase } from '@/config/axiosBase'
import type { StudentSecrets } from '@/crypto'
import fixture from '@/crypto/__fixtures__/backend-note.json'
import { withdrawScholarshipService } from '@/services/withdrawal'

const POOL_ID = 'pool-boundary-test'

const FORBIDDEN_KEYS = ['privateKey', 'walletPrivateKey', 'notePrivateKey', 'mnemonic', 'seed', 'password']

const ALLOWED_BODY: Record<string, string[]> = {
  'GET /student/note': [],
  'POST /student/withdrawal': ['cid', 'note'],
}

const wallet = Wallet.createRandom()
const secrets: StudentSecrets = {
  studentId: fixture.note.student_id,
  walletAddress: wallet.address,
  walletPrivateKey: wallet.privateKey,
  notePrivateKey: fixture.notePrivateKey,
  notePublicKey: fixture.notePublicKey,
}

const strip0x = (value: string) => value.replace(/^0x/, '').toLowerCase()
const SECRET_VALUES: Record<string, string[]> = {
  notePrivateKey: [strip0x(secrets.notePrivateKey)],
  walletPrivateKey: [strip0x(secrets.walletPrivateKey ?? '')],
}

const REPLIES: Record<string, unknown> = {
  'GET /student/note': { cid: 'QmBoundaryTest', envelope: fixture.envelope },
  'POST /student/withdrawal': { id: 'withdrawal-1', status: 'PENDING_APPROVAL' },
}

interface SentRequest {
  route: string
  params: unknown
  body: unknown
}

const sent: SentRequest[] = []
const originalAdapter = axiosBase.defaults.adapter

const recordingAdapter: AxiosAdapter = async (config) => {
  const route = `${(config.method ?? 'get').toUpperCase()} ${config.url ?? ''}`
  sent.push({ route, params: config.params ?? null, body: typeof config.data === 'string' ? JSON.parse(config.data) : (config.data ?? null) })
  if (!(route in REPLIES)) throw new Error(`no canned reply for ${route}`)
  return { data: REPLIES[route], status: 200, statusText: 'OK', headers: {}, config }
}

beforeEach(() => {
  sent.length = 0
  axiosBase.defaults.adapter = recordingAdapter
})

afterEach(() => {
  axiosBase.defaults.adapter = originalAdapter
})

function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysDeep)
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, inner]) => [key, ...keysDeep(inner)])
  return []
}

describe('the student page never sends a private key to the server', () => {
  it('withdrawal: the note is decrypted locally and only the decrypted note goes to the backend', async () => {
    await withdrawScholarshipService(secrets, POOL_ID, () => undefined)

    expect(sent.map((r) => r.route)).toEqual(['GET /student/note', 'POST /student/withdrawal'])
    expect(sent[0]?.params).toEqual({ poolId: POOL_ID })

    for (const request of sent) {
      const body = request.body && typeof request.body === 'object' ? Object.keys(request.body).sort() : []
      expect(body, request.route).toEqual(ALLOWED_BODY[request.route])

      const text = JSON.stringify(request).toLowerCase()
      for (const [name, forms] of Object.entries(SECRET_VALUES)) {
        for (const form of forms) {
          expect(text.includes(form), `${request.route} contains ${name}`).toBe(false)
        }
      }

      const leakedKeys = keysDeep([request.params, request.body]).filter((key) => FORBIDDEN_KEYS.includes(key))
      expect(leakedKeys, `${request.route} has a secret field`).toEqual([])
    }

    expect(sent[1]?.body).toEqual({ cid: 'QmBoundaryTest', note: fixture.note })
  })
})
