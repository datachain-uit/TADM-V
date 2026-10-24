import { UniversityStudent } from '../models/universityStudent.model';

export const create = (data: any) => UniversityStudent.create(data);

export const exists = (filter: any) => UniversityStudent.exists(filter);

export const find = (filter: any) => UniversityStudent.find(filter);

export const findById = (id: unknown) => UniversityStudent.findById(id);

export const findOne = (filter: any) => UniversityStudent.findOne(filter);
