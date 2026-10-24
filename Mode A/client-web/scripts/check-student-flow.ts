import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { JsonRpcProvider, Wallet } from 'ethers'
import { decryptBackup, decryptNote, encryptBackup, generateNoteKeyPair } from '../src/crypto'

const BASE = 'http://127.0.0.1:3001/api'
const MODE_ROOT = resolve(import.meta.dirname, '..', '..')
const STUDENT_ID = 24562001
const ETH_0_1 = '100000000000000000'

let failures = 0
function check(ok: boolean, label: string, extra = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
  if (!ok) failures++
}

async function call(method: string, path: string, cookie: string | null, body?: unknown) {
  const response = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const json = await response.json().catch(() => null)
  return { status: response.status, json, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] }
}

function backendCli(args: string[]): string {
  const result = spawnSync('npm', ['run', '--silent', ...args], {
    cwd: resolve(MODE_ROOT, 'backend'),
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, NETWORK: 'ganache', NODE_OPTIONS: '--no-deprecation' },
  })
  if (result.status !== 0) throw new Error(`${args.join(' ')}: ${result.stderr || result.stdout}`)
  return result.stdout
}

async function main() {
  const chain = new JsonRpcProvider('http://127.0.0.1:8545', undefined, { cacheTimeout: -1 })
  const schoolWallet = (await chain.listAccounts())[0]!.address

  console.log('\n=== setup (CLI + staff API)')
  const university = JSON.parse(backendCli(['university:create', '--', '"Client Web Check"', schoolWallet]))
  const U: string = university.universityId
  backendCli(['staff:password', '--', U, 'CTSV-01', 'CTSV-01', 'ctsv-pass-123'])
  backendCli(['staff:password', '--', U, 'KHTC-01', 'KHTC-01', 'khtc-pass-123'])
  const affairs = (await call('POST', '/staff/login', null, { universityId: U, staffId: 'CTSV-01', password: 'ctsv-pass-123' })).cookie
  const finance = (await call('POST', '/staff/login', null, { universityId: U, staffId: 'KHTC-01', password: 'khtc-pass-123' })).cookie
  await call('POST', '/students', affairs, { studentId: STUDENT_ID, email: 'client-web@example.edu' })
  await call('POST', `/students/${STUDENT_ID}/eligibility`, affairs, { decision: 'approve' })
  await call('POST', `/students/${STUDENT_ID}/finance`, finance, { amountWei: ETH_0_1 })
  await call('POST', `/students/${STUDENT_ID}/password`, affairs, { temporaryPassword: 'temp-pass-123' })
  const pool = await call('POST', '/pools', finance, { programName: 'Client Web Check' })
  const poolId: string = pool.json._id ?? pool.json.poolId
  const deployed = await call('POST', `/pools/${poolId}/deploy`, finance, { initialFundingWei: '1000000000000000000' })
  check(deployed.status === 200, 'pool deployed', poolId)

  console.log('\n=== student: sign in, change the temporary password')
  const student = (await call('POST', '/student/login', null, { universityId: U, studentId: STUDENT_ID, password: 'temp-pass-123' })).cookie
  await call('POST', '/student/password', student, { currentPassword: 'temp-pass-123', newPassword: 'student-pass-123' })
  const overview = (await call('GET', '/student/me', student)).json
  check(overview.eligibilityStatus === 'ELIGIBLE' && overview.financeStatus === 'APPROVED', 'student is approved')

  console.log('\n=== [student device] generate keys with the page modules')
  const wallet = Wallet.createRandom()
  const noteKeys = generateNoteKeyPair()
  const secrets = {
    studentId: STUDENT_ID,
    walletAddress: wallet.address,
    walletPrivateKey: wallet.privateKey,
    notePrivateKey: noteKeys.privateKey,
    notePublicKey: noteKeys.publicKey,
  }
  const backup = await encryptBackup(secrets, 'backup-password-123')
  check(JSON.stringify(await decryptBackup(backup, 'backup-password-123')) === JSON.stringify(secrets), 'backup file reopens correctly')

  console.log('\n=== university: register wallet, issue scholarship, approve root')
  const registered = await call('POST', '/students/wallet', affairs, {
    poolId,
    email: 'client-web@example.edu',
    walletAddress: secrets.walletAddress,
    publicKey: secrets.notePublicKey,
  })
  check(registered.status === 200, 'Student Affairs registers the wallet and note public key', registered.json?.error ?? '')
  check((await call('POST', '/scholarships', affairs, { studentId: STUDENT_ID })).status === 200, 'issue scholarship')
  check((await call('POST', `/pools/${poolId}/root/approve`, affairs)).status === 200, 'approve root')

  console.log('\n=== [student device] open the note, then submit it to the university backend')
  const unlocked = await decryptBackup(backup, 'backup-password-123')
  const { cid, envelope } = (await call('GET', `/student/note?poolId=${poolId}`, student)).json
  const note = await decryptNote(envelope, unlocked.notePrivateKey)
  check(note.student_id === STUDENT_ID && note.amount === ETH_0_1, 'decrypt the note the backend encrypted')
  const started = performance.now()
  const submitted = await call('POST', '/student/withdrawal', student, { cid, note })
  check(
    submitted.status === 200 && submitted.json?.status === 'PENDING_APPROVAL',
    'backend generates and verifies the proof',
    submitted.json?.error ?? `${Math.round(performance.now() - started)} ms (a single run, not a measurement)`,
  )

  console.log('\n=== Finance approves the payout')
  const requests = (await call('GET', '/withdrawals?status=PENDING_APPROVAL', finance)).json
  const before = await chain.getBalance(wallet.address)
  const review = await call('POST', `/withdrawals/${requests[0].requestId}/review`, finance, { decision: 'approve' })
  const after = await chain.getBalance(wallet.address)
  check(review.status === 200 && after - before === BigInt(ETH_0_1), 'student wallet receives exactly 0.1 ETH', `${after - before} wei`)

  console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} STEP(S) FAILED`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('ERROR:', error instanceof Error ? error.message : error)
  process.exit(2)
})
