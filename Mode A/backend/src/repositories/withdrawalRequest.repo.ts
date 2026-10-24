import { WithdrawalRequest } from '../models/withdrawalRequest.model';

export const create = (data: any) => WithdrawalRequest.create(data);

export const exists = (filter: any) => WithdrawalRequest.exists(filter);

export const find = (filter: any) => WithdrawalRequest.find(filter);

export const findById = (id: unknown) => WithdrawalRequest.findById(id);

export const findOne = (filter: any) => WithdrawalRequest.findOne(filter);
