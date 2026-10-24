import fs from 'fs';
import path from 'path';

const COLUMNS = [
  'loai',
  'mechanism',
  'network',
  'chain_id',
  'buoc',
  'student_index',
  'gas_used',
  'ganache_gas_used',
  'delta_vs_ganache',
  'thoi_gian_ms',
  'block',
  'status',
  'tx_hash',
  'ghi_chu',
];

function cells(cellValue: any): string {
  if (cellValue === null || cellValue === undefined) {
    return '';
  }

  const s = String(cellValue).replace(/"/g, "'");

  return /[,"\n]/.test(s) ? `"${s}"` : s;
}

function row(r: any): string {
  return COLUMNS.map((c) => cells(r[c])).join(',');
}

function writeCsv(evidence: any, file: string): string {
  const m = evidence.metadata;

  const common = {
    mechanism: m.mechanism,
    network: m.network,
    chain_id: m.chain_id,
  };

  const rows: any[] = [];

  rows.push({
    ...common,
    loai: 'trien_khai',
    buoc: 'deploy_pool',
    gas_used: evidence.deploy_pool.gas_used,
    ganache_gas_used: evidence.deploy_pool.ganache_gas_used,
    delta_vs_ganache: evidence.deploy_pool.delta_vs_ganache,
    block: evidence.deploy_pool.block,
    status: evidence.deploy_pool.status,
    tx_hash: evidence.deploy_pool.hash,
    ghi_chu: `ShieldedPool ${evidence.contracts.shielded_pool}`,
  });

  const u = evidence.update_root;

  rows.push({
    ...common,
    loai: 'duyet_root',
    buoc: 'updateRoot',
    gas_used: u.gas_used,
    ganache_gas_used: u.ganache_gas_used,
    delta_vs_ganache: u.delta_vs_ganache,
    block: u.block,
    status: u.status,
    tx_hash: u.hash,
    ghi_chu:
      `${u.commitments} commitment; calldata ${u.calldata.calldata_bytes} B;` +
      ` EIP-7623 floor ${u.calldata.eip7623_floor_gas};` +
      ` gas equals floor: ${u.gas_equals_eip7623_floor}`,
  });

  for (const r of evidence.withdrawals) {
    rows.push({
      ...common,
      loai: 'rut',
      buoc: 'withdrawOffChain',
      student_index: r.student_index,
      gas_used: r.tx.gas_used,
      ganache_gas_used: r.ganache_gas_used,
      delta_vs_ganache: r.delta_vs_ganache,
      thoi_gian_ms: r.offchain_verify_ms,
      block: r.tx.block,
      status: r.tx.status,
      tx_hash: r.tx.hash,
      ghi_chu:
        `recipient ${r.recipient}; recipient existed before: ${r.recipient_existed_before};` +
        ` thoi_gian_ms is the off-chain verify (separate prover process);` +
        ` nullifier marked used: ${r.nullifier_marked_used}`,
    });
  }

  const replay = evidence.nullifier_replay;

  rows.push({
    ...common,
    loai: 'dung_lai',
    buoc: 'withdrawOffChain_lai',
    student_index: replay.student_index,
    gas_used: replay.gas_used,
    block: replay.block,
    status: replay.status,
    tx_hash: replay.hash,
    ghi_chu: `MUST be rejected: ${replay.revert_reason || replay.send_error}`,
  });

  for (const [name, passed] of Object.entries(evidence.level2_criteria)) {
    rows.push({
      ...common,
      loai: 'tieu_chi',
      buoc: name,
      ghi_chu: passed ? 'PASS' : 'FAIL',
    });
  }

  const rb = evidence.root_rebuild_from_logs;

  rows.push({
    ...common,
    loai: 'tong_hop',
    buoc: 'level2_reached',
    ghi_chu:
      `${evidence.level2_reached};` +
      ` tree rebuilt from logs: ${rb.commitments_in_log} commitments, root matches: ${rb.matches_current_root};` +
      ` proof source: ${evidence.metadata.proof_source};` +
      ` baseline_same_circuit: ${evidence.metadata.baseline_same_circuit}`,
  });

  fs.writeFileSync(file, COLUMNS.join(',') + '\n' + rows.map(row).join('\n') + '\n', 'utf8');

  return file;
}

function writeCsvFromJson(jsonPath: string): string {
  const evidence = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const file = jsonPath.replace(/\.json$/, '.csv');

  return writeCsv(evidence, file);
}

if (require.main === module) {
  const jsonArg = process.argv[2];

  if (!jsonArg) {
    console.error('a path to a validation_*.json file is required');
    process.exit(1);
  }

  console.log(writeCsvFromJson(path.resolve(jsonArg)));
}

export { writeCsv, writeCsvFromJson };
