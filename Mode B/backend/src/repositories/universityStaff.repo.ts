import { UniversityStaff } from '../models/universityStaff.model';

export const create = (data: any) => UniversityStaff.create(data);

export const findOne = (filter: any) => UniversityStaff.findOne(filter);
