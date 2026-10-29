import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { GatewayLogEntry } from '../types/sms.types';

interface LogsScreenProps {
  logs: GatewayLogEntry[];
  onClearLogs: () => void;
}

type LogFilter = 'ALL' | 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';

function getLogLevelLabel(lvl: LogFilter): string {
  switch (lvl) {
    case 'INFO':
      return 'Thông tin';
    case 'SUCCESS':
      return 'Thành công';
    case 'WARN':
      return 'Cảnh báo';
    case 'ERROR':
      return 'Lỗi';
    default:
      return 'Tất cả';
  }
}

export function LogsScreen({
  logs,
  onClearLogs,
}: LogsScreenProps): React.JSX.Element {
  const [filter, setFilter] = useState<LogFilter>('ALL');

  const filteredLogs = useMemo(() => {
    if (filter === 'ALL') {
      return logs;
    }
    return logs.filter(l => l.level === filter);
  }, [logs, filter]);

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <View style={styles.rowBetween}>
          <Text style={styles.screenTitle}>
            Nhật ký Hoạt động ({filteredLogs.length}/{logs.length})
          </Text>
          {logs.length > 0 && (
            <TouchableOpacity style={styles.clearBtn} onPress={onClearLogs}>
              <Text style={styles.clearBtnText}>Xóa nhật ký</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.filterRow}>
          {(['ALL', 'INFO', 'SUCCESS', 'WARN', 'ERROR'] as LogFilter[]).map(
            lvl => (
              <TouchableOpacity
                key={lvl}
                style={[
                  styles.filterChip,
                  filter === lvl && styles.filterChipActive,
                ]}
                onPress={() => setFilter(lvl)}>
                <Text
                  style={[
                    styles.filterChipText,
                    filter === lvl && styles.filterChipTextActive,
                  ]}>
                  {lvl === 'ALL'
                    ? `Tất cả (${logs.length})`
                    : getLogLevelLabel(lvl)}
                </Text>
              </TouchableOpacity>
            ),
          )}
        </View>
      </View>

      <ScrollView
        style={styles.listScroll}
        contentContainerStyle={styles.listContent}>
        {filteredLogs.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Chưa có nhật ký hoạt động</Text>
            <Text style={styles.emptySubtitle}>
              Mọi sự kiện kết nối máy chủ, gửi tin nhắn qua SIM và báo cáo kết
              quả sẽ được ghi lại tại đây.
            </Text>
          </View>
        ) : (
          filteredLogs.map(log => (
            <View key={log.id} style={styles.logItem}>
              <View style={styles.logHeader}>
                <View
                  style={[
                    styles.levelPill,
                    log.level === 'ERROR'
                      ? styles.pillDanger
                      : log.level === 'WARN'
                      ? styles.pillWarn
                      : log.level === 'SUCCESS'
                      ? styles.pillSuccess
                      : styles.pillInfo,
                  ]}>
                  <Text
                    style={[
                      styles.levelPillText,
                      log.level === 'ERROR'
                        ? styles.textDanger
                        : log.level === 'WARN'
                        ? styles.textWarn
                        : log.level === 'SUCCESS'
                        ? styles.textSuccess
                        : styles.textInfo,
                    ]}>
                    {getLogLevelLabel(log.level)}
                  </Text>
                </View>
                <Text style={styles.logTimestamp}>{log.timestamp}</Text>
              </View>
              <Text style={styles.logMessage}>{log.message}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  screenTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f8fafc',
  },
  clearBtn: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  clearBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#f87171',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  filterChip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
  },
  filterChipActive: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
  },
  filterChipText: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  listScroll: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    paddingBottom: 28,
  },
  emptyCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#e2e8f0',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 19,
  },
  logItem: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  levelPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  pillInfo: {
    backgroundColor: 'rgba(56, 189, 248, 0.14)',
  },
  pillSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
  },
  pillWarn: {
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
  },
  pillDanger: {
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
  },
  levelPillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  logTimestamp: {
    fontSize: 11,
    color: '#64748b',
    fontFamily: 'monospace',
  },
  logMessage: {
    fontSize: 13,
    color: '#e2e8f0',
    lineHeight: 19,
  },
  textInfo: {
    color: '#38bdf8',
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

