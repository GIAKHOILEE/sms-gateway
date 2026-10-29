import {
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
  EmitterSubscription,
} from 'react-native';
import {
  DeviceConfig,
  LedgerEntryItem,
  NetworkStatusEvent,
  SmsDeliveredEvent,
  SmsMessageInspection,
  SmsPartSentEvent,
  SmsPermissionStatus,
  SmsSendOptions,
  SmsSendResult,
} from '../types/sms.types';

export interface ISmsSenderNativeModule {
  checkSmsPermission(): Promise<SmsPermissionStatus>;
  inspectMessage(
    recipient: string,
    message: string,
  ): Promise<SmsMessageInspection>;
  recordJobAccepted(
    jobUid: string,
    lockToken: string | null,
    recipient: string,
    message: string,
  ): Promise<LedgerEntryItem>;
  sendSms(options: SmsSendOptions): Promise<SmsSendResult>;
  getJobLedgerEntry(jobUid: string): Promise<LedgerEntryItem | null>;
  getUnsyncedLedgerEntries(): Promise<LedgerEntryItem[]>;
  markLedgerEntrySynced(jobUid: string): Promise<boolean>;
  getRecentLedgerEntries(limit: number): Promise<LedgerEntryItem[]>;
  saveDeviceConfig(
    serverUrl: string,
    deviceId: string,
    deviceSecret: string,
  ): Promise<boolean>;
  loadDeviceConfig(): Promise<DeviceConfig>;
  setKeepScreenOn(enabled: boolean): Promise<boolean>;
  getNetworkStatus(): Promise<NetworkStatusEvent>;
  setNetworkMonitoringEnabled(enabled: boolean): Promise<boolean>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

function getModule(): ISmsSenderNativeModule | undefined {
  return (NativeModules as { SmsSenderModule?: ISmsSenderNativeModule })
    .SmsSenderModule;
}

let cachedEmitter: NativeEventEmitter | null = null;
function getEventEmitter(): NativeEventEmitter | null {
  const mod = getModule();
  if (!mod) {
    return null;
  }
  if (!cachedEmitter) {
    cachedEmitter = new NativeEventEmitter(mod as any);
  }
  return cachedEmitter;
}

export type PermissionRequestOutcome =
  | 'GRANTED'
  | 'DENIED'
  | 'NEVER_ASK_AGAIN';

export const SmsSenderNative = {
  async checkPermissionAndSim(): Promise<SmsPermissionStatus> {
    const mod = getModule();
    if (!mod) {
      return {
        granted: false,
        defaultSmsSubId: -1,
        hasValidSubscription: false,
      };
    }
    return mod.checkSmsPermission();
  },

  async requestSendSmsPermission(): Promise<PermissionRequestOutcome> {
    if (Platform.OS !== 'android') {
      return 'DENIED';
    }
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.SEND_SMS,
      {
        title: 'Quyền gửi tin nhắn SMS (SEND_SMS)',
        message:
          'Ứng dụng SMS Gateway cần quyền SEND_SMS để gửi tin nhắn qua SIM vật lý khi bạn mở ứng dụng và kết nối.',
        buttonPositive: 'Cho phép',
        buttonNegative: 'Từ chối',
      },
    );
    if (result === PermissionsAndroid.RESULTS.GRANTED) {
      return 'GRANTED';
    }
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      return 'NEVER_ASK_AGAIN';
    }
    return 'DENIED';
  },

  async inspectMessage(
    recipient: string,
    message: string,
  ): Promise<SmsMessageInspection> {
    const mod = getModule();
    if (!mod) {
      return {
        isValidRecipient: /^\+?[0-9]{3,15}$/.test(recipient.trim()),
        normalizedRecipient: recipient.trim(),
        charCount: message.length,
        partsCount: Math.max(1, Math.ceil(message.length / 160)),
        exceedsMaxLength: message.length > 1500,
      };
    }
    return mod.inspectMessage(recipient, message);
  },

  async recordJobAccepted(
    jobUid: string,
    lockToken: string | null,
    recipient: string,
    message: string,
  ): Promise<LedgerEntryItem> {
    const mod = getModule();
    if (!mod) {
      throw new Error('SmsSenderModule is not available');
    }
    return mod.recordJobAccepted(jobUid, lockToken, recipient, message);
  },

  async sendSms(options: SmsSendOptions): Promise<SmsSendResult> {
    const mod = getModule();
    if (!mod) {
      throw new Error('SmsSenderModule is not available');
    }
    return mod.sendSms(options);
  },

  async getJobLedgerEntry(jobUid: string): Promise<LedgerEntryItem | null> {
    const mod = getModule();
    if (!mod) {
      return null;
    }
    return mod.getJobLedgerEntry(jobUid);
  },

  async getUnsyncedLedgerEntries(): Promise<LedgerEntryItem[]> {
    const mod = getModule();
    if (!mod) {
      return [];
    }
    return mod.getUnsyncedLedgerEntries();
  },

  async markLedgerEntrySynced(jobUid: string): Promise<boolean> {
    const mod = getModule();
    if (!mod) {
      return false;
    }
    return mod.markLedgerEntrySynced(jobUid);
  },

  async getRecentLedgerEntries(limit = 50): Promise<LedgerEntryItem[]> {
    const mod = getModule();
    if (!mod) {
      return [];
    }
    return mod.getRecentLedgerEntries(limit);
  },

  async saveDeviceConfig(config: DeviceConfig): Promise<boolean> {
    const mod = getModule();
    if (!mod) {
      return false;
    }
    return mod.saveDeviceConfig(
      config.serverUrl,
      config.deviceId,
      config.deviceSecret,
    );
  },

  async loadDeviceConfig(): Promise<DeviceConfig> {
    const mod = getModule();
    if (!mod) {
      return { serverUrl: '', deviceId: '', deviceSecret: '' };
    }
    return mod.loadDeviceConfig();
  },

  async setKeepScreenOn(enabled: boolean): Promise<boolean> {
    const mod = getModule();
    if (!mod) {
      return false;
    }
    return mod.setKeepScreenOn(enabled);
  },

  async getNetworkStatus(): Promise<NetworkStatusEvent> {
    const mod = getModule();
    if (!mod) {
      return {
        isConnected: false,
        isValidated: false,
        transport: 'NONE',
        timestamp: Date.now(),
      };
    }
    return mod.getNetworkStatus();
  },

  async setNetworkMonitoringEnabled(enabled: boolean): Promise<boolean> {
    const mod = getModule();
    if (!mod) {
      return false;
    }
    return mod.setNetworkMonitoringEnabled(enabled);
  },

  onSmsPartSent(
    listener: (event: SmsPartSentEvent) => void,
  ): EmitterSubscription | null {
    const emitter = getEventEmitter();
    return (
      emitter?.addListener('onSmsPartSent', (evt: unknown) => {
        listener(evt as SmsPartSentEvent);
      }) ?? null
    );
  },

  onSmsDelivered(
    listener: (event: SmsDeliveredEvent) => void,
  ): EmitterSubscription | null {
    const emitter = getEventEmitter();
    return (
      emitter?.addListener('onSmsDelivered', (evt: unknown) => {
        listener(evt as SmsDeliveredEvent);
      }) ?? null
    );
  },

  onNetworkChanged(
    listener: (event: NetworkStatusEvent) => void,
  ): EmitterSubscription | null {
    const emitter = getEventEmitter();
    return (
      emitter?.addListener('onNetworkChanged', (evt: unknown) => {
        listener(evt as NetworkStatusEvent);
      }) ?? null
    );
  },
};
