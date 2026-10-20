export type Adapter = {
  call<T>(workflow: string, id: string, input: unknown): Promise<T>;
  close(): Promise<void>;
};
