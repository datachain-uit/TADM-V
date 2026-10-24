import { University } from '../models/university.model';

export const create = (data: any) => University.create(data);

export const findById = (id: unknown) => University.findById(id);

export const findOne = (filter: any) => University.findOne(filter);
