import { validateWorkerEnv } from "@rz-chain-reporter/env/worker";

export const workerEnv = validateWorkerEnv(process.env);

export type WorkerEnv = typeof workerEnv;
