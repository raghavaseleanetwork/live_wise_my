import React from 'react';
import { StyleSheet, Text, View, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/lib/theme-context';
import {
  PlanId,
  PLAN_ORDER,
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
  labelKey: string;
  values: Record<PlanId, CellValue>;
}

interface Group {
  titleKey: string;
  rows: Row[];
}

const YES = '✓';
const NO = '✗';

type LimitSuffix = '' | 'days' | 'members';

/** Suffix text is a translation-suffix marker embedded in the raw value; it is
 * resolved to a localised string at render time (see `resolveSuffix` in Cell). */
function limitRow(labelKey: string, key: keyof typeof LIMITS.free, suffix: LimitSuffix = ''): Row {
  const values = {} as Record<PlanId, CellValue>;
  for (const p of PLAN_ORDER) {
    const v = LIMITS[p][key];
    const suffixMarker = suffix && v !== Infinity ? `__SUFFIX_${suffix}__` : '';
    values[p] = v === 0 ? NO : `${formatLimit(v)}${suffixMarker}`;
  }
  return { labelKey, values };
}

function flagRow(labelKey: string, key: keyof typeof FLAGS.free): Row {
  const values = {} as Record<PlanId, CellValue>;
  for (const p of PLAN_ORDER) values[p] = FLAGS[p][key] ? YES : NO;
  return { labelKey, values };
}

const GROUPS: Group[] = [
  {
    titleKey: 'planComparison.groups.coreLimits',
    rows: [
      limitRow('planComparison.rows.familyMembers', 'familyMembers'),
      limitRow('planComparison.rows.modulesPerMember', 'modulesPerMember'),
      limitRow('planComparison.rows.activeReminders', 'reminders'),
      limitRow('planComparison.rows.expenseHistory', 'expenseHistoryDays', 'days'),
      limitRow('planComparison.rows.billsPerMember', 'billsPerMember'),
      limitRow('planComparison.rows.documents', 'documents'),
    ],
  },
  {
    titleKey: 'planComparison.groups.expenseEntry',
    rows: [
      limitRow('planComparison.rows.billScan', 'billScanPerMonth'),
      limitRow('planComparison.rows.voiceEntry', 'voiceReminderPerMonth'),
      limitRow('planComparison.rows.bankPdfImport', 'bankPdfImportPerMonth'),
      flagRow('planComparison.rows.csvExcelImport', 'csvImport'),
      limitRow('planComparison.rows.recurringTemplates', 'recurringTemplates'),
    ],
  },
  {
    titleKey: 'planComparison.groups.reportsAnalytics',
    rows: [
      flagRow('planComparison.rows.perMemberBreakdown', 'perMemberBreakdown'),
      flagRow('planComparison.rows.pdfReports', 'pdfReports'),
      flagRow('planComparison.rows.annualReportPdf', 'annualReportPdf'),
      flagRow('planComparison.rows.moneyLeakAlerts', 'moneyLeakAlerts'),
      flagRow('planComparison.rows.budgetAlerts', 'budgetAlerts'),
    ],
  },
  {
    titleKey: 'planComparison.groups.familyHub',
    rows: [
      limitRow('planComparison.rows.caregiversPerMember', 'caregiversPerMember'),
      limitRow('planComparison.rows.locationSharing', 'locationSharingMembers', 'members'),
      limitRow('planComparison.rows.noticeboardPosts', 'noticeboardPostsPerMonth'),
    ],
  },
  {
    titleKey: 'planComparison.groups.aiWiseAi',
    rows: [limitRow('planComparison.rows.wiseAiMessages', 'wiseAiPerMonth')],
  },
  {
    titleKey: 'planComparison.groups.health',
    rows: [
      flagRow('planComparison.rows.medicineStockAlerts', 'medicineStockAlerts'),
      flagRow('planComparison.rows.healthGraph', 'healthGraph12mo'),
      flagRow('planComparison.rows.medicineInteraction', 'medicineInteraction'),
      flagRow('planComparison.rows.pillIdentifier', 'pillIdentifier'),
      flagRow('planComparison.rows.doctorHealthPdf', 'doctorHealthPdf'),
    ],
  },
  {
    titleKey: 'planComparison.groups.other',
    rows: [
      flagRow('planComparison.rows.smsAutoDetect', 'smsAutoDetect'),
      flagRow('planComparison.rows.documentExpiryAlerts', 'documentExpiryAlerts'),
      flagRow('planComparison.rows.caregiverAlerts', 'sharedCaregiverAlerts'),
      flagRow('planComparison.rows.whatsappReminders', 'whatsappReminders'),
      flagRow('planComparison.rows.dataExportJson', 'dataExportJson'),
    ],
  },
];

const LABEL_W = 150;
const COL_W = 66;

interface Props {
  currentPlan: PlanId;
}

function resolveSuffix(value: CellValue, t: (key: string) => string): CellValue {
  const match = value.match(/^(.*)__SUFFIX_(days|members)__$/);
  if (!match) return value;
  const [, base, suffix] = match;
  return `${base}${t(`planComparison.suffix${suffix === 'days' ? 'Days' : 'Members'}`)}`;
}

function Cell({ value, highlight }: { value: CellValue; highlight: boolean }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const resolved = resolveSuffix(value, t);
  const wrap = [styles.cell, { width: COL_W }, highlight && { backgroundColor: colors.accentDim }];
  if (resolved === YES) {
    return (
      <View style={wrap}>
        <Ionicons name="checkmark-circle" size={18} color={colors.accentMint} />
      </View>
    );
  }
  if (resolved === NO) {
    return (
      <View style={wrap}>
        <Ionicons name="close" size={16} color={colors.textTertiary} />
      </View>
    );
  }
  return (
    <View style={wrap}>
      <Text style={[styles.cellText, { color: colors.text }]}>{resolved}</Text>
    </View>
  );
}

export default function PlanComparisonTable({ currentPlan }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();

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
                  {t(`subscription.planNames.${p}`)}
                </Text>
              </View>
            );
          })}
        </View>

        {GROUPS.map((group) => (
          <View key={group.titleKey}>
            <Text style={[styles.groupTitle, { color: colors.textSecondary }]}>{t(group.titleKey)}</Text>
            {group.rows.map((row) => (
              <View key={row.labelKey} style={[styles.dataRow, { borderBottomColor: colors.border }]}>
                <View style={{ width: LABEL_W }}>
                  <Text style={[styles.rowLabel, { color: colors.text }]}>{t(row.labelKey)}</Text>
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
