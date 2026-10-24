import express from 'express';
import { createAuthRouter } from './routes/auth.routes';
import { createStudentRouter } from './routes/student.routes';
import { createPoolRouter } from './routes/pool.routes';
import { createScholarshipRouter } from './routes/scholarship.routes';
import { createWithdrawalRouter } from './routes/withdrawal.routes';
import { notFoundHandler, errorHandler } from './middlewares/error.middleware';

function defaultDependencies() {
  const { withDatabase } = require('./config/db');
  const staff = require('./services/staff.service');
  const student = require('./services/student.service');
  const pool = require('./services/pool.service');
  const scholarship = require('./services/scholarship.service');
  const rootApproval = require('./services/rootApproval.service');
  const withdrawalRequest = require('./services/withdrawalRequest.service');
  const withdrawalReview = require('./services/withdrawalReview.service');
  const studentAccount = require('./services/studentAccount.service');
  const studentWallet = require('./services/studentWallet.service');
  const studentWithdrawal = require('./services/studentWithdrawal.service');
  const scope = require('./services/universityScope.service');

  const withDb =
    (service: (...args: any[]) => Promise<any>) =>
    (...args: any[]) =>
      withDatabase(() => service(...args));

  return {
    services: {
      staffLogin: withDb(staff.staffLogin),
      setStaffPassword: withDb(staff.setStaffPassword),
      createStudentProfile: withDb(student.createStudentProfile),
      approveEligibility: withDb(student.approveEligibility),
      approveFinance: withDb(student.approveFinance),
      createPool: withDb(pool.createScholarshipPool),
      deployPool: withDb(pool.deployScholarshipPool),
      fundPool: withDb(pool.fundPool),
      recordSponsorFunding: withDb(pool.recordSponsorFunding),
      readPoolBalance: withDb(pool.readPoolBalance),
      issueScholarship: withDb(scholarship.issueScholarship),
      approveRoot: withDb(rootApproval.approveRoot),
      reviewWithdrawalRequest: withDb(withdrawalReview.reviewWithdrawalRequest),
      reviewWithdrawalBatch: withDb(withdrawalReview.reviewWithdrawalBatch),
      setStudentTemporaryPassword: withDb(studentAccount.setStudentTemporaryPassword),
      registerStudentWallet: withDb(studentWallet.registerStudentWallet),
      listUniversityStudents: withDb(student.listUniversityStudents),
      listUniversityPools: withDb(pool.listUniversityPools),
      listUniversityWithdrawalRequests: withDb(withdrawalRequest.listUniversityWithdrawalRequests),
      studentLogin: withDb(studentAccount.studentLogin),
      changeStudentPassword: withDb(studentAccount.changeStudentPassword),
      readStudentOverview: withDb(studentAccount.readStudentOverview),
      readOwnEncryptedNote: withDb(studentWithdrawal.readOwnEncryptedNote),
      submitOwnWithdrawal: withDb(studentWithdrawal.submitOwnWithdrawal),
    },
    scope: {
      poolUniversityId: scope.poolUniversityId,
      withdrawalRequestUniversityId: scope.withdrawalRequestUniversityId,
    },
  };
}

function createApp(dependencies: any = defaultDependencies()) {
  const app = express();

  app.set('json replacer', (_key: string, value: unknown) => (typeof value === 'bigint' ? value.toString() : value));

  app.use(express.json({ limit: '64kb' }));

  app.use('/api', createAuthRouter(dependencies));
  app.use('/api', createStudentRouter(dependencies));
  app.use('/api', createPoolRouter(dependencies));
  app.use('/api', createScholarshipRouter(dependencies));
  app.use('/api', createWithdrawalRouter(dependencies));

  app.use('/api', notFoundHandler);

  app.use(errorHandler);

  return app;
}

export { createApp, defaultDependencies };
