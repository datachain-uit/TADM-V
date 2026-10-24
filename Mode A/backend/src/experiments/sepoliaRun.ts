import fs from 'fs';
import path from 'path';

const ROW_COLUMNS = [
  'student_index',
  'step',
  'tx_hash',
  'sent_at',
  'send_block',
  'block',
  'blocks_waited',
  'confirm_ms',
  'gas_used',
  'status',
  'note',
];

function parseStudentList(text: string | undefined, n: number): number[] {
  const value = (text ?? '').trim();

  if (value === '' || value === 'all') {
    return Array.from({ length: n }, (_, i) => i);
  }

  const chosen = new Set<number>();

  for (const part of value.split(',')) {
    const item = part.trim();

    if (item === '') {
      continue;
    }

    const range = /^(\d+)-(\d+)$/.exec(item);

    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);

      if (from > to) {
        throw new Error(`SEPOLIA_STUDENTS: range ${item} runs backwards`);
      }

      for (let i = from; i <= to; i++) {
        chosen.add(i);
      }
    } else if (/^\d+$/.test(item)) {
      chosen.add(Number(item));
    } else {
      throw new Error(`SEPOLIA_STUDENTS: cannot read "${item}" (use e.g. 0-499 or 0,250,499)`);
    }
  }

  const list = [...chosen].sort((a, b) => a - b);
  const outside = list.find((i) => i >= n);

  if (outside !== undefined) {
    throw new Error(`SEPOLIA_STUDENTS: student ${outside} is outside 0…${n - 1}`);
  }

  return list;
}

function csvCell(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }

  const s = String(value).replace(/"/g, "'");

  return /[,"\n]/.test(s) ? `"${s}"` : s;
}

class RunLog {
  readonly dir: string;
  private readonly statePath: string;
  private readonly logPath: string;
  private readonly csvPath: string;

  private constructor(dir: string) {
    this.dir = dir;
    this.statePath = path.join(dir, 'state.json');
    this.logPath = path.join(dir, 'withdrawals.jsonl');
    this.csvPath = path.join(dir, 'withdrawals.csv');
  }

  static create(outputDir: string, networkName: string): RunLog {
    const log = new RunLog(path.join(outputDir, `run_${networkName}`));

    if (fs.existsSync(log.statePath)) {
      throw new Error(
        `${log.dir} already holds a run — resume it with SEPOLIA_RUN=${log.dir}, or move it away to start a new one`,
      );
    }

    fs.mkdirSync(log.dir, { recursive: true });
    fs.writeFileSync(log.csvPath, ROW_COLUMNS.join(',') + '\n', 'utf8');

    return log;
  }

  static open(dir: string): RunLog {
    const log = new RunLog(path.resolve(dir));

    if (!fs.existsSync(log.statePath)) {
      throw new Error(`SEPOLIA_RUN: ${log.statePath} not found — nothing to resume`);
    }

    return log;
  }

  readState(): any {
    return fs.existsSync(this.statePath) ? JSON.parse(fs.readFileSync(this.statePath, 'utf8')) : {};
  }

  writeState(update: any): any {
    const state = { ...this.readState(), ...update };

    fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');

    return state;
  }

  appendWithdrawal(entry: any, rows: any[]): void {
    fs.appendFileSync(this.logPath, JSON.stringify(entry) + '\n', 'utf8');
    fs.appendFileSync(
      this.csvPath,
      rows.map((r) => ROW_COLUMNS.map((c) => csvCell(r[c])).join(',')).join('\n') + '\n',
      'utf8',
    );
  }

  readWithdrawals(): any[] {
    if (!fs.existsSync(this.logPath)) {
      return [];
    }

    return fs
      .readFileSync(this.logPath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line))
      .sort((a, b) => a.student_index - b.student_index);
  }
}

function describe(values: number[]) {
  const list = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);

  if (list.length === 0) {
    return { count: 0, min: null, mean: null, median: null, max: null };
  }

  const mean = list.reduce((s, v) => s + v, 0) / list.length;
  const middle = Math.floor(list.length / 2);
  const median = list.length % 2 === 1 ? list[middle]! : (list[middle - 1]! + list[middle]!) / 2;

  return {
    count: list.length,
    min: list[0]!,
    mean: Number(mean.toFixed(2)),
    median,
    max: list[list.length - 1]!,
  };
}

async function feeOverrides(provider: any): Promise<any> {
  const tipGwei = process.env.SEPOLIA_PRIORITY_GWEI;

  if (!tipGwei) {
    return {};
  }

  const block = await provider.getBlock('latest');
  const tip = BigInt(Math.round(Number(tipGwei) * 1e9));
  const base = BigInt(block?.baseFeePerGas ?? 0n);

  return { maxPriorityFeePerGas: tip, maxFeePerGas: base * 2n + tip };
}

async function sendTimed(provider: any, send: (overrides: any) => Promise<any>, timeoutMs: number) {
  const overrides = await feeOverrides(provider);
  const sendBlock = await provider.getBlockNumber();
  const sentAt = new Date().toISOString();
  const started = performance.now();

  const tx = await send(overrides);
  const receipt = await tx.wait(1, timeoutMs);

  return {
    hash: String(tx.hash),
    sent_at: sentAt,
    send_block: Number(sendBlock),
    block: Number(receipt.blockNumber),
    blocks_waited: Number(receipt.blockNumber) - Number(sendBlock),
    confirm_ms: Number((performance.now() - started).toFixed(1)),
    gas_used: Number(receipt.gasUsed),
    status: Number(receipt.status),
  };
}

async function affordable(provider: any, address: string, gasUnits: bigint) {
  const [fee, balance] = await Promise.all([provider.getFeeData(), provider.getBalance(address)]);
  const price: bigint = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;

  return { ok: balance >= price * gasUnits, balance, price, needed: price * gasUnits };
}

export { parseStudentList, RunLog, describe, sendTimed, affordable, feeOverrides };
