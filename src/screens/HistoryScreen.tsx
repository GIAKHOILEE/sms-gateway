import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LedgerEntryItem } from '../types/sms.types';

interface HistoryScreenProps {
  recentJobs: LedgerEntryItem[];
  onRefresh: () => void;
}

type HistoryFilter = 'ALL' | 'SUBMITTED' | 'ACCEPTED' | 'FAILED_OR_UNKNOWN';

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${dd}/${mo} ${hh}:${mm}:${ss}`;
}

export function HistoryScreen({
  recentJobs,
  onRefresh,
}: HistoryScreenProps): React.JSX.Element {
  const [filter, setFilter] = useState<HistoryFilter>('ALL');

  const filteredJobs = useMemo(() => {
    if (filter === 'ALL') {
      return recentJobs;
    }
    if (filter === 'SUBMITTED') {
      return recentJobs.filter(j => j.state === 'SUBMITTED');
    }
    if (filter === 'ACCEPTED') {
      return recentJobs.filter(j => j.state === 'ACCEPTED');
    }
    return recentJobs.filter(
      j => j.state === 'FAILED' || j.state === 'UNKNOWN',
    );
  }, [recentJobs, filter]);

  return (
    <View style={styles.container}>
      {/* Top Action & Filter Bar */}
      <View style={styles.topBar}>
        <View style={styles.rowBetween}>
          <Text style={styles.screenTitle}>
            Lịch sử SMS trên Thiết bị ({filteredJobs.length}/{recentJobs.length})
          </Text>
          <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh}>
            <Text style={styles.refreshBtnText}>↻ Làm mới</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[
              styles.filterChip,
              filter === 'ALL' && styles.filterChipActive,
            ]}
            onPress={() => setFilter('ALL')}>
            <Text
              style={[
                styles.filterChipText,
                filter === 'ALL' && styles.filterChipTextActive,
              ]}>
              Tất cả ({recentJobs.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterChip,
              filter === 'SUBMITTED' && styles.filterChipActive,
            ]}
            onPress={() => setFilter('SUBMITTED')}>
            <Text
              style={[
                styles.filterChipText,
                filter === 'SUBMITTED' && styles.filterChipTextActive,
              ]}>
              Đã gửi
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterChip,
              filter === 'ACCEPTED' && styles.filterChipActive,
            ]}
            onPress={() => setFilter('ACCEPTED')}>
            <Text
              style={[
                styles.filterChipText,
                filter === 'ACCEPTED' && styles.filterChipTextActive,
              ]}>
              Đang xử lý
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterChip,
              filter === 'FAILED_OR_UNKNOWN' && styles.filterChipActive,
            ]}
            onPress={() => setFilter('FAILED_OR_UNKNOWN')}>
            <Text
              style={[
                styles.filterChipText,
                filter === 'FAILED_OR_UNKNOWN' && styles.filterChipTextActive,
              ]}>
              Lỗi / Chưa rõ
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.listScroll}
        contentContainerStyle={styles.listContent}>
        {filteredJobs.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Chưa có dữ liệu lịch sử phù hợp</Text>
            <Text style={styles.emptySubtitle}>
              Các tin nhắn gửi từ máy chủ hoặc gửi thử nghiệm trên thiết bị sẽ
              hiển thị tại đây.
            </Text>
          </View>
        ) : (
          filteredJobs.map(job => {
            const isSuccess = job.state === 'SUBMITTED';
            const isFailed = job.state === 'FAILED';
            const stateLabel =
              job.state === 'SUBMITTED'
                ? 'Đã gửi'
                : job.state === 'ACCEPTED'
                ? 'Đang xử lý'
                : job.state === 'FAILED'
                ? 'Thất bại'
                : 'Chưa rõ';

            return (
              <View key={job.jobUid} style={styles.jobCard}>
                <View style={styles.rowBetween}>
                  <Text style={styles.recipientText}>{job.recipient}</Text>
                  <View
                    style={[
                      styles.statusBadge,
                      isSuccess
                        ? styles.badgeSuccess
                        : isFailed
                        ? styles.badgeDanger
                        : styles.badgeWarn,
                    ]}>
                    <Text
                      style={[
                        styles.statusBadgeText,
                        isSuccess
                          ? styles.textSuccess
                          : isFailed
                          ? styles.textDanger
                          : styles.textWarn,
                      ]}>
                      {stateLabel} • {job.partsSent}/{job.partsTotal} phần
                    </Text>
                  </View>
                </View>

                <Text style={styles.messageText}>{job.messagePreview}</Text>

                <View style={styles.metaFooter}>
                  <Text style={styles.metaText}>
                    #{job.jobUid.slice(0, 12)} • {formatDateTime(job.updatedAt)}
                  </Text>
                  <View style={styles.tagsRow}>
                    <View style={styles.sourceTag}>
                      <Text style={styles.sourceTagText}>
                        {job.isTestSms
                          ? 'Gửi thử trên máy'
                          : job.syncedToServer
                          ? 'Đã đồng bộ'
                          : 'Chờ đồng bộ'}
                      </Text>
                    </View>
                    {job.partsDelivered > 0 && (
                      <View style={styles.deliveredTag}>
                        <Text style={styles.deliveredTagText}>
                          Đã nhận {job.partsDelivered}/{job.partsTotal}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                {job.errorMessage ? (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorBoxText}>
                      {job.errorCode || 'LỖI'}: {job.errorMessage}
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          })
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
  refreshBtn: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  refreshBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#38bdf8',
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
  jobCard: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  recipientText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#f8fafc',
  },
  statusBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  badgeSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  badgeWarn: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  badgeDanger: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  messageText: {
    fontSize: 13,
    color: '#cbd5e1',
    marginVertical: 10,
    lineHeight: 19,
    backgroundColor: '#0f172a',
    padding: 10,
    borderRadius: 8,
  },
  metaFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  metaText: {
    fontSize: 11,
    color: '#64748b',
  },
  tagsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  sourceTag: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  sourceTagText: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
  },
  deliveredTag: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  deliveredTagText: {
    fontSize: 11,
    color: '#34d399',
    fontWeight: '700',
  },
  errorBox: {
    marginTop: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  errorBoxText: {
    fontSize: 12,
    color: '#f87171',
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

