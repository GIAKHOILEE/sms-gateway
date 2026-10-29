import React, { useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { PermissionRequestOutcome } from '../native/SmsSenderNative';
import {
  GatewayConnectionState,
  LedgerEntryItem,
  SmsMessageInspection,
  SmsPermissionStatus,
} from '../types/sms.types';

interface ConnectScreenProps {
  connectionState: GatewayConnectionState;
  statusMessage: string;
  activeJobUid: string | null;
  serverUrl: string;
  deviceId: string;
  hasDeviceSecret: boolean;
  permissionStatus: SmsPermissionStatus;
  permissionOutcome: PermissionRequestOutcome | null;
  recentJobs: LedgerEntryItem[];
  testRecipient: string;
  testMessage: string;
  inspection: SmsMessageInspection;
  isSendingTest: boolean;
  onChangeTestRecipient: (val: string) => void;
  onChangeTestMessage: (val: string) => void;
  onToggleConnection: () => void;
  onRequestPermission: () => void;
  onSendTestSms: () => void;
  onNavigateTab: (tab: 'connect' | 'config' | 'history' | 'logs') => void;
}

export function ConnectScreen({
  connectionState,
  statusMessage,
  activeJobUid,
  serverUrl,
  deviceId,
  hasDeviceSecret,
  permissionStatus,
  permissionOutcome,
  recentJobs,
  testRecipient,
  testMessage,
  inspection,
  isSendingTest,
  onChangeTestRecipient,
  onChangeTestMessage,
  onToggleConnection,
  onRequestPermission,
  onSendTestSms,
  onNavigateTab,
}: ConnectScreenProps): React.JSX.Element {
  const [showTestForm, setShowTestForm] = useState<boolean>(false);

  const isConnected = connectionState === 'CONNECTED';
  const isConnectingOrReconnecting =
    connectionState === 'CONNECTING' ||
    connectionState === 'AUTHENTICATING' ||
    connectionState === 'RECONNECTING';

  const submittedCount = recentJobs.filter(j => j.state === 'SUBMITTED').length;
  const processingCount = recentJobs.filter(j => j.state === 'ACCEPTED').length;
  const failedOrUnknownCount = recentJobs.filter(
    j => j.state === 'FAILED' || j.state === 'UNKNOWN',
  ).length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled">
      {/* Hero Connection Card */}
      <View
        style={[
          styles.heroCard,
          isConnected
            ? styles.heroCardOnline
            : isConnectingOrReconnecting
            ? styles.heroCardConnecting
            : styles.heroCardOffline,
        ]}>
        <View style={styles.statusOrbWrapper}>
          <View
            style={[
              styles.statusOrbOuter,
              isConnected
                ? styles.orbOuterOnline
                : isConnectingOrReconnecting
                ? styles.orbOuterConnecting
                : styles.orbOuterOffline,
            ]}>
            <View
              style={[
                styles.statusOrbInner,
                isConnected
                  ? styles.orbInnerOnline
                  : isConnectingOrReconnecting
                  ? styles.orbInnerConnecting
                  : styles.orbInnerOffline,
              ]}>
              <Text style={styles.orbIcon}>
                {isConnected ? '✓' : isConnectingOrReconnecting ? '↻' : '⏻'}
              </Text>
            </View>
          </View>
        </View>

        <Text style={styles.heroStateLabel}>
          {isConnected
            ? 'TRẠM ĐANG HOẠT ĐỘNG'
            : isConnectingOrReconnecting
            ? 'ĐANG KẾT NỐI TỚI MÁY CHỦ...'
            : 'TRẠM ĐANG NGOẠI TUYẾN'}
        </Text>

        <Text style={styles.heroStatusMessage}>{statusMessage}</Text>

        {activeJobUid ? (
          <View style={styles.activeJobPill}>
            <ActivityIndicator size="small" color="#38bdf8" />
            <Text style={styles.activeJobText}>
              Đang gửi tin nhắn mã: {activeJobUid.slice(0, 12)}...
            </Text>
          </View>
        ) : (
          <Text style={styles.heroSubtext}>
            Chỉ hoạt động khi mở ứng dụng và bấm Kết nối (Không chạy ngầm)
          </Text>
        )}

        <TouchableOpacity
          style={[
            styles.connectButton,
            isConnected || isConnectingOrReconnecting
              ? styles.disconnectButtonBg
              : styles.connectButtonBg,
          ]}
          activeOpacity={0.85}
          onPress={onToggleConnection}>
          <Text style={styles.connectButtonText}>
            {isConnected || isConnectingOrReconnecting
              ? 'Ngắt kết nối'
              : 'Khởi động Kết nối'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Quick Stats Row */}
      <View style={styles.statsRow}>
        <TouchableOpacity
          style={styles.statCard}
          onPress={() => onNavigateTab('history')}>
          <Text style={[styles.statValue, styles.textSuccess]}>
            {submittedCount}
          </Text>
          <Text style={styles.statLabel}>Đã gửi</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.statCard}
          onPress={() => onNavigateTab('history')}>
          <Text style={[styles.statValue, styles.textWarn]}>
            {processingCount + (activeJobUid ? 1 : 0)}
          </Text>
          <Text style={styles.statLabel}>Đang xử lý</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.statCard}
          onPress={() => onNavigateTab('history')}>
          <Text style={[styles.statValue, styles.textDanger]}>
            {failedOrUnknownCount}
          </Text>
          <Text style={styles.statLabel}>Lỗi / Chưa rõ</Text>
        </TouchableOpacity>
      </View>

      {/* Readiness Checklist Card */}
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>Kiểm tra Thiết bị</Text>
          <TouchableOpacity onPress={() => onNavigateTab('config')}>
            <Text style={styles.linkText}>Cấu hình →</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.checkItem}>
          <View style={styles.checkLeft}>
            <View
              style={[
                styles.dot,
                permissionStatus.granted ? styles.dotSuccess : styles.dotDanger,
              ]}
            />
            <Text style={styles.checkLabel}>Quyền gửi tin nhắn SMS</Text>
          </View>
          <Text
            style={[
              styles.checkValue,
              permissionStatus.granted ? styles.textSuccess : styles.textDanger,
            ]}>
            {permissionStatus.granted ? 'Đã cấp quyền' : 'Chưa cấp quyền'}
          </Text>
        </View>

        <View style={styles.checkItem}>
          <View style={styles.checkLeft}>
            <View
              style={[
                styles.dot,
                permissionStatus.hasValidSubscription
                  ? styles.dotSuccess
                  : styles.dotWarn,
              ]}
            />
            <Text style={styles.checkLabel}>Thẻ SIM vật lý mặc định</Text>
          </View>
          <Text
            style={[
              styles.checkValue,
              permissionStatus.hasValidSubscription
                ? styles.textSuccess
                : styles.textWarn,
            ]}>
            {permissionStatus.hasValidSubscription
              ? `Sẵn sàng (SIM #${permissionStatus.defaultSmsSubId})`
              : 'Chưa nhận diện SIM'}
          </Text>
        </View>

        <View style={styles.checkItem}>
          <View style={styles.checkLeft}>
            <View
              style={[
                styles.dot,
                hasDeviceSecret ? styles.dotSuccess : styles.dotWarn,
              ]}
            />
            <Text style={styles.checkLabel}>Thiết bị ({deviceId})</Text>
          </View>
          <Text
            style={[
              styles.checkValue,
              hasDeviceSecret ? styles.textSuccess : styles.textWarn,
            ]}>
            {hasDeviceSecret ? 'Đã có khóa bí mật' : 'Chưa nhập khóa bí mật'}
          </Text>
        </View>

        <View style={styles.serverUrlBox}>
          <Text style={styles.serverUrlLabel}>Máy chủ:</Text>
          <Text style={styles.serverUrlValue} numberOfLines={1}>
            {serverUrl}
          </Text>
        </View>

        {!permissionStatus.granted && (
          <View style={styles.permissionActions}>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={onRequestPermission}>
              <Text style={styles.secondaryBtnText}>
                Cấp quyền gửi SMS ngay
              </Text>
            </TouchableOpacity>
            {permissionOutcome === 'NEVER_ASK_AGAIN' && (
              <TouchableOpacity
                style={styles.outlineBtn}
                onPress={() => Linking.openSettings()}>
                <Text style={styles.outlineBtnText}>Mở Cài đặt Ứng dụng</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* Collapsible Test SMS Card */}
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.rowBetween}
          activeOpacity={0.75}
          onPress={() => setShowTestForm(prev => !prev)}>
          <View>
            <Text style={styles.cardTitle}>Gửi Tin nhắn Thử nghiệm</Text>
            <Text style={styles.cardSubtitle}>
              Kiểm tra gửi SMS trực tiếp qua SIM trên điện thoại
            </Text>
          </View>
          <Text style={styles.expandIcon}>{showTestForm ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {showTestForm && (
          <View style={styles.testFormBody}>
            <Text style={styles.inputLabel}>Số điện thoại người nhận</Text>
            <TextInput
              style={styles.input}
              placeholder="VD: 0901234567 hoặc +84901234567"
              placeholderTextColor="#64748b"
              keyboardType="phone-pad"
              value={testRecipient}
              onChangeText={onChangeTestRecipient}
            />
            {testRecipient.length > 0 && !inspection.isValidRecipient && (
              <Text style={styles.helperError}>
                Số điện thoại chưa đúng định dạng (3–15 chữ số).
              </Text>
            )}

            <View style={styles.rowBetween}>
              <Text style={styles.inputLabel}>Nội dung tin nhắn</Text>
              <Text style={styles.counterText}>
                {inspection.charCount} ký tự • {inspection.partsCount} phần SMS
              </Text>
            </View>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Nhập nội dung SMS..."
              placeholderTextColor="#64748b"
              multiline
              numberOfLines={3}
              value={testMessage}
              onChangeText={onChangeTestMessage}
            />
            {inspection.exceedsMaxLength && (
              <Text style={styles.helperError}>
                Tin nhắn vượt quá giới hạn an toàn (tối đa 10 phần / 1500 ký tự).
              </Text>
            )}

            <TouchableOpacity
              style={[styles.testSendBtn, isSendingTest && styles.disabledBtn]}
              disabled={isSendingTest}
              onPress={onSendTestSms}>
              {isSendingTest ? (
                <View style={styles.rowCenter}>
                  <ActivityIndicator color="#ffffff" size="small" />
                  <Text style={[styles.testSendBtnText, styles.ml8]}>
                    Đang gửi qua SIM...
                  </Text>
                </View>
              ) : (
                <Text style={styles.testSendBtnText}>Gửi SMS Thử nghiệm</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 28,
  },
  heroCard: {
    borderRadius: 20,
    padding: 22,
    marginBottom: 14,
    alignItems: 'center',
    borderWidth: 1.5,
  },
  heroCardOnline: {
    backgroundColor: '#042f2e',
    borderColor: '#10b981',
  },
  heroCardConnecting: {
    backgroundColor: '#2e1065',
    borderColor: '#f59e0b',
  },
  heroCardOffline: {
    backgroundColor: '#1e293b',
    borderColor: '#334155',
  },
  statusOrbWrapper: {
    marginBottom: 14,
  },
  statusOrbOuter: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  orbOuterOnline: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10b981',
  },
  orbOuterConnecting: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderColor: '#f59e0b',
  },
  orbOuterOffline: {
    backgroundColor: 'rgba(100, 116, 139, 0.15)',
    borderColor: '#475569',
  },
  statusOrbInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbInnerOnline: {
    backgroundColor: '#10b981',
  },
  orbInnerConnecting: {
    backgroundColor: '#f59e0b',
  },
  orbInnerOffline: {
    backgroundColor: '#334155',
  },
  orbIcon: {
    fontSize: 28,
    fontWeight: '800',
    color: '#ffffff',
  },
  heroStateLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    color: '#cbd5e1',
    marginBottom: 6,
  },
  heroStatusMessage: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f8fafc',
    textAlign: 'center',
    marginBottom: 8,
  },
  heroSubtext: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 18,
  },
  activeJobPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderColor: '#0284c7',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 18,
  },
  activeJobText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#38bdf8',
    marginLeft: 8,
  },
  connectButton: {
    width: '100%',
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectButtonBg: {
    backgroundColor: '#2563eb',
  },
  disconnectButtonBg: {
    backgroundColor: '#dc2626',
  },
  connectButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f8fafc',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  expandIcon: {
    fontSize: 14,
    color: '#38bdf8',
    fontWeight: '700',
    paddingLeft: 8,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#38bdf8',
  },
  checkItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#0f172a',
  },
  checkLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  dotSuccess: {
    backgroundColor: '#10b981',
  },
  dotWarn: {
    backgroundColor: '#f59e0b',
  },
  dotDanger: {
    backgroundColor: '#ef4444',
  },
  checkLabel: {
    fontSize: 13,
    color: '#cbd5e1',
  },
  checkValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  serverUrlBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    marginTop: 12,
  },
  serverUrlLabel: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
    marginRight: 6,
  },
  serverUrlValue: {
    flex: 1,
    fontSize: 12,
    color: '#94a3b8',
    fontFamily: 'monospace',
  },
  permissionActions: {
    marginTop: 12,
    gap: 8,
  },
  secondaryBtn: {
    backgroundColor: '#334155',
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#f8fafc',
    fontWeight: '600',
    fontSize: 13,
  },
  outlineBtn: {
    borderWidth: 1,
    borderColor: '#475569',
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
  },
  outlineBtnText: {
    color: '#cbd5e1',
    fontWeight: '600',
    fontSize: 13,
  },
  testFormBody: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  inputLabel: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 8,
    marginBottom: 4,
    fontWeight: '600',
  },
  counterText: {
    fontSize: 12,
    color: '#38bdf8',
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f8fafc',
    fontSize: 14,
  },
  textArea: {
    minHeight: 76,
    textAlignVertical: 'top',
  },
  helperError: {
    color: '#f87171',
    fontSize: 12,
    marginTop: 4,
  },
  testSendBtn: {
    backgroundColor: '#0284c7',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  testSendBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  disabledBtn: {
    opacity: 0.6,
  },
  ml8: {
    marginLeft: 8,
  },
  textSuccess: {
    color: '#34d399',
  },
  textWarn: {
    color: '#fbbf24',
  },
  textDanger: {
    color: '#f87171',
  },
});

