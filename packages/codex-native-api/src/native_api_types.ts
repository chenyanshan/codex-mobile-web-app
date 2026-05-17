export interface CodexNativeInboundAttachment {
  kind: 'image' | 'voice' | 'file' | 'video';
  localPath: string;
  fileName?: string | null;
  mimeType?: string | null;
  transcriptText?: string | null;
  durationSeconds?: number | null;
}

export interface CodexNativeInboundEvent {
  platform: string;
  externalScopeId: string;
  text: string;
  attachments?: CodexNativeInboundAttachment[];
  cwd?: string | null;
  locale?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CodexNativeSession {
  id: string;
  providerProfileId: string;
  codexThreadId: string;
  cwd: string | null;
  title: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CodexNativeSessionSettings {
  bridgeSessionId: string;
  model: string | null;
  reasoningEffort: string | null;
  serviceTier: string | null;
  collaborationMode?: 'plan' | 'default' | null;
  personality?: 'friendly' | 'pragmatic' | 'none' | null;
  accessPreset?: 'read-only' | 'default' | 'full-access' | null;
  approvalPolicy?: string | null;
  sandboxMode?: string | null;
  locale: string | null;
  metadata: Record<string, unknown>;
  updatedAt: number;
}
