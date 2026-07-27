import React from 'react';
import { StyleSheet, Text, View, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme-context';
import {
  PlanId,
  PLAN_ORDER,
  PLAN_META,
  LIMITS,
  FLAGS,
  formatLimit,
} from '@/constants/plans';

/**
 * Full plan comparison table (doc §1.2 + Section 6 feature matrix). Rows are
 * grouped by area; each cell is a ✓ / ✗ / value. The user's current plan column
 * is highlighted. Reused by the hard paywall and the standalone compare screen.
 */

type CellValue = string; // "✓" | "✗" | "∞" | "3" | "6 members" | ...

interface Row {
  label: string;
  values: Record<PlanId, CellValue>;
}

interface Group {
  title: string;
  rows: Row[];
}

const YES = '✓';
const NO = '✗';

function limitRow(label: string, key: keyof typeof LIMITS.free, suffix = ''): Row {
  const values = {} as Record<PlanId, CellValue>;
  for (const p of PLAN_ORDER) {
    const v = LIMITS[p][key];
    values[p] = v === 0 ? NO : `${formatLimit(v)}${v === Infinity ? '' : suffix}`;
  }
  return { label, values };
}

function flagRow(label: string, key: keyof typeof FLAGS.free): Row {
  const values = {} as Record<PlanId, CellValue>;
  for (const p of PLAN_ORDER) values[p] = FLAGS[p][key] ? YES : NO;
  return { label, values };
}

const GROUPS: Group[] = [
  {
    title: 'Core Limits',
    rows: [
      limitRow('Family members', 'familyMembers'),
      limitRow('Modules per member', 'modulesPerMember'),
      limitRow('Active reminders', 'reminders'),
      limitRow('Expense history', 'expenseHistoryDays', ' days'),
      limitRow('Bills per member', 'billsPerMember'),
      limitRow('Documents', 'documents'),
    ],
  },
  {
    title: 'Expense Entry',
    rows: [
      limitRow('Bill scan (OCR) / mo', 'billScanPerMonth'),
      limitRow('Voice entry / mo', 'voiceReminderPerMonth'),
      limitRow('Bank PDF import / mo', 'bankPdfImportPerMonth'),
      flagRow('CSV / Excel import', 'csvImport'),
      limitRow('Recurring templates', 'recurringTemplates'),
    ],
  },
  {
    title: 'Reports & Analytics',
    rows: [
      flagRow('Per-member breakdown', 'perMemberBreakdown'),
      flagRow('PDF reports', 'pdfReports'),
      flagRow('Annual report PDF', 'annualReportPdf'),
      flagRow('Money leak alerts', 'moneyLeakAlerts'),
      flagRow('Budget alerts', 'budgetAlerts'),
    ],
  },
  {
    title: 'Family Hub',
    rows: [
      limitRow('Caregivers per member', 'caregiversPerMember'),
      limitRow('Location sharing', 'locationSharingMembers', ' members'),
      limitRow('Noticeboard posts / mo', 'noticeboardPostsPerMonth'),
    ],
  },
  {
    title: 'AI & WiseAI',
    rows: [limitRow('WiseAI messages / mo', 'wiseAiPerMonth')],
  },
  {
    title: 'Health',
    rows: [
      flagRow('Medicine stock alerts', 'medicineStockAlerts'),
      flagRow('Health graph (12 mo)', 'healthGraph12mo'),
      flagRow('Medicine interaction check', 'medicineInteraction'),
      flagRow('Pill photo identifier', 'pillIdentifier'),
      flagRow('Doctor health PDF', 'doctorHealthPdf'),
    ],
  },
  {
    title: 'Other',
    rows: [
      flagRow('SMS auto-detect (Android)', 'smsAutoDetect'),
      flagRow('Document expiry alerts', 'documentExpiryAlerts'),
      flagRow('Caregiver alerts', 'sharedCaregiverAlerts'),
      flagRow('WhatsApp reminders (beta)', 'whatsappReminders'),
      flagRow('Data export (JSON)', 'dataExportJson'),
    ],
  },
];

const LABEL_W = 150;
const COL_W = 66;

interface Props {
  currentPlan: PlanId;
}

function Cell({ value, highlight }: { value: CellValue; highlight: boolean }) {
  const { colors } = useTheme();
  const wrap = [styles.cell, { width: COL_W }, highlight && { backgroundColor: colors.accentDim }];
  if (value === YES) {
    return (
      <View style={wrap}>
        <Ionicons name="checkmark-circle" size={18} color={colors.accentMint} />
      </View>
    );
  }
  if (value === NO) {
    return (
      <View style={wrap}>
        <Ionicons name="close" size={16} color={colors.textTertiary} />
      </View>
    );
  }
  return (
    <View style={wrap}>
      <Text style={[styles.cellText, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

export default function PlanComparisonTable({ currentPlan }: Props) {
  const { colors } = useTheme();

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false}>
      <View>
        {/* Header row */}
        <View style={[styles.headerRow, { borderBottomColor: colors.border }]}>
          <View style={{ width: LABEL_W }} />
          {PLAN_ORDER.map((p) => {
            const highlight = p === currentPlan;
            return (
              <View
                key={p}
                style={[
                  styles.cell,
                  { width: COL_W },
                  highlight && { backgroundColor: colors.accentDim },
                ]}
              >
                <Text
                  style={[
                    styles.headerName,
                    { color: highlight ? colors.accent : colors.text },
                  ]}
                >
                  {PLAN_META[p].name}
                </Text>
              </View>
            );
          })}
        </View>

        {GROUPS.map((group) => (
          <View key={group.title}>
            <Text style={[styles.groupTitle, { color: colors.textSecondary }]}>{group.title}</Text>
            {group.rows.map((row) => (
              <View key={row.label} style={[styles.dataRow, { borderBottomColor: colors.border }]}>
                <View style={{ width: LABEL_W }}>
                  <Text style={[styles.rowLabel, { color: colors.text }]}>{row.label}</Text>
                </View>
                {PLAN_ORDER.map((p) => (
                  <Cell key={p} value={row.values[p]} highlight={p === currentPlan} />
                ))}
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    paddingBottom: 10,
    marginBottom: 4,
  },
  headerName: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  groupTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 16,
    marginBottom: 6,
  },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 44,
  },
  rowLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    paddingRight: 8,
  },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    paddingVertical: 8,
  },
  cellText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    textAlign: 'center',
  },
});
