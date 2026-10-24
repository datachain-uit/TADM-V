const PRIVATE_WITNESS_NAMES = ['student_id', 'rho', 'siblings', 'directions'];

function hexWithoutPrefix(value: string): string {
  return value.replace(/^0x/i, '');
}

function valueEncodings(value: unknown): string[] {
  if (value === null || value === undefined) {
    return [];
  }

  const asText = String(value).trim();

  if (asText === '') {
    return [];
  }

  const encodings = new Set<string>();
  encodings.add(asText);

  let asBigInt: bigint | null = null;

  try {
    asBigInt = /^0x/i.test(asText) ? BigInt(asText) : BigInt(asText.replace(/[^0-9]/g, '') || 'x');
  } catch {
    asBigInt = null;
  }

  if (asBigInt !== null && asBigInt >= 0n) {
    const bare = asBigInt.toString(16);
    const padded = bare.padStart(64, '0');

    encodings.add(asBigInt.toString(10));
    encodings.add(bare);
    encodings.add('0x' + bare);
    encodings.add(padded);
    encodings.add('0x' + padded);
  }

  if (/^(0x)?[0-9a-f]+$/i.test(asText)) {
    encodings.add(hexWithoutPrefix(asText));
  }

  for (const encoding of Array.from(encodings)) {
    if (/[a-f]/i.test(encoding)) {
      encodings.add(encoding.toLowerCase());
      encodings.add(encoding.toUpperCase());
    }
  }

  return Array.from(encodings);
}

const FALSE_ALARM_THRESHOLD = 0.002;
const FLOOR_THRESHOLD = 7;

function thresholdBySurface(hasSurface: number): number {
  let L = FLOOR_THRESHOLD;

  while (L < 32 && hasSurface / Math.pow(16, L) >= FALSE_ALARM_THRESHOLD) {
    L += 1;
  }

  return L;
}

function privateWitnessLeakageCheck(publicArtifact: any, privateValues?: Record<string, unknown>) {
  const serialized = JSON.stringify(publicArtifact);

  const minThreshold = thresholdBySurface(serialized.length);

  const exposedNames = PRIVATE_WITNESS_NAMES.filter((name) => serialized.includes(name));

  const exposedValues: {
    label: string;
    encoding: string;
  }[] = [];
  const skippedTooShort: {
    label: string;
    encoding: string;
  }[] = [];
  let checkedEncodingCount = 0;

  for (const [label, value] of Object.entries(privateValues || {})) {
    for (const encoding of valueEncodings(value)) {
      if (encoding.length < minThreshold) {
        skippedTooShort.push({ label, encoding });
        continue;
      }

      checkedEncodingCount += 1;

      if (serialized.includes(encoding)) {
        exposedValues.push({ label, encoding });
      }
    }
  }

  return {
    passed: exposedNames.length === 0 && exposedValues.length === 0,
    exposedNames,
    exposedValues,
    coverage: {
      serializedBytes: serialized.length,

      minimumSearchableLength: minThreshold,
      expectedFalseMatchRate: (serialized.length / Math.pow(16, minThreshold)).toExponential(2),

      checkedNames: PRIVATE_WITNESS_NAMES,
      checkedEncodingCount,
      skippedTooShort,
    },
  };
}

export { privateWitnessLeakageCheck, valueEncodings, PRIVATE_WITNESS_NAMES };
