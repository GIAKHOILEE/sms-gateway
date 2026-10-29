import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  PermissionRequestOutcome,
  SmsSenderNative,
} from './src/native/SmsSenderNative';
import { ConfigScreen } from './src/screens/ConfigScreen';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { LogsScreen } from './src/screens/LogsScreen';
import { GatewaySocketClient } from './src/services/GatewaySocketClient';
import {
  GatewayConnectionState,
  GatewayLogEntry,
  LedgerEntryItem,
  SmsMessageInspection,
  SmsPermissionStatus,
} from './src/types/sms.types';

export type AppTabKey = 'connect' | 'config' | 'history' | 'logs';

function formatTime(dateOrMs: Date | number): string {
  const d = typeof dateOrMs === 'number' ? new Date(dateOrMs) : dateOrMs;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function getConnectionBadgeLabel(state: GatewayConnectionState): string {
  switch (state) {
    case 'CONNECTED':
      return 'ĐÃ KẾT NỐI';
    case 'CONNECTING':
      return 'ĐANG KẾT NỐI';
    case 'AUTHENTICATING':
      return 'ĐANG XÁC THỰC';
    case 'RECONNECTING':
      return 'KẾT NỐI LẠI';
    case 'DISCONNECTED':
    default:
      return 'NGOẠI TUYẾN';
  }
}

interface DispatchedJobPayload {
  jobUid: string;
  lockToken?: string | null;
  recipient: string;
  message: string;
  priority?: number;
  createdAt?: string;
}

function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<AppTabKey>('connect');

  // Device config state
  const [serverUrl, setServerUrl] = useState<string>(
    __DEV__
      ? 'ws://192.168.1.8:5000/ws/sms-gateway'
      : 'wss://example.com/ws/sms-gateway',
  );
  const [deviceId, setDeviceId] = useState<string>('android-sim-01');
  const [deviceSecret, setDeviceSecret] = useState<string>('');
  const [configSaved, setConfigSaved] = useState<boolean>(false);

  // Gateway connection state
  const [connectionState, setConnectionState] =
    useState<GatewayConnectionState>('DISCONNECTED');
  const [statusMessage, setStatusMessage] = useState<string>(
    'Chưa kết nối. Trạm SMS đang ngoại tuyến.',
  );
  const [activeJobUid, setActiveJobUid] = useState<string | null>(null);
  const socketClientRef = useRef<GatewaySocketClient | null>(null);
  const processingJobsSetRef = useRef<Set<string>>(new Set());

  // Permission & SIM state
  const [permissionStatus, setPermissionStatus] = useState<SmsPermissionStatus>(
    {
      granted: false,
      defaultSmsSubId: -1,
      hasValidSubscription: false,
    },
  );
  const [permissionOutcome, setPermissionOutcome] =
    useState<PermissionRequestOutcome | null>(null);

  // Test SMS state
  const [testRecipient, setTestRecipient] = useState<string>('');
  const [testMessage, setTestMessage] = useState<string>(
    'Tin nhắn thử nghiệm từ Trạm SMS Cá Nhân',
  );
  const [inspection, setInspection] = useState<SmsMessageInspection>({
    isValidRecipient: false,
    normalizedRecipient: '',
    charCount: 0,
    partsCount: 1,
    exceedsMaxLength: false,
  });
  const [isSendingTest, setIsSendingTest] = useState<boolean>(false);

  // Ledger jobs & logs
  const [recentJobs, setRecentJobs] = useState<LedgerEntryItem[]>([]);
  const [logs, setLogs] = useState<GatewayLogEntry[]>([]);

  const appendLog = useCallback(
    (level: GatewayLogEntry['level'], message: string) => {
      setLogs(prev => [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: formatTime(new Date()),
          level,
          message,
        },
        ...prev.slice(0, 149),
      ]);
    },
    [],
  );

  const refreshPermissionAndLedger = useCallback(async () => {
    try {
      const perm = await SmsSenderNative.checkPermissionAndSim();
      setPermissionStatus(perm);
      const entries = await SmsSenderNative.getRecentLedgerEntries(50);
      setRecentJobs(entries);
    } catch (err: any) {
      appendLog(
        'ERROR',
        `Lỗi kiểm tra trạng thái Native: ${err?.message || String(err)}`,
      );
    }
  }, [appendLog]);

  const handleDispatchedJob = useCallback(
    async (payload: DispatchedJobPayload) => {
      const jobUid = (payload?.jobUid || '').trim();
      const recipient = (payload?.recipient || '').trim();
      const message = payload?.message || '';
      const lockToken = payload?.lockToken ?? null;

      if (!jobUid || !recipient) {
        appendLog('ERROR', 'Nhận được job:dispatch thiếu jobUid hoặc recipient.');
        return;
      }

      if (processingJobsSetRef.current.has(jobUid)) {
        appendLog(
          'WARN',
          `[${jobUid}] Job đang được xử lý trên thiết bị, bỏ qua lệnh trùng.`,
        );
        return;
      }

      processingJobsSetRef.current.add(jobUid);
      setActiveJobUid(jobUid);

      try {
        // 1. Check durable ledger first
        const existing = await SmsSenderNative.getJobLedgerEntry(jobUid);
        if (
          existing &&
          (existing.state === 'SUBMITTED' ||
            existing.state === 'FAILED' ||
            existing.state === 'UNKNOWN')
        ) {
          appendLog(
            'WARN',
            `[${jobUid}] Job đã có kết quả trong sổ cái (${existing.state}). Gửi lại báo cáo mà không gửi trùng SMS.`,
          );
          socketClientRef.current?.sendEvent('job:result', {
            jobUid: existing.jobUid,
            lockToken: existing.lockToken ?? lockToken,
            status: existing.state,
            partsTotal: existing.partsTotal,
            partsSent: existing.partsSent,
            partsFailed: existing.partsFailed,
            errorCode: existing.errorCode,
            errorMessage: existing.errorMessage,
            partResultsJson: existing.partResultsJson,
            timestamp: existing.updatedAt,
          });
          return;
        }

        // 2. Record ACCEPTED synchronously in Kotlin ledger & send job:accepted ACK
        await SmsSenderNative.recordJobAccepted(
          jobUid,
          lockToken,
          recipient,
          message,
        );
        socketClientRef.current?.sendEvent('job:accepted', {
          jobUid,
          lockToken,
          timestamp: Date.now(),
        });

        appendLog(
          'INFO',
          `[${jobUid}] Đã nhận job từ Server -> Gửi tới ${recipient}...`,
        );
        await refreshPermissionAndLedger();

        // 3. Execute SmsManager via Kotlin Native Module
        const result = await SmsSenderNative.sendSms({
          jobUid,
          lockToken,
          recipient,
          message,
          isTestSms: false,
        });

        if (result.status === 'SUBMITTED') {
          appendLog(
            'SUCCESS',
            `[${jobUid}] Đã gửi SMS thành công tới ${recipient} (${result.partsSent}/${result.partsTotal} phần) -> SUBMITTED`,
          );
        } else if (result.status === 'UNKNOWN') {
          appendLog(
            'WARN',
            `[${jobUid}] Kết quả gửi SMS không chắc chắn (UNKNOWN): ${result.errorCode} - ${result.errorMessage}`,
          );
        } else {
          appendLog(
            'ERROR',
            `[${jobUid}] Gửi SMS thất bại (FAILED): ${result.errorCode} - ${result.errorMessage}`,
          );
        }

        // 4. Report result to NestJS backend
        const sentToServer = socketClientRef.current?.sendEvent('job:result', {
          jobUid: result.jobUid,
          lockToken: result.lockToken ?? lockToken,
          status: result.status,
          partsTotal: result.partsTotal,
          partsSent: result.partsSent,
          partsFailed: result.partsFailed,
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
          partResultsJson: result.partResultsJson,
          timestamp: result.timestamp,
        });

        if (!sentToServer) {
          appendLog(
            'WARN',
            `[${jobUid}] Chưa gửi được job:result do mất kết nối tạm thời; kết quả đã lưu trong sổ cái để đồng bộ khi kết nối lại.`,
          );
        }

        await refreshPermissionAndLedger();
      } catch (err: any) {
        appendLog(
          'ERROR',
          `[${jobUid}] Lỗi xử lý job: ${err?.message || String(err)}`,
        );
      } finally {
        processingJobsSetRef.current.delete(jobUid);
        setActiveJobUid(null);
      }
    },
    [appendLog, refreshPermissionAndLedger],
  );

  // Initialize GatewaySocketClient & Native listeners
  useEffect(() => {
    let mounted = true;

    const client = new GatewaySocketClient({
      serverUrl: __DEV__
        ? 'ws://192.168.1.8:5000/ws/sms-gateway'
        : 'wss://example.com/ws/sms-gateway',
      deviceId: 'android-sim-01',
      deviceSecret: '',
      appVersion: '1.0.0',
      onStateChange: (nextState, nextMsg) => {
        if (mounted) {
          setConnectionState(nextState);
          setStatusMessage(nextMsg);
        }
      },
      onLog: (level, msg) => {
        if (mounted) {
          appendLog(level, msg);
        }
      },
      onServerEvent: (event, data) => {
        if (!mounted) {
          return;
        }
        if (event === 'job:dispatch') {
          handleDispatchedJob(data as DispatchedJobPayload);
        } else if (event === 'job:result:ack' && data?.jobUid) {
          SmsSenderNative.markLedgerEntrySynced(String(data.jobUid))
            .then(() => refreshPermissionAndLedger())
            .catch(() => {});
        }
      },
    });
    socketClientRef.current = client;

    (async () => {
      try {
        const cfg = await SmsSenderNative.loadDeviceConfig();
        if (mounted) {
          if (cfg.serverUrl) {
            setServerUrl(cfg.serverUrl);
          }
          if (cfg.deviceId) {
            setDeviceId(cfg.deviceId);
          }
          if (cfg.deviceSecret) {
            setDeviceSecret(cfg.deviceSecret);
          }
          client.updateOptions({
            serverUrl:
              cfg.serverUrl ||
              (__DEV__
                ? 'ws://192.168.1.8:5000/ws/sms-gateway'
                : 'wss://example.com/ws/sms-gateway'),
            deviceId: cfg.deviceId || 'android-sim-01',
            deviceSecret: cfg.deviceSecret || '',
          });
        }
      } catch (err: any) {
        appendLog('WARN', `Không tải được cấu hình: ${err?.message}`);
      }
      await refreshPermissionAndLedger();
      appendLog('INFO', 'Ứng dụng đã mở ở chế độ thủ công (Foreground only).');
    })();

    const partSub = SmsSenderNative.onSmsPartSent(evt => {
      if (evt.success) {
        appendLog(
          'INFO',
          `[${evt.jobUid}] Phần ${evt.partIndex + 1}/${evt.partsTotal}: Đã gửi lên nhà mạng (RESULT_OK)`,
        );
      } else {
        appendLog(
          'ERROR',
          `[${evt.jobUid}] Phần ${evt.partIndex + 1}/${evt.partsTotal} lỗi: ${evt.errorCode} (radio=${evt.radioErrorCode})`,
        );
      }
    });

    const delivSub = SmsSenderNative.onSmsDelivered(evt => {
      appendLog(
        'SUCCESS',
        `[${evt.jobUid}] Báo cáo nhận tin (SMS_DELIVERED): phần ${evt.partIndex + 1}/${evt.partsTotal} (${evt.partsDelivered}/${evt.partsTotal})`,
      );
      socketClientRef.current?.sendEvent('job:delivery_report', {
        jobUid: evt.jobUid,
        partIndex: evt.partIndex,
        partsTotal: evt.partsTotal,
        partsDelivered: evt.partsDelivered,
        delivered: evt.delivered,
        timestamp: evt.timestamp,
      });
      refreshPermissionAndLedger();
    });

    const netSub = SmsSenderNative.onNetworkChanged(evt => {
      socketClientRef.current?.handleNetworkChange(
        evt.isConnected,
        evt.transport,
      );
    });

    return () => {
      mounted = false;
      partSub?.remove();
      delivSub?.remove();
      netSub?.remove();
      socketClientRef.current?.disconnect('APP_CLOSED');
      SmsSenderNative.setNetworkMonitoringEnabled(false).catch(() => {});
      SmsSenderNative.setKeepScreenOn(false).catch(() => {});
    };
  }, [appendLog, handleDispatchedJob, refreshPermissionAndLedger]);

  // Live message inspection (parts & recipient validation)
  useEffect(() => {
    let active = true;
    SmsSenderNative.inspectMessage(testRecipient, testMessage)
      .then(res => {
        if (active) {
          setInspection(res);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [testRecipient, testMessage]);

  const handleRequestPermission = async () => {
    try {
      const outcome = await SmsSenderNative.requestSendSmsPermission();
      setPermissionOutcome(outcome);
      await refreshPermissionAndLedger();
      if (outcome === 'GRANTED') {
        appendLog('SUCCESS', 'Đã cấp quyền SEND_SMS thành công.');
      } else if (outcome === 'NEVER_ASK_AGAIN') {
        appendLog(
          'WARN',
          'Quyền SEND_SMS bị từ chối vĩnh viễn. Vui lòng mở Cài đặt ứng dụng để cấp quyền.',
        );
      } else {
        appendLog('WARN', 'Người dùng đã từ chối quyền SEND_SMS.');
      }
    } catch (err: any) {
      appendLog('ERROR', `Lỗi xin quyền SEND_SMS: ${err?.message}`);
    }
  };

  const handleSaveConfig = async () => {
    try {
      const trimmedUrl = serverUrl.trim();
      const trimmedId = deviceId.trim();
      const trimmedSecret = deviceSecret.trim();

      await SmsSenderNative.saveDeviceConfig({
        serverUrl: trimmedUrl,
        deviceId: trimmedId,
        deviceSecret: trimmedSecret,
      });
      socketClientRef.current?.updateOptions({
        serverUrl: trimmedUrl,
        deviceId: trimmedId,
        deviceSecret: trimmedSecret,
      });
      setConfigSaved(true);
      appendLog(
        'SUCCESS',
        `Đã lưu cấu hình thiết bị (${trimmedId}) vào bộ nhớ mã hóa Keystore.`,
      );
      setTimeout(() => setConfigSaved(false), 2500);
    } catch (err: any) {
      appendLog('ERROR', `Lỗi lưu cấu hình: ${err?.message}`);
    }
  };

  const handleToggleConnection = async () => {
    const client = socketClientRef.current;
    if (!client) {
      return;
    }

    if (client.isUserActive() || connectionState !== 'DISCONNECTED') {
      client.disconnect('USER_DISCONNECT');
      await SmsSenderNative.setNetworkMonitoringEnabled(false).catch(() => {});
      await SmsSenderNative.setKeepScreenOn(false).catch(() => {});
      return;
    }

    // Check SEND_SMS permission before starting Gateway
    let perm = await SmsSenderNative.checkPermissionAndSim();
    setPermissionStatus(perm);
    if (!perm.granted) {
      appendLog('WARN', 'Chưa có quyền SEND_SMS. Đang yêu cầu cấp quyền...');
      const outcome = await SmsSenderNative.requestSendSmsPermission();
      setPermissionOutcome(outcome);
      perm = await SmsSenderNative.checkPermissionAndSim();
      setPermissionStatus(perm);
      if (!perm.granted) {
        appendLog(
          'ERROR',
          'Cần cấp quyền SEND_SMS trước khi kết nối SMS Gateway.',
        );
        return;
      }
    }

    const trimmedUrl = serverUrl.trim();
    const trimmedId = deviceId.trim();
    const trimmedSecret = deviceSecret.trim();

    await SmsSenderNative.saveDeviceConfig({
      serverUrl: trimmedUrl,
      deviceId: trimmedId,
      deviceSecret: trimmedSecret,
    }).catch(() => {});

    client.updateOptions({
      serverUrl: trimmedUrl,
      deviceId: trimmedId,
      deviceSecret: trimmedSecret,
      defaultSmsSubId: perm.defaultSmsSubId,
    });

    await SmsSenderNative.setKeepScreenOn(true).catch(() => {});
    await SmsSenderNative.setNetworkMonitoringEnabled(true).catch(() => {});
    const net = await SmsSenderNative.getNetworkStatus().catch(() => null);
    if (net) {
      client.handleNetworkChange(net.isConnected, net.transport);
    }
    client.connect();
  };

  const handleSendTestSms = async () => {
    if (isSendingTest) {
      return;
    }
    const perm = await SmsSenderNative.checkPermissionAndSim();
    setPermissionStatus(perm);
    if (!perm.granted) {
      appendLog('WARN', 'Chưa có quyền SEND_SMS. Đang yêu cầu cấp quyền...');
      const outcome = await SmsSenderNative.requestSendSmsPermission();
      setPermissionOutcome(outcome);
      const afterPerm = await SmsSenderNative.checkPermissionAndSim();
      setPermissionStatus(afterPerm);
      if (!afterPerm.granted) {
        appendLog('ERROR', 'Không thể gửi SMS vì chưa được cấp quyền SEND_SMS.');
        return;
      }
    }

    setIsSendingTest(true);
    appendLog(
      'INFO',
      `Đang gửi SMS thử nghiệm tới ${testRecipient.trim()} (${inspection.partsCount} phần)...`,
    );

    try {
      const result = await SmsSenderNative.sendSms({
        recipient: testRecipient.trim(),
        message: testMessage,
        isTestSms: true,
      });

      if (result.status === 'SUBMITTED') {
        appendLog(
          'SUCCESS',
          `[${result.jobUid}] Gửi thành công tới nhà mạng (${result.partsSent}/${result.partsTotal} phần) -> SUBMITTED`,
        );
      } else if (result.status === 'UNKNOWN') {
        appendLog(
          'WARN',
          `[${result.jobUid}] Trạng thái không chắc chắn (UNKNOWN): ${result.errorCode} - ${result.errorMessage}`,
        );
      } else {
        appendLog(
          'ERROR',
          `[${result.jobUid}] Gửi thất bại (FAILED): ${result.errorCode} - ${result.errorMessage}`,
        );
      }
      await refreshPermissionAndLedger();
    } catch (err: any) {
      appendLog('ERROR', `Ngoại lệ khi gửi SMS: ${err?.message || String(err)}`);
    } finally {
      setIsSendingTest(false);
    }
  };

  const isConnected = connectionState === 'CONNECTED';
  const isConnectingOrReconnecting =
    connectionState === 'CONNECTING' ||
    connectionState === 'AUTHENTICATING' ||
    connectionState === 'RECONNECTING';

  const errorLogCount = logs.filter(l => l.level === 'ERROR').length;

  return (
    <View style={styles.safeArea}>
      <StatusBar barStyle="light-content" />

      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerBrandRow}>
          <Image
            source={require('./src/assets/app_logo.png')}
            style={styles.headerLogo}
          />
          <View>
            <Text style={styles.headerTitle}>Trạm Gửi SMS Cá Nhân</Text>
            <Text style={styles.headerSubtitle}>
              Thiết bị: {deviceId || 'Chưa đặt tên'}
            </Text>
          </View>
        </View>
        <View
          style={[
            styles.statusBadge,
            isConnected
              ? styles.badgeOnline
              : isConnectingOrReconnecting
              ? styles.badgeConnecting
              : styles.badgeOffline,
          ]}>
          <View
            style={[
              styles.statusDot,
              isConnected
                ? styles.dotOnline
                : isConnectingOrReconnecting
                ? styles.dotConnecting
                : styles.dotOffline,
            ]}
          />
          <Text style={styles.statusBadgeText}>
            {getConnectionBadgeLabel(connectionState)}
          </Text>
        </View>
      </View>

      {/* Active Screen Content */}
      <View style={styles.screenWrapper}>
        {activeTab === 'connect' && (
          <ConnectScreen
            connectionState={connectionState}
            statusMessage={statusMessage}
            activeJobUid={activeJobUid}
            serverUrl={serverUrl}
            deviceId={deviceId}
            hasDeviceSecret={Boolean(deviceSecret.trim())}
            permissionStatus={permissionStatus}
            permissionOutcome={permissionOutcome}
            recentJobs={recentJobs}
            testRecipient={testRecipient}
            testMessage={testMessage}
            inspection={inspection}
            isSendingTest={isSendingTest}
            onChangeTestRecipient={setTestRecipient}
            onChangeTestMessage={setTestMessage}
            onToggleConnection={handleToggleConnection}
            onRequestPermission={handleRequestPermission}
            onSendTestSms={handleSendTestSms}
            onNavigateTab={setActiveTab}
          />
        )}

        {activeTab === 'config' && (
          <ConfigScreen
            serverUrl={serverUrl}
            deviceId={deviceId}
            deviceSecret={deviceSecret}
            configSaved={configSaved}
            permissionStatus={permissionStatus}
            permissionOutcome={permissionOutcome}
            onChangeServerUrl={setServerUrl}
            onChangeDeviceId={setDeviceId}
            onChangeDeviceSecret={setDeviceSecret}
            onSaveConfig={handleSaveConfig}
            onRequestPermission={handleRequestPermission}
            onRefreshPermission={refreshPermissionAndLedger}
          />
        )}

        {activeTab === 'history' && (
          <HistoryScreen
            recentJobs={recentJobs}
            onRefresh={refreshPermissionAndLedger}
          />
        )}

        {activeTab === 'logs' && (
          <LogsScreen logs={logs} onClearLogs={() => setLogs([])} />
        )}
      </View>

      {/* Bottom Tab Navigation */}
      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={[
            styles.navTab,
            activeTab === 'connect' && styles.navTabActive,
          ]}
          onPress={() => setActiveTab('connect')}>
          <Text
            style={[
              styles.navIcon,
              activeTab === 'connect' && styles.navTextActive,
            ]}>
            ⚡
          </Text>
          <Text
            style={[
              styles.navLabel,
              activeTab === 'connect' && styles.navTextActive,
            ]}>
            Kết nối
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navTab, activeTab === 'config' && styles.navTabActive]}
          onPress={() => setActiveTab('config')}>
          <Text
            style={[
              styles.navIcon,
              activeTab === 'config' && styles.navTextActive,
            ]}>
            ⚙️
          </Text>
          <Text
            style={[
              styles.navLabel,
              activeTab === 'config' && styles.navTextActive,
            ]}>
            Cấu hình
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.navTab,
            activeTab === 'history' && styles.navTabActive,
          ]}
          onPress={() => setActiveTab('history')}>
          <View style={styles.navIconWrap}>
            <Text
              style={[
                styles.navIcon,
                activeTab === 'history' && styles.navTextActive,
              ]}>
              📋
            </Text>
            {recentJobs.length > 0 && (
              <View style={styles.navBadge}>
                <Text style={styles.navBadgeText}>
                  {recentJobs.length > 99 ? '99+' : recentJobs.length}
                </Text>
              </View>
            )}
          </View>
          <Text
            style={[
              styles.navLabel,
              activeTab === 'history' && styles.navTextActive,
            ]}>
            Lịch sử
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navTab, activeTab === 'logs' && styles.navTabActive]}
          onPress={() => setActiveTab('logs')}>
          <View style={styles.navIconWrap}>
            <Text
              style={[
                styles.navIcon,
                activeTab === 'logs' && styles.navTextActive,
              ]}>
              🖥️
            </Text>
            {errorLogCount > 0 && (
              <View style={[styles.navBadge, styles.navBadgeError]}>
                <Text style={styles.navBadgeText}>
                  {errorLogCount > 99 ? '99+' : errorLogCount}
                </Text>
              </View>
            )}
          </View>
          <Text
            style={[
              styles.navLabel,
              activeTab === 'logs' && styles.navTextActive,
            ]}>
            Nhật ký
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  headerBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerLogo: {
    width: 36,
    height: 36,
    borderRadius: 9,
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#f8fafc',
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  badgeOnline: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderWidth: 1,
    borderColor: '#10b981',
  },
  badgeConnecting: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    borderWidth: 1,
    borderColor: '#f59e0b',
  },
  badgeOffline: {
    backgroundColor: '#334155',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 6,
  },
  dotOnline: {
    backgroundColor: '#34d399',
  },
  dotConnecting: {
    backgroundColor: '#fbbf24',
  },
  dotOffline: {
    backgroundColor: '#94a3b8',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#f8fafc',
  },
  screenWrapper: {
    flex: 1,
  },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  navTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 12,
  },
  navTabActive: {
    backgroundColor: 'rgba(2, 132, 199, 0.16)',
  },
  navIconWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navIcon: {
    fontSize: 18,
    marginBottom: 2,
    opacity: 0.7,
  },
  navLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
  },
  navTextActive: {
    color: '#38bdf8',
    fontWeight: '800',
    opacity: 1,
  },
  navBadge: {
    position: 'absolute',
    top: -4,
    right: -14,
    backgroundColor: '#0284c7',
    borderRadius: 999,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBadgeError: {
    backgroundColor: '#ef4444',
  },
  navBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#ffffff',
  },
});

export default App;
