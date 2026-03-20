export interface SecretRef {
  id: string;
  name: string;
  scope: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSecretInput {
  name: string;
  value: string;
  scope?: string;
}
