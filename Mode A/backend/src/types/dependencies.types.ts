type AppServices = {
  staffLogin: (universityId: string, staffId: string, password: string) => Promise<any>;
  setStaffPassword: (universityId: string, actingStaffId: string, staffId: string, password: string) => Promise<any>;
  createStudentProfile: (universityId: string, staffId: string, studentId: number, email: string) => Promise<any>;
  approveEligibility: (
    universityId: string,
    staffId: string,
    studentId: number,
    decision: 'approve' | 'reject',
  ) => Promise<any>;
  approveFinance: (universityId: string, staffId: string, studentId: number, amountWei: string) => Promise<any>;
  createPool: (
    universityId: string,
    staffId: string,
    programName?: string,
    operatingWallet?: string,
    denominationWei?: string,
  ) => Promise<any>;
  deployPool: (poolId: string, staffId: string, initialFundingWei: string) => Promise<any>;
  fundPool: (poolId: string, staffId: string, amountWei: string, sponsorAddress: string) => Promise<any>;
  recordSponsorFunding: (poolId: string, staffId: string, transactionHash: string) => Promise<any>;
  readPoolBalance: (poolId: string) => Promise<any>;
  issueScholarship: (universityId: string, staffId: string, studentId: number) => Promise<any>;
  approveRoot: (poolId: string, staffId: string) => Promise<any>;
  reviewWithdrawalRequest: (requestId: string, staffId: string, decision: 'approve' | 'reject') => Promise<any>;
  reviewWithdrawalBatch: (requestIds: string[], staffId: string, decision: 'approve' | 'reject') => Promise<any>;
  setStudentTemporaryPassword: (
    universityId: string,
    staffId: string,
    studentId: number,
    temporaryPassword: string,
  ) => Promise<any>;
  registerStudentWallet: (
    universityId: string,
    staffId: string,
    poolId: string,
    email: string,
    walletAddress: string,
    publicKey: string,
  ) => Promise<any>;
  listUniversityStudents: (universityId: string, staffId: string) => Promise<any>;
  listUniversityPools: (universityId: string, staffId: string) => Promise<any>;
  listUniversityWithdrawalRequests: (universityId: string, staffId: string, status?: string) => Promise<any>;
  studentLogin: (universityId: string, studentId: number, password: string) => Promise<any>;
  changeStudentPassword: (
    universityId: string,
    studentId: number,
    currentPassword: string,
    newPassword: string,
  ) => Promise<any>;
  readStudentOverview: (universityId: string, studentId: number) => Promise<any>;
  readOwnEncryptedNote: (universityId: string, studentId: number, poolId: string) => Promise<any>;
  submitOwnWithdrawal: (universityId: string, studentId: number, submission: any) => Promise<any>;
};

type AppDependencies = {
  services: AppServices;
  scope: {
    poolUniversityId: (poolId: string) => Promise<string | null>;
    withdrawalRequestUniversityId: (requestId: string) => Promise<string | null>;
  };
};

export type { AppServices, AppDependencies };
