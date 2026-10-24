import { connectDatabase, disconnectDatabase } from '../config/db';
import { ScholarshipPool } from '../models/scholarshipPool.model';

const LEGACY_INDEX_NAME = 'university_1';

async function dropLegacyPoolIndex() {
  await connectDatabase();

  const collection = ScholarshipPool.collection;
  const indexes = await collection.indexes();
  const found = indexes.some((index: any) => index.name === LEGACY_INDEX_NAME);

  if (!found) {
    console.log(
      JSON.stringify(
        {
          collection: collection.collectionName,
          legacyIndex: LEGACY_INDEX_NAME,
          dropped: false,
          reason: 'index not present - nothing to do',
          currentIndexes: indexes.map((index: any) => index.name),
        },
        null,
        2,
      ),
    );

    await disconnectDatabase();

    return;
  }

  await collection.dropIndex(LEGACY_INDEX_NAME);

  const remaining = await collection.indexes();

  console.log(
    JSON.stringify(
      {
        collection: collection.collectionName,
        legacyIndex: LEGACY_INDEX_NAME,
        dropped: true,
        note: 'one university can now hold several scholarship programs',
        currentIndexes: remaining.map((index: any) => index.name),
      },
      null,
      2,
    ),
  );

  await disconnectDatabase();
}

export { dropLegacyPoolIndex };

if (require.main === module) {
  dropLegacyPoolIndex().catch((error: any) => {
    console.error('DROP LEGACY POOL INDEX FAILED');
    console.error(error);
    process.exitCode = 1;
  });
}
