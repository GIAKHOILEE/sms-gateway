import React, { useState } from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { PermissionRequestOutcome } from '../native/SmsSenderNative';
import { SmsPermissionStatus } from '../types/sms.types';

interface ConfigScreenProps {
  serverUrl: string;
  deviceId: string;
  deviceSecret: string;
  configSaved: boolean;
  permissionStatus: SmsPermissionStatus;
  permissionOutcome: PermissionRequestOutcome | null;
  onChangeServerUrl: (val: string) => void;
  onChangeDeviceId: (val: string) => void;
  onChangeDeviceSecret: (val: string) => void;
  onSaveConfig: () => void;
  onRequestPermission: () => void;
  onRefreshPermission: () => void;
}

export function ConfigScreen({
  serverUrl,
  deviceId,
  deviceSecret,
  configSaved,
  permissionStatus,
  permissionOutcome,
  onChangeServerUrl,
  onChangeDeviceId,
  onChangeDeviceSecret,
  onSaveConfig,
  onRequestPermission,
  onRefreshPermission,
}: ConfigScreenProps): React.JSX.Element {
  const [showSecret, setShowSecret] = useState<boolean>(false);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled">
      {/* 1. Device & WSS Configuration */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Cấu hình Thiết bị & Máy chủ</Text>
        <Text style={styles.cardDescription}>
          Thông tin xác thực thiết bị với máy chủ hệ thống. Khóa bí mật được mã
          hóa bảo mật trực tiếp trên phần cứng điện thoại.
        </Text>

        <Text style={styles.inputLabel}>Địa chỉ Máy chủ Kết nối (WS / WSS)</Text>
        <TextInput
          style={styles.input}
          placeholder="wss://ten-mien-cua-ban.com/ws/sms-gateway"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          autoCorrect={false}
          value={serverUrl}
          onChangeText={onChangeServerUrl}
        />

        {__DEV__ && (
          <View style={styles.presetRow}>
            <TouchableOpacity
              style={styles.presetChip}
              onPress={() =>
                onChangeServerUrl('ws://127.0.0.1:5000/ws/sms-gateway')
              }>
              <Text style={styles.presetChipText}>Cáp USB (127.0.0.1:5000)</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.presetChip}
              onPress={() =>
                onChangeServerUrl('ws://192.168.1.8:5000/ws/sms-gateway')
              }>
              <Text style={styles.presetChipText}>Mạng LAN (192.168.1.8:5000)</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.inputLabel}>Mã Thiết bị</Text>
        <TextInput
          style={styles.input}
          placeholder="android-sim-01"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          autoCorrect={false}
          value={deviceId}
          onChangeText={onChangeDeviceId}
        />

        <View style={styles.rowBetween}>
          <Text style={styles.inputLabel}>Khóa bí mật của Thiết bị (64 ký tự)</Text>
          <TouchableOpacity onPress={() => setShowSecret(prev => !prev)}>
            <Text style={styles.toggleSecretText}>
              {showSecret ? 'Ẩn khóa' : 'Hiện khóa'}
            </Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={styles.input}
          placeholder="Dán khóa bí mật được cấp khi đăng ký thiết bị..."
          placeholderTextColor="#64748b"
          secureTextEntry={!showSecret}
          autoCapitalize="none"
          autoCorrect={false}
          value={deviceSecret}
          onChangeText={onChangeDeviceSecret}
        />

        <TouchableOpacity
          style={[styles.primaryBtn, configSaved && styles.savedBtnBg]}
          activeOpacity={0.85}
          onPress={onSaveConfig}>
          <Text style={styles.primaryBtnText}>
            {configSaved ? '✓ Đã lưu cấu hình thành công' : 'Lưu cấu hình thiết bị'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 2. SIM & Android Permission Configuration */}
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>Quyền Hệ thống & Thẻ SIM</Text>
          <TouchableOpacity onPress={onRefreshPermission}>
            <Text style={styles.linkText}>Kiểm tra lại</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Quyền gửi tin nhắn SMS:</Text>
          <Text
            style={[
              styles.infoValue,
              permissionStatus.granted ? styles.textSuccess : styles.textDanger,
            ]}>
            {permissionStatus.granted ? 'ĐÃ CẤP QUYỀN' : 'CHƯA CẤP QUYỀN'}
          </Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>SIM gửi SMS mặc định:</Text>
          <Text
            style={[
              styles.infoValue,
              permissionStatus.hasValidSubscription
                ? styles.textSuccess
                : styles.textWarn,
            ]}>
            {permissionStatus.hasValidSubscription
              ? `Sẵn sàng (Mã SIM: ${permissionStatus.defaultSmsSubId})`
              : 'Chưa chọn SIM mặc định / Không có SIM'}
          </Text>
        </View>

        <View style={styles.buttonGroup}>
          {!permissionStatus.granted && (
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={onRequestPermission}>
              <Text style={styles.secondaryBtnText}>Yêu cầu cấp quyền gửi SMS</Text>
            </TouchableOpacity>
          )}

          {(permissionOutcome === 'NEVER_ASK_AGAIN' || !permissionStatus.granted) && (
            <TouchableOpacity
              style={styles.outlineBtn}
              onPress={() => Linking.openSettings()}>
              <Text style={styles.outlineBtnText}>
                Mở Cài đặt Ứng dụng Android
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* 3. Operation Policy Info */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Chính sách Hoạt động</Text>
        <Text style={styles.policyItem}>
          • Ứng dụng chỉ kết nối khi mở trên màn hình và bấm Khởi động Kết nối.
        </Text>
        <Text style={styles.policyItem}>
          • Tự động giữ sáng màn hình khi đang kết nối để đảm bảo nhận tin nhắn
          liên tục.
        </Text>
        <Text style={styles.policyItem}>
          • Tự động kết nối lại thông minh (từ 1 giây đến 60 giây) khi mạng
          Wi-Fi/4G chập chờn.
        </Text>
        <Text style={styles.policyItem}>
          • Lưu trữ lịch sử bền vững trên máy giúp chống gửi trùng tin nhắn SMS.
        </Text>
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
    marginBottom: 6,
  },
  cardDescription: {
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 18,
    marginBottom: 8,
  },
  inputLabel: {
    fontSize: 12,
    color: '#cbd5e1',
    marginTop: 10,
    marginBottom: 5,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: '#f8fafc',
    fontSize: 14,
  },
  presetRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  presetChip: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#0284c7',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  presetChipText: {
    fontSize: 11,
    color: '#38bdf8',
    fontWeight: '600',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleSecretText: {
    fontSize: 12,
    color: '#38bdf8',
    fontWeight: '600',
    marginTop: 10,
  },
  primaryBtn: {
    backgroundColor: '#2563eb',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  savedBtnBg: {
    backgroundColor: '#059669',
  },
  primaryBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  linkText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#38bdf8',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#0f172a',
  },
  infoLabel: {
    fontSize: 13,
    color: '#94a3b8',
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  buttonGroup: {
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
  policyItem: {
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 20,
    marginTop: 4,
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

