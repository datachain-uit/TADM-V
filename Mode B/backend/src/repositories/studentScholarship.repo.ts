import { StudentScholarship } from '../models/studentScholarship.model';

export const build = (data: any) => new StudentScholarship(data);

export const create = (data: any) => StudentScholarship.create(data);

export const find = (filter: any) => StudentScholarship.find(filter);

export const findOne = (filter: any) => StudentScholarship.findOne(filter);

export const updateMany = (filter: any, update: any) => StudentScholarship.updateMany(filter, update);
