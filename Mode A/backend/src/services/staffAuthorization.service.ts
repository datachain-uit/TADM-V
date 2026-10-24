import * as universityStaffRepo from '../repositories/universityStaff.repo';

async function authorizeStaff(universityId: string, staffId: string, requiredRole: 'STUDENT_AFFAIRS' | 'FINANCE') {
  if (!universityId || !staffId) {
    throw new Error('A universityId and staffId are required');
  }

  const staff = await universityStaffRepo.findOne({ university: universityId, staffId });
  if (!staff) throw new Error('Staff not found in this university: ' + staffId);
  if (staff.status !== 'ACTIVE') throw new Error('Staff account is not ACTIVE: ' + staffId);
  if (staff.role !== requiredRole) {
    throw new Error(
      'Role mismatch: this step requires ' + requiredRole + ', but staff ' + staffId + ' has role ' + staff.role,
    );
  }
  return staff;
}

const ROLE_LABEL: Record<string, string> = {
  STUDENT_AFFAIRS: 'Student Affairs Office',
  FINANCE: 'Finance Office',
};

async function authorizeAnyStaff(universityId: string, staffId: string) {
  if (!universityId || !staffId) {
    throw new Error('A universityId and staffId are required');
  }
  const staff = await universityStaffRepo.findOne({ university: universityId, staffId });
  if (!staff) throw new Error('Staff not found in this university: ' + staffId);
  if (staff.status !== 'ACTIVE') throw new Error('Staff account is not ACTIVE: ' + staffId);
  return staff;
}

export { authorizeStaff, authorizeAnyStaff, ROLE_LABEL };
