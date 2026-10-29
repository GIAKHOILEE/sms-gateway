/**
 * @format
 */

import React from 'react';
import { NativeModules } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

const mockNativeModule = {
  checkSmsPermission: jest.fn().mockResolvedValue({
    granted: true,
    defaultSmsSubId: 1,
    hasValidSubscription: true,
  }),
  inspectMessage: jest.fn().mockResolvedValue({
    isValidRecipient: true,
    normalizedRecipient: '0901234567',
    charCount: 12,
    partsCount: 1,
    exceedsMaxLength: false,
  }),
  recordJobAccepted: jest.fn().mockResolvedValue({
    jobUid: 'job-1',
    recipient: '0901234567',
    state: 'ACCEPTED',
    partsTotal: 1,
    partsSent: 0,
    partsFailed: 0,
    partsDelivered: 0,
  }),
  sendSms: jest.fn().mockResolvedValue({
    jobUid: 'test-123',
    recipient: '0901234567',
    status: 'SUBMITTED',
    partsTotal: 1,
    partsSent: 1,
    partsFailed: 0,
    errorCode: null,
    errorMessage: null,
    partResultsJson: '[]',
    timestamp: Date.now(),
    alreadyProcessed: false,
  }),
  getJobLedgerEntry: jest.fn().mockResolvedValue(null),
  getUnsyncedLedgerEntries: jest.fn().mockResolvedValue([]),
  markLedgerEntrySynced: jest.fn().mockResolvedValue(true),
  getRecentLedgerEntries: jest.fn().mockResolvedValue([]),
  saveDeviceConfig: jest.fn().mockResolvedValue(true),
  loadDeviceConfig: jest.fn().mockResolvedValue({
    serverUrl: 'wss://example.com/ws/sms-gateway',
    deviceId: 'android-sim-01',
    deviceSecret: '',
  }),
  setKeepScreenOn: jest.fn().mockResolvedValue(true),
  getNetworkStatus: jest.fn().mockResolvedValue({
    isConnected: true,
    isValidated: true,
    transport: 'WIFI',
    timestamp: Date.now(),
  }),
  setNetworkMonitoringEnabled: jest.fn().mockResolvedValue(true),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

NativeModules.SmsSenderModule = mockNativeModule;

import App from '../App';
import { SmsSenderNative } from '../src/native/SmsSenderNative';
import {
  computeBackoffDelayWithJitter,
  GatewaySocketClient,
} from '../src/services/GatewaySocketClient';

describe('Phase 2 & 3: Android SMS Gateway App & WSS Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    NativeModules.SmsSenderModule = mockNativeModule;
  });

  test('renders App in foreground offline state and loads permission & config', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
    });
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });

    const json = JSON.stringify(renderer?.toJSON());
    expect(json).toContain('Trạm Gửi SMS Cá Nhân');
    expect(json).toContain('Chưa kết nối. Trạm SMS đang ngoại tuyến.');
    expect(mockNativeModule.loadDeviceConfig).toHaveBeenCalled();
    expect(mockNativeModule.checkSmsPermission).toHaveBeenCalled();

    await ReactTestRenderer.act(async () => {
      renderer?.unmount();
    });
  });

  test('SmsSenderNative.sendSms delegates to Kotlin SmsSenderModule and returns structured result', async () => {
    const res = await SmsSenderNative.sendSms({
      recipient: '0901234567',
      message: 'Xin chao',
      isTestSms: true,
    });
    expect(mockNativeModule.sendSms).toHaveBeenCalledWith({
      recipient: '0901234567',
      message: 'Xin chao',
      isTestSms: true,
    });
    expect(res.status).toBe('SUBMITTED');
    expect(res.partsTotal).toBe(1);
    expect(res.partsSent).toBe(1);
  });

  test('computeBackoffDelayWithJitter follows 1, 2, 4, 8, 16, 32, 60s schedule with jitter', () => {
    // With randomFn = 0.5 -> jitterFactor = 1.0 (exact base delay)
    const fixedRandom = () => 0.5;
    expect(computeBackoffDelayWithJitter(0, 60_000, fixedRandom)).toBe(1000);
    expect(computeBackoffDelayWithJitter(1, 60_000, fixedRandom)).toBe(2000);
    expect(computeBackoffDelayWithJitter(2, 60_000, fixedRandom)).toBe(4000);
    expect(computeBackoffDelayWithJitter(3, 60_000, fixedRandom)).toBe(8000);
    expect(computeBackoffDelayWithJitter(4, 60_000, fixedRandom)).toBe(16000);
    expect(computeBackoffDelayWithJitter(5, 60_000, fixedRandom)).toBe(32000);
    expect(computeBackoffDelayWithJitter(6, 60_000, fixedRandom)).toBe(60000);
    expect(computeBackoffDelayWithJitter(9, 60_000, fixedRandom)).toBe(60000);
  });

  test('GatewaySocketClient rejects non-WSS URL when allowInsecureWsInDev is false', () => {
    const states: string[] = [];
    const client = new GatewaySocketClient({
      serverUrl: 'http://insecure.example.com/ws/sms-gateway',
      deviceId: 'android-sim-01',
      deviceSecret: 'secret-123',
      allowInsecureWsInDev: false,
      onStateChange: (_state, msg) => states.push(msg),
    });

    client.connect();
    expect(client.getState()).toBe('DISCONNECTED');
    expect(states[0]).toContain('wss://');
  });
});
