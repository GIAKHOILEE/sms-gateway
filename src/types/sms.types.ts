export type SmsJobStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SUBMITTED'
  | 'DELIVERED'
  | 'FAILED'
  | 'UNKNOWN';

export type GatewayConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'AUTHENTICATING'
  | 'CONNECTED'
  | 'RECONNECTING';

export interface SmsPermissionStatus {
  granted: boolean;
  defaultSmsSubId: number;
  hasValidSubscription: boolean;
}

export interface SmsMessageInspection {
  isValidRecipient: boolean;
  normalizedRecipient: string;
  charCount: number;
  partsCount: number;
  exceedsMaxLength: boolean;
}

export interface SmsPartResult {
  partIndex: number;
  status: 'SENT_OK' | 'FAILED' | 'TIMEOUT_PENDING';
  resultCode: number;
  radioErrorCode: number;
  errorCode: string | null;
}

export interface SmsSendOptions {
  jobUid?: string;
  lockToken?: string | null;
  recipient: string;
  message: string;
  isTestSms?: boolean;
  timeoutMs?: number;
}

export interface SmsSendResult {
  jobUid: string;
  lockToken?: string | null;
  recipient: string;
  status: 'SUBMITTED' | 'FAILED' | 'UNKNOWN';
  partsTotal: number;
  partsSent: number;
  partsFailed: number;
  partsDelivered?: number;
  errorCode: string | null;
  errorMessage: string | null;
  partResultsJson: string;
  timestamp: number;
  alreadyProcessed: boolean;
}

export interface LedgerEntryItem {
  jobUid: string;
  lockToken?: string | null;
  recipient: string;
  messagePreview: string;
  state: SmsJobStatus | 'ACCEPTED' | 'SENDING';
  partsTotal: number;
  partsSent: number;
  partsFailed: number;
  partsDelivered: number;
  errorCode: string | null;
  errorMessage: string | null;
  partResultsJson: string;
  createdAt: number;
  updatedAt: number;
  syncedToServer: boolean;
  isTestSms: boolean;
}

export interface DeviceConfig {
  serverUrl: string;
  deviceId: string;
  deviceSecret: string;
}

export interface NetworkStatusEvent {
  isConnected: boolean;
  isValidated: boolean;
  transport: 'WIFI' | 'CELLULAR' | 'ETHERNET' | 'OTHER' | 'NONE';
  timestamp: number;
}

export interface SmsPartSentEvent {
  jobUid: string;
  partIndex: number;
  partsTotal: number;
  success: boolean;
  errorCode: string | null;
  resultCode: number;
  radioErrorCode: number;
}

export interface SmsDeliveredEvent {
  jobUid: string;
  partIndex: number;
  partsTotal: number;
  partsDelivered: number;
  delivered: boolean;
  timestamp: number;
}

export interface GatewayLogEntry {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
  message: string;
}

