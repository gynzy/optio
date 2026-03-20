import type {
  ContainerSpec,
  ContainerHandle,
  ContainerStatus,
  ExecSession,
} from "@optio/shared";

export interface LogOptions {
  follow?: boolean;
  since?: Date;
  tail?: number;
}

export interface ExecOptions {
  tty?: boolean;
  cols?: number;
  rows?: number;
}

export interface ContainerRuntime {
  create(spec: ContainerSpec): Promise<ContainerHandle>;
  status(handle: ContainerHandle): Promise<ContainerStatus>;
  logs(handle: ContainerHandle, opts?: LogOptions): AsyncIterable<string>;
  exec(handle: ContainerHandle, command: string[], opts?: ExecOptions): Promise<ExecSession>;
  destroy(handle: ContainerHandle): Promise<void>;
  ping(): Promise<boolean>;
}
