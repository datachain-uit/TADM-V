import fs from 'fs';
import path from 'path';

const PASS = 'pass';

const PARTIAL_PASS = 'partial';

const FAIL_BY_DESIGN = 'by_design_not_met';

const MEASURED_ELSEWHERE = 'not_measured_here';

const N_TOO_SMALL = 'n_too_small';

const OUT_OF_SCOPE = 'out_of_scope';

const TICK_YES = '✓';
const TICK_NO = '✗';

function isTick(value: unknown): boolean {
  return String(value ?? '')
    .trim()
    .startsWith(TICK_YES);
}

function tickOnly(value: unknown): string {
  const s = String(value ?? '').trim();

  if (s.startsWith(TICK_YES)) {
    return TICK_YES;
  }

  if (s.startsWith(TICK_NO)) {
    return TICK_NO;
  }

  return s;
}

function withdrawStats(artifact: any) {
  const events = artifact?.privacy?.inspectedPublicArtifact?.events;
  const list = Array.isArray(events) ? events : [];

  const withdraws = list.filter((e: any) => e?.event === 'Withdraw');
  const amountLevels = new Set<string>();
  const recipientAddress = new Set<string>();

  for (const e of withdraws) {
    const rv = e?.returnValues || {};
    amountLevels.add(String(rv.amount ?? ''));
    recipientAddress.add(String(rv.recipient ?? ''));
  }

  return {
    withdrawCount: withdraws.length,
    recipientCount: recipientAddress.size,
    amounts: Array.from(amountLevels),
    sample: withdraws
      .slice(0, 3)
      .map((e: any) => {
        const rv = e?.returnValues || {};
        return String(rv.recipient ?? '').slice(0, 10) + '... = ' + String(rv.amount ?? '');
      })
      .join(' | '),
  };
}

function timingStats(artifact: any) {
  const events = artifact?.privacy?.inspectedPublicArtifact?.events;
  const list = Array.isArray(events) ? events : [];

  const blocks = list.filter((e: any) => e?.event === 'Withdraw').map((e: any) => Number(e?.blockNumber));

  const count = new Map<number, number>();

  for (const b of blocks) {
    count.set(b, (count.get(b) || 0) + 1);
  }

  let monotonic = true;

  for (let i = 1; i < blocks.length; i += 1) {
    if (Number(blocks[i]) < Number(blocks[i - 1])) {
      monotonic = false;
    }
  }

  return {
    withdrawCount: blocks.length,
    distinctBlocks: count.size,
    maxPerBlock: count.size === 0 ? 0 : Math.max(...Array.from(count.values())),
    monotonic: monotonic,
  };
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .trim();

  return /[",;]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function csvTable(header: string[], rows: string[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const CC = 'ISO/IEC 15408-2 (Common Criteria) CC:2022 Release 1';
const CC_REF = 'commoncriteriaportal.org, 297-page PDF';

const NIST = 'NIST IR 8202 - Blockchain Technology Overview';
const NIST_REF = 'DOI 10.6028/NIST.IR.8202';

const RFC = 'RFC 6973 - Privacy Considerations for Internet Protocols';
const RFC_REF = 'DOI 10.17487/RFC6973';

const VERBATIM = 'verbatim';

const HEADER = [
  'branch',
  'run_at',
  'git_commit',
  'chain_id',
  'condition',
  'condition_name',
  'standard_id',
  'standard_ref',
  'standard_clause',
  'standard_quote',
  'quote_status',
  'verdict',
  'evidence_name',
  'value',
  'meaning',
];

type Row = {
  condition: string;
  name: string;
  standard: string;
  standardRef: string;
  clause: string;
  quote: string;
  quoteStatus: string;
  verdict: string;
  evidence: [string, unknown, string][];
};

function countCellsWithReason(criteria: any): { withReason: number; total: number; example: string } {
  let hasReason = 0;
  let total = 0;
  let example = '';

  for (const key of Object.keys(criteria || {})) {
    const evidence = criteria[key]?.evidence || {};

    for (const name of Object.keys(evidence)) {
      const value = String(evidence[name] ?? '');
      total += 1;

      if (value.startsWith(TICK_YES) || value.startsWith('✗')) {
        hasReason += 1;

        if (!example) {
          example = name + ' = ' + value;
        }
      }
    }
  }

  return { withReason: hasReason, total: total, example: example };
}

function countOnChainCommitments(artifact: any): number | null {
  const events = artifact?.withdrawal?.events || [];

  for (const e of events) {
    if (e?.event === 'CommitmentsPublished') {
      const arr = e?.returnValues?.commitments;

      if (Array.isArray(arr)) {
        return arr.length;
      }
    }
  }

  return null;
}

function withdrawEventFields(artifact: any): string {
  const events = artifact?.withdrawal?.events || [];

  for (const e of events) {
    if (e?.event === 'Withdraw') {
      return Object.keys(e?.returnValues || {})
        .filter((k) => !/^\d+$/.test(k) && k !== '__length__')
        .join(' | ');
    }
  }

  return '(no Withdraw event found)';
}

function getRootRebuildCheck(artifact: any) {
  const seen = artifact?.rootRebuildCheck_M4;

  if (seen && seen.rebuiltRoot) {
    return {
      leafCount: Number(seen.leafCount || 0),
      rebuiltRoot: String(seen.rebuiltRoot),
      onChainRoot: String(seen.onChainRoot || ''),
      matches: seen.rebuiltRootMatchesOnChain === true,
      source: 'runner, in this run',
    };
  }

  const surface = artifact?.privacy?.inspectedPublicArtifact;
  const events = Array.isArray(surface?.events) ? surface.events : [];

  const published = events.filter((e: any) => e?.event === 'CommitmentsPublished');

  if (published.length === 0) {
    return null;
  }

  const commitmentList = ((published[0]?.returnValues || {}).commitments || []).map((x: any) => String(x));

  if (commitmentList.length === 0) {
    return null;
  }

  try {
    const { spawnSync } = require('child_process');

    const root = path.resolve(__dirname, '../../..');
    const binary = path.join(root, 'target', 'release', process.platform === 'win32' ? 'prover.exe' : 'prover');

    if (!fs.existsSync(binary)) {
      return null;
    }

    const rootResult = spawnSync(binary, ['root'], {
      cwd: path.join(root, 'backend'),
      input: JSON.stringify({ commitments: commitmentList }),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

    if (rootResult.status !== 0) {
      return null;
    }

    const row = String(rootResult.stdout || '')
      .split(/\r?\n/)
      .map((x: string) => x.trim())
      .filter(Boolean);

    let output: any = null;

    for (let i = row.length - 1; i >= 0; i -= 1) {
      try {
        output = JSON.parse(String(row[i]));
        break;
      } catch (_) {}
    }

    if (!output || !output.root) {
      return null;
    }

    const onChain = String(surface?.contractState?.currentRoot || '').toLowerCase();

    return {
      leafCount: commitmentList.length,
      rebuiltRoot: String(output.root),
      onChainRoot: String(surface?.contractState?.currentRoot || ''),
      matches: String(output.root).toLowerCase() === onChain,
      source: 'rebuilt here from the saved event log',
    };
  } catch (_) {
    return null;
  }
}

function buildTableA(artifact: any): Row[] {
  const c = artifact?.qualitativeCriteria_2_1_3 || {};
  const e2a = c['2a_state_readable']?.evidence || {};
  const e2b = c['2b_state_verifiable']?.evidence || {};
  const count = countCellsWithReason(c);
  const commitmentCount = countOnChainCommitments(artifact);

  const m3Passed = isTick(e2b.proofVerifiedOnChain);
  const reused = getRootRebuildCheck(artifact);

  const m4Passed = isTick(e2b.commitmentPublishedOnChain) && reused?.matches === true;

  return [
    {
      condition: 'M1',
      name: 'State readability',
      standard: CC,
      standardRef: CC_REF,
      clause: 'Sect. 8.5.8, FAU_SAR.1.1 (Audit review)',
      quote: 'provide ... the capability to read ... from the audit data',
      quoteStatus: VERBATIM,
      verdict: c['2a_state_readable']?.verdict === PASS ? PASS : PARTIAL_PASS,
      evidence: [
        ['currentRoot', e2a.currentRoot, 'current root read directly from the contract'],
        ['validRoot', tickOnly(e2a.validRoot), 'the contract itself confirms this root was approved'],
        ['usedNullifier', tickOnly(e2a.usedNullifier), 'the contract itself reports this nullifier as spent'],
        ['contractEvents', e2a.contractEvents, 'event sequence readable by outsiders'],
        ['transactionHash', e2a.transactionHash, 'withdrawal transaction - traceable on an explorer'],
      ],
    },
    {
      condition: 'M2',
      name: 'Interpretable presentation',
      standard: CC,
      standardRef: CC_REF,
      clause: 'Sect. 8.5.8, FAU_SAR.1.2 (Audit review)',
      quote: 'provide the audit data in a manner suitable for the user to' + ' interpret the information',
      quoteStatus: VERBATIM,
      verdict: count.withReason > 0 ? PASS : PARTIAL_PASS,
      evidence: [
        [
          'evidenceCellsWithReason',
          count.withReason + ' / ' + count.total,
          'number of evidence cells written as a tick WITH A REASON, not a bare true/false',
        ],
        ['example', count.example, 'one cell as an example - readable as is, no lookup table needed'],
      ],
    },
    {
      condition: 'M3',
      name: 'No trusted third party',
      standard: NIST,
      standardRef: NIST_REF,
      clause: 'Sect. 4 (Consensus Models), p. 18',
      quote:
        'there is no need to have a trusted third party provide the' +
        ' state of the system - every user within the system can verify' +
        " the system's integrity",
      quoteStatus: VERBATIM,
      verdict: m3Passed ? PASS : FAIL_BY_DESIGN,
      evidence: [
        [
          'proofVerifiedOnChain',
          tickOnly(e2b.proofVerifiedOnChain),
          'whether the contract verifies the proof itself - read from the withdraw function ABI',
        ],
        ['verifiedBy', e2b.verifiedBy, 'who actually verifies the proof'],
        [
          'verifiableAxesPassed',
          e2b.verifiableAxesPassed,
          'verifiability axes passed: A = proof re-verifiable, B = root rebuildable',
        ],
      ],
    },
    {
      condition: 'M4',
      name: 'Independent state agreement',
      standard: NIST,
      standardRef: NIST_REF,
      clause: 'Sect. 4 (Consensus Models), p. 18',
      quote:
        'By combining the initial state and the ability to verify every' +
        ' block since then, users can independently agree on the current' +
        ' state of the blockchain',
      quoteStatus: VERBATIM,
      verdict: m4Passed ? PASS : PARTIAL_PASS,
      evidence: [
        [
          'commitmentPublishedOnChain',
          tickOnly(e2b.commitmentPublishedOnChain),
          'whether the commitment set is published on chain',
        ],
        [
          'rootRebuiltFromChainData',
          reused ? (reused.matches ? TICK_YES : TICK_NO) : '(not rebuilt in this run)',
          'the tree WAS rebuilt from on-chain commitments and compared with `currentRoot`' +
            ' - not merely inferred from parameter names in the ABI',
        ],
        [
          'rebuiltRoot',
          reused ? reused.rebuiltRoot : '(none)',
          'root rehashed from ' + String(reused?.leafCount ?? 0) + ' commitments, with the prover `root` mode',
        ],
        [
          'rebuildMeasuredBy',
          reused ? reused.source : '(none)',
          'measured by the runner during the run, or rebuilt from the saved log',
        ],
        ['rootPublishingEvents', e2b.rootPublishingEvents, 'which events carry the data to rebuild the tree'],
        [
          'commitmentsInPublishedRoot',
          commitmentCount === null ? '(no CommitmentsPublished event)' : commitmentCount,
          'number of leaves in the root - COUNTED FROM on-chain EVENTS, not taken from the runner report',
        ],
        [
          'currentRoot',
          e2a.currentRoot,
          'root to compare against after rebuilding the tree from the commitment set above',
        ],
      ],
    },
  ];
}

function buildTableB(artifact: any): Row[] {
  const c = artifact?.qualitativeCriteria_2_1_3 || {};
  const c4 = c['4_private_witness'] || {};
  const e4 = c4.evidence || {};
  const audit = artifact?.publicSurfaceAudit_K7 || {};
  const commitmentCount = countOnChainCommitments(artifact);
  const wd = withdrawStats(artifact);
  const runnerChannels = artifact?.linkabilityChannels_R4;
  const timing = timingStats(artifact);

  const walletNotReused = wd.withdrawCount > 0 && wd.recipientCount === wd.withdrawCount;
  const withdrawFields = withdrawEventFields(artifact);

  const denomRaw = artifact?.privacy?.inspectedPublicArtifact?.contractState?.denomination;
  const denom = denomRaw === undefined || denomRaw === null ? null : String(denomRaw);
  const denominationEnforced = denom !== null && denom !== '0';

  const order = artifact?.withdrawOrderChannel_R4;
  const rowOrderChannel = Boolean(order && order.verdict === PASS);

  const measuredOrder = Boolean(order && Number(order.withdrawalsCompared ?? 0) >= 2);

  const r1Verdict =
    commitmentCount === null
      ? MEASURED_ELSEWHERE
      : commitmentCount <= 1
        ? N_TOO_SMALL
        : denominationEnforced
          ? PASS
          : PARTIAL_PASS;

  return [
    {
      condition: 'R1',
      name: 'Anonymity set',
      standard: RFC,
      standardRef: RFC_REF,
      clause: 'Sect. 3.3 (Terminology), definition of "Anonymity set"',
      quote:
        'A set of individuals that have the same attributes, making them' +
        ' indistinguishable from each other from the perspective of a' +
        ' particular attacker or observer',
      quoteStatus: VERBATIM,
      verdict: r1Verdict,
      evidence: [
        [
          'anonymitySetFromChain',
          commitmentCount === null ? '(not measurable)' : commitmentCount,
          'number of leaves in the published root = UPPER BOUND of the anonymity set, counted from events, not from the runner',
        ],
        ['withdrawEventsObserved', wd.withdrawCount, 'number of Withdraw events counted on chain'],
        ['distinctRecipients', wd.recipientCount, 'number of DISTINCT recipient addresses among those events'],
        [
          'distinctAmounts',
          wd.amounts.length + ' (' + wd.amounts.join(' | ') + ')',
          'number of distinct AMOUNTS. 1 means the amount distinguishes no one from anyone',
        ],
        ['withdrawSample', wd.sample, 'first three events: recipient = amount. Can be checked by hand'],
        [
          'denominationFromContract',
          denom === null ? '(not recorded in this run)' : denom,
          'amount enforced by the contract, read BACK from `denomination()`.' +
            ' Non-zero means the contract REJECTS every deposit of a different amount',
        ],
      ],
    },
    {
      condition: 'R2',
      name: 'Anonymity - rate of correct student <-> withdrawal mapping',
      standard: RFC,
      standardRef: RFC_REF,
      clause: 'Sect. 3.3 (Terminology), definition of "Anonymity"',
      quote: '',
      quoteStatus: OUT_OF_SCOPE,
      verdict: OUT_OF_SCOPE,
      evidence: [
        [
          'reason',
          'duplicates R1 - both answer "can anyone be singled out",' +
            ' but R2 rests on 3 samples while R1 rests on a set of 500, deterministically',
          'removed from the paper scope 2026-09-05',
        ],
        [
          'scopeNote',
          'the final privacy condition set has FOUR: R1 R4 R6 R7',
          'NOT pending work - do not read empty cells as an omission',
        ],
      ],
    },
    {
      condition: 'R3',
      name: 'Unlinkability - PROBABILISTIC',
      standard: RFC,
      standardRef: RFC_REF,
      clause: 'Sect. 3.3 (Terminology), definition of "Unlinkability"',
      quote:
        'Within a particular set of information, the inability of an' +
        ' observer or attacker to distinguish whether two items of interest' +
        ' are related or not (with a high enough degree of probability to be' +
        ' useful to the observer or attacker)',
      quoteStatus: VERBATIM,
      verdict: OUT_OF_SCOPE,
      evidence: [
        [
          'reason',
          'no reference threshold p0 was settled; and at n = 500 it needs 1 497 samples,' +
            ' more than the students in the pool, so it cannot be carried out',
          'removed from the paper scope 2026-09-05',
        ],
        [
          'scopeNote',
          'never write any sentence saying "with probability" about unlinkability',
          'see the Limitations section of the paper',
        ],
      ],
    },
    {
      condition: 'R4',
      name: 'Unlinkability (FPR_UNL.1) - four channels: amount, wallet, payout order, block position',
      standard: CC,
      standardRef: CC_REF,
      clause: 'Sect. 14.4.5, NOTE under FPR_UNL.1.1 (Unlinkability)',
      quote:
        'This SFR intends to look at a chain of interlinked operations by' +
        ' multiple entities. This chain can be subsumed as a transaction',
      quoteStatus: VERBATIM,
      verdict:
        denominationEnforced && rowOrderChannel && walletNotReused ? PASS : measuredOrder ? PARTIAL_PASS : N_TOO_SMALL,
      evidence: [
        [
          'denominationFromContract',
          denom === null ? '(not recorded in this run)' : denom,
          'channel 1 - amount. The contract enforces this amount, read back with `denomination()`',
        ],
        [
          'distinctAmounts',
          wd.amounts.length + ' (' + wd.amounts.join(' | ') + ')',
          'channel 1 - number of distinct amounts on chain. 1 means this channel no longer distinguishes anyone',
        ],
        [
          'measuredBy',
          runnerChannels ? 'runner, in this run' : 're-derived from the saved event log',
          'source of the three cells below: measured by the runner during the run, or re-derived from the saved log',
        ],
        [
          'walletReuseObserved',
          runnerChannels ? runnerChannels.walletReuseObserved : wd.withdrawCount - wd.recipientCount,
          'channel 2 - number of times ONE address received funds twice or more.' +
            ' 0 means no two withdrawals can be linked through a wallet.' +
            ' Blocked at the database layer by A21, checked by poolAndWalletConstraints.test.ts',
        ],
        [
          'shuffleSeed',
          order ? order.shuffleSeed : '(none)',
          'channel 3 - shuffle seed. Recorded so the run is REPRODUCIBLE',
        ],
        [
          'withdrawalsCompared',
          order ? order.withdrawalsCompared : 0,
          'channel 3 - number of withdrawals whose submission position was compared with their on-chain position',
        ],
        [
          'matchingPositions',
          order ? order.matchingPositions : '(not measurable)',
          'channel 3 - number of MATCHING positions. Equal to the withdrawal count means the order leaks entirely',
        ],
        [
          'expectedIfRandom',
          order ? order.expectedIfRandom : '(not measurable)',
          'channel 3 - theoretical expectation if the order is random: fixed points of a random permutation = 1',
        ],
        [
          'orderSample',
          (order?.sample || [])
            .slice(0, 3)
            .map((x: any) => String(x.studentId) + ': ' + String(x.viTriNop) + ' -> ' + String(x.viTriChuoi))
            .join(' | '),
          'channel 3 - first three rows: student id, submission position, on-chain position',
        ],
        [
          'chainCrossCheckAgrees',
          order?.crossCheckFromChain
            ? order.crossCheckFromChain.agreesWithRunnerBookkeeping
              ? TICK_YES
              : TICK_NO
            : '(no cross-check in this run)',
          'channel 3 - `matchingPositions` RECOUNTED from on-chain events.' +
            ' ✓ means the runner bookkeeping matches the chain;' +
            ' ✗ is a real finding and must be investigated',
        ],
        [
          'maxWithdrawalsPerBlock',
          runnerChannels
            ? runnerChannels.maxWithdrawalsPerBlock
            : timing.withdrawCount === 0
              ? '(not measurable)'
              : timing.maxPerBlock,
          'channel 4 - maximum number of withdrawals in the SAME block.' +
            ' 1 is the case where this channel leaks the MOST',
        ],
        [
          'distinctBlocks',
          runnerChannels
            ? runnerChannels.distinctBlocks + ' / ' + runnerChannels.withdrawEventsObserved
            : timing.withdrawCount === 0
              ? '(not measurable)'
              : timing.distinctBlocks + ' / ' + timing.withdrawCount,
          'channel 4 - distinct blocks over the number of withdrawals',
        ],
        [
          'blockOrderMatchesChainOrder',
          runnerChannels
            ? runnerChannels.blockOrderMatchesChainOrder
              ? TICK_YES
              : TICK_NO
            : timing.withdrawCount === 0
              ? '(not measurable)'
              : timing.monotonic
                ? TICK_YES
                : TICK_NO,
          'channel 4 - whether block order is monotonic in transaction order.' +
            ' True means the BLOCK POSITION carries no information beyond the order.' +
            ' NOT a wall-clock timing measurement: the artifact stores no timestamps,' +
            ' and on a test chain timestamps only reflect the speed of the runner loop',
        ],
      ],
    },
    {
      condition: 'R5',
      name: 'Resistance to collusion between users',
      standard: CC,
      standardRef: CC_REF,
      clause: 'Annex I.4.2.2, EXAMPLE 1 (auxiliary constraint of FPR_UNL.1)',
      quote:
        '...the TSF must not only provide protection against each' +
        ' individual user or subject but must protect with respect to' +
        ' cooperating users and/or subjects',
      quoteStatus: VERBATIM,
      verdict: OUT_OF_SCOPE,
      evidence: [
        [
          'reason',
          'it is an EXAMPLE in a CC annex, not a main requirement; and with' +
            ' 3 withdrawers the set only shrinks from 500 to 498 - almost meaningless',
          'removed from the paper scope 2026-09-05',
        ],
        [
          'scopeNote',
          'the collusion channel of R4 is dropped with it - the two are THE SAME measurement',
          'see the Limitations section of the paper',
        ],
      ],
    },
    {
      condition: 'R6',
      name: 'Anonymity of student identity (FPR_ANO.1)',
      standard: CC,
      standardRef: CC_REF,
      clause: 'Sect. 14.2.5 FPR_ANO.1; family behaviour in Sect. 14.2.1',
      quote: 'anonymity ... is not intended to protect the subject identity',
      quoteStatus: VERBATIM,
      verdict: audit.allClean === true ? PASS : PARTIAL_PASS,
      evidence: [
        ['studentsAudited', audit.studentsAudited, 'number of students whose evidence was inspected'],
        ['studentsLeaked', audit.studentsLeaked, 'number of students whose identity leaks on the public surface'],
        ['totalEncodingsChecked', audit.totalEncodingsChecked, 'number of encodings tried for each secret value'],
        [
          'student_id_traces',
          e4.student_id_traces,
          'traces of the student id on the public surface - empty means pass',
        ],
        ['publicSurfacesAudited', e4.publicSurfacesAudited, 'surfaces inspected'],
        [
          'surfaceSizeChars',
          artifact?.privacy?.coverage?.serializedBytes ?? '(not recorded)',
          'size of the inspected public surface, in characters',
        ],
        [
          'minimumSearchableLength',
          artifact?.privacy?.coverage?.minimumSearchableLength ?? '(not recorded)',
          'shortest hex string length that can still be searched reliably, COMPUTED FROM the surface size above',
        ],
        [
          'expectedFalseMatchRate',
          artifact?.privacy?.coverage?.expectedFalseMatchRate ?? '(not recorded)',
          'expected random match rate at the length threshold above - shows that 0 leaks is meaningful',
        ],
      ],
    },
    {
      condition: 'R7',
      name: 'Unobservability (FPR_UNO.1)',
      standard: CC,
      standardRef: CC_REF,
      clause: 'Sect. 14.5.9 FPR_UNO.1.1; family behaviour in Sect. 14.5.1',
      quote:
        '...without others, especially third parties, being able to' +
        ' observe that the resource or service is being used',
      quoteStatus: VERBATIM,
      verdict: FAIL_BY_DESIGN,
      evidence: [
        ['withdrawEventFields', withdrawFields, 'the Withdraw event publicly emits these fields'],
        [
          'withdrawEventsObserved',
          wd.withdrawCount,
          'number of withdrawals an outsider CAN COUNT - exactly the number that actually happened',
        ],
        [
          'distinctRecipients',
          wd.recipientCount,
          'number of visible recipient addresses. Addresses are public by design',
        ],
      ],
    },
  ];
}

function notMeasured(value: unknown): boolean {
  return /^(NGOAI PHAM VI|CHUA DO)\b/.test(String(value ?? '').trim());
}

function buildCsv(branch: string, artifact: any, csvRows: Row[]): string {
  const meta = artifact?.metadata || {};
  const rows: string[][] = [];

  for (const d of csvRows) {
    if (d.verdict === OUT_OF_SCOPE) {
      continue;
    }

    for (const [name, value, meaning] of d.evidence) {
      if (notMeasured(value)) {
        continue;
      }

      if (!Array.isArray(value) && String(value ?? '').trim() === '') {
        continue;
      }

      rows.push([
        branch,
        String(meta.finishedAt ?? meta.startedAt ?? ''),
        String(meta.gitCommit ?? ''),
        String(meta.chainId ?? ''),
        d.condition,
        d.name,
        d.standard,
        d.standardRef,
        d.clause,
        d.quote,
        d.quoteStatus,
        d.verdict,
        name,
        Array.isArray(value) ? (value.length === 0 ? '(empty)' : value.join(' | ')) : String(value ?? ''),
        meaning,
      ]);
    }
  }

  return csvTable(HEADER, rows);
}

function buildStandardPropertyCsvs(branch: string, artifact: any) {
  return {
    transparency: buildCsv(branch, artifact, buildTableA(artifact)),
    privacy: buildCsv(branch, artifact, buildTableB(artifact)),
  };
}

function writeStandardPropertyCsvs(branch: string, jsonPath: string) {
  const artifact = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  const csvs = buildStandardPropertyCsvs(branch, artifact);
  const base = jsonPath.replace(/\.json$/, '');

  const BOM = '﻿';

  const paths = {
    transparency: base + '-A-transparency.csv',
    privacy: base + '-B-privacy.csv',
  };

  fs.writeFileSync(paths.transparency, BOM + csvs.transparency, 'utf8');
  fs.writeFileSync(paths.privacy, BOM + csvs.privacy, 'utf8');

  return paths;
}

if (require.main === module) {
  const jsonPath = process.argv[2];
  const branch = process.argv[3] || 'off-chain (ADV)';

  if (!jsonPath) {
    console.error(
      'Usage: npx ts-node src/experiments/standardPropertyCsv.ts' + ' <path-to-qualitative-*.json> [branch-label]',
    );
    process.exitCode = 1;
  } else {
    const paths = writeStandardPropertyCsvs(branch, path.resolve(jsonPath));

    console.log(JSON.stringify(paths, null, 2));
  }
}

export { buildStandardPropertyCsvs, writeStandardPropertyCsvs };
