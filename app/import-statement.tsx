import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { useCurrency } from '@/lib/currency-context';
import { useAlert } from '@/lib/alert-context';
import { useExpenses } from '@/lib/expense-context';
import { getApiUrl } from '@/lib/query-client';
import { CATEGORIES, CategoryType } from '@/lib/data';
import CustomModal from '@/components/CustomModal';

/**
 * Bank statement import — Methods 4 & 5 in the product doc.
 *
 * On iOS this is the closest thing to Android's SMS auto-detection: Apple blocks
 * SMS access entirely (doc §1), so one statement import stands in for a month of
 * automatic transaction capture.
 *
 * Parsing happens SERVER-SIDE via `POST /api/transactions/import/preview`
 * (EXPENSE_ENTRY_BACKEND_UPDATE.md §5) — the server owns categorisation and
 * `dedupeKey` generation, so this screen just uploads the file and renders
 * whatever comes back. React Native cannot extract PDF text on-device, which is
 * why this always had to be a server job.
 *
 * PDF (and anything else that isn't CSV) currently gets a 422 from the same
 * endpoint — "CSV only for now" per the backend note — so the UI shows that
 * message rather than guessing by file extension itself.
 *
 * Nothing is written until the user reviews the rows and taps Import (doc Method
 * 4, Step 4): §5's endpoint is preview-only, and the actual commit goes through
 * the bulk endpoint in `addTransactionsBulk()`.
 */

/** Row shape returned by POST /api/transactions/import/preview. */
interface PreviewRow {
  date: string;
  description: string;
  amount: number;
  isDebit: boolean;
  suggestedCategory: CategoryType;
  dedupeKey: string;
}

/** Local, editable copy of a preview row — `id` and `category` are UI-only. */
interface ImportRow extends PreviewRow {
  id: string;
  category: CategoryType;
}

type Stage = 'pick' | 'review' | 'saving';

/** Categories offered when correcting a row. */
const EDIT_CATEGORIES: CategoryType[] = [
  'food', 'transport', 'health', 'bills', 'shopping',
  'entertainment', 'subscriptions', 'education', 'travel',
  'investment', 'finance', 'family', 'others',
];

export default function ImportStatementScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { token } = useAuth();
  const { formatAmount } = useCurrency();
  const { showAlert } = useAlert();
  const { addTransactionsBulk } = useExpenses();

  const [stage, setStage] = useState<Stage>('pick');
  const [isParsing, setIsParsing] = useState(false);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [skippedCount, setSkippedCount] = useState(0);
  const [editingRow, setEditingRow] = useState<ImportRow | null>(null);
  const [savedCount, setSavedCount] = useState(0);

  /** Debits only — a statement's credits are income, not expenses. */
  const debitRows = useMemo(() => rows.filter((r) => r.isDebit), [rows]);
  const creditCount = rows.length - debitRows.length;

  const selectedRows = useMemo(
    () => debitRows.filter((r) => selected.has(r.id)),
    [debitRows, selected],
  );
  const selectedTotal = useMemo(
    () => selectedRows.reduce((sum, r) => sum + r.amount, 0),
    [selectedRows],
  );

  const handlePickFile = useCallback(async () => {
    if (!token) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/pdf', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      const name = asset.name || 'statement';

      setIsParsing(true);
      setFileName(name);

      const form = new FormData();
      form.append('file', {
        uri: asset.uri,
        name,
        type: asset.mimeType || 'text/csv',
      } as any);

      const baseUrl = getApiUrl();
      const res = await fetch(new URL('/api/transactions/import/preview', baseUrl).toString(), {
        method: 'POST',
        // Do NOT set Content-Type manually — fetch needs to generate the
        // multipart boundary itself (same rule as receipt/avatar upload).
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      setIsParsing(false);

      if (res.status === 422) {
        const json = await res.json().catch(() => null);
        showAlert({
          title: 'Could not read this file',
          message:
            json?.message ||
            'This format is not supported yet. Please use your bank\'s CSV export instead.',
          type: 'info',
        });
        return;
      }
      if (!res.ok) {
        showAlert({
          title: 'Could not read this file',
          message: 'Please try again, or pick a different file.',
          type: 'error',
        });
        return;
      }

      const { rows: previewRows, meta } = (await res.json()) as {
        rows: PreviewRow[];
        meta: { rowsFound: number; rowsSkipped: number };
      };

      if (!previewRows || previewRows.length === 0) {
        showAlert({
          title: 'No transactions found',
          message: 'This file did not contain any readable transactions.',
          type: 'error',
        });
        return;
      }

      const importRows: ImportRow[] = previewRows.map((r, i) => ({
        ...r,
        id: `imp_${i}_${r.dedupeKey}`,
        category: r.suggestedCategory || 'others',
      }));

      setRows(importRows);
      setSkippedCount(meta?.rowsSkipped || 0);
      // Pre-select every debit — the doc's flow is "uncheck what you don't want".
      setSelected(new Set(importRows.filter((r) => r.isDebit).map((r) => r.id)));
      setStage('review');
    } catch (err) {
      setIsParsing(false);
      showAlert({
        title: 'Could not open the file',
        message: 'Please check your connection and try again.',
        type: 'error',
      });
    }
  }, [token, showAlert]);

  const toggleRow = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected = selected.size === debitRows.length && debitRows.length > 0;
  const toggleAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(debitRows.map((r) => r.id)));
  }, [allSelected, debitRows]);

  const applyCategory = useCallback((rowId: string, category: CategoryType) => {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, category } : r)));
    setEditingRow(null);
  }, []);

  const handleImport = useCallback(async () => {
    if (selectedRows.length === 0) return;
    setStage('saving');

    const saved = await addTransactionsBulk(
      selectedRows.map((r) => ({
        merchant: r.description,
        amount: r.amount,
        category: r.category,
        date: r.date,
        description: r.description,
        source: 'import' as const,
        // Server-generated in the preview call — reusing it (rather than
        // recomputing) is what lets a re-import of the same statement resolve
        // to the exact same key the server already indexed.
        dedupeKey: r.dedupeKey,
      })),
    );

    setSavedCount(saved);

    if (saved === 0) {
      setStage('review');
      showAlert({
        title: 'Nothing was imported',
        message: 'The transactions could not be saved. Please check your connection and try again.',
        type: 'error',
      });
      return;
    }

    const failed = selectedRows.length - saved;
    showAlert({
      title: 'Import complete',
      message:
        failed > 0
          ? `${saved} of ${selectedRows.length} transactions imported. ${failed} could not be saved.`
          : `${saved} transactions imported.`,
      type: failed > 0 ? 'warning' : 'success',
      buttons: [{ text: 'Done', onPress: () => router.back() }],
    });
  }, [selectedRows, addTransactionsBulk, showAlert, router]);

  /* ---------------------------------------------------------------- */

  const renderPick = () => (
    <View style={styles.pickBody}>
      <View style={[styles.heroIcon, { backgroundColor: colors.accent + '18' }]}>
        <Ionicons name="document-text-outline" size={34} color={colors.accent} />
      </View>
      <Text style={[styles.heroTitle, { color: colors.text }]}>Import a bank statement</Text>
      <Text style={[styles.heroText, { color: colors.textSecondary }]}>
        Download a CSV export from your bank app or net banking, then pick it here. One import fills
        in a whole month at once.
      </Text>

      <Pressable
        onPress={handlePickFile}
        disabled={isParsing}
        style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
      >
        {isParsing ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <>
            <Ionicons name="folder-open-outline" size={17} color="#FFFFFF" />
            <Text style={styles.primaryBtnText}>Choose CSV file</Text>
          </>
        )}
      </Pressable>

      <View style={[styles.infoCard, { backgroundColor: colors.bgSecondary, borderColor: colors.border }]}>
        <Text style={[styles.infoTitle, { color: colors.text }]}>Where to find your CSV</Text>
        {[
          'HDFC / ICICI / Axis — net banking → Account Statement → download as CSV or Excel',
          'SBI — YONO or net banking → Account Statement → choose CSV',
          'Any bank — if only PDF is offered, ask for the "delimited" or "Excel" export',
        ].map((line) => (
          <View key={line} style={styles.bullet}>
            <Text style={[styles.bulletDot, { color: colors.textTertiary }]}>•</Text>
            <Text style={[styles.bulletText, { color: colors.textSecondary }]}>{line}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.noteCard, { borderColor: colors.warning + '44', backgroundColor: colors.warning + '10' }]}>
        <Ionicons name="information-circle-outline" size={16} color={colors.warning} />
        <Text style={[styles.noteText, { color: colors.textSecondary }]}>
          PDF statements are not supported yet — they need server-side parsing. Use your bank's CSV
          export, which is also more accurate.
        </Text>
      </View>
    </View>
  );

  const renderReview = () => (
    <>
      <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.fileName, { color: colors.text }]} numberOfLines={1}>
          {fileName}
        </Text>
        <Text style={[styles.summaryLine, { color: colors.textSecondary }]}>
          {debitRows.length} expense{debitRows.length === 1 ? '' : 's'} found
          {creditCount > 0 ? ` · ${creditCount} credit${creditCount === 1 ? '' : 's'} ignored` : ''}
          {skippedCount > 0 ? ` · ${skippedCount} row${skippedCount === 1 ? '' : 's'} unreadable` : ''}
        </Text>
      </View>

      <View style={styles.selectAllRow}>
        <Pressable onPress={toggleAll} style={styles.selectAllBtn} hitSlop={8}>
          <Ionicons
            name={allSelected ? 'checkbox' : 'square-outline'}
            size={19}
            color={allSelected ? colors.accent : colors.textTertiary}
          />
          <Text style={[styles.selectAllText, { color: colors.textSecondary }]}>
            {allSelected ? 'Deselect all' : 'Select all'}
          </Text>
        </Pressable>
        <Text style={[styles.selectedCount, { color: colors.textTertiary }]}>
          {selected.size} selected
        </Text>
      </View>

      {debitRows.map((row) => {
        const isOn = selected.has(row.id);
        const meta = CATEGORIES[row.category];
        return (
          <Pressable
            key={row.id}
            onPress={() => toggleRow(row.id)}
            style={[
              styles.row,
              {
                backgroundColor: colors.card,
                borderColor: isOn ? colors.accent + '55' : colors.border,
                opacity: isOn ? 1 : 0.55,
              },
            ]}
          >
            <Ionicons
              name={isOn ? 'checkbox' : 'square-outline'}
              size={19}
              color={isOn ? colors.accent : colors.textTertiary}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowDesc, { color: colors.text }]} numberOfLines={1}>
                {row.description}
              </Text>
              <Text style={[styles.rowDate, { color: colors.textTertiary }]}>
                {new Date(row.date).toLocaleDateString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  timeZone: 'UTC',
                })}
              </Text>
            </View>

            <Pressable
              onPress={() => setEditingRow(row)}
              hitSlop={6}
              style={[styles.catChip, { backgroundColor: meta.color + '1F', borderColor: meta.color + '55' }]}
            >
              <Ionicons name={meta.icon as any} size={11} color={meta.color} />
              <Text style={[styles.catChipText, { color: meta.color }]} numberOfLines={1}>
                {meta.label}
              </Text>
            </Pressable>

            <Text style={[styles.rowAmount, { color: colors.text }]}>{formatAmount(row.amount)}</Text>
          </Pressable>
        );
      })}

      <Text style={[styles.footnote, { color: colors.textTertiary }]}>
        Tap a category chip to change it. Uncheck anything that shouldn't be imported.
      </Text>
    </>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {stage === 'pick' ? 'Import Statement' : 'Review transactions'}
        </Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: insets.bottom + (stage === 'review' ? 110 : 32) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {stage === 'pick' ? renderPick() : renderReview()}
      </ScrollView>

      {/* Sticky import bar */}
      {stage !== 'pick' && (
        <View
          style={[
            styles.footer,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
              paddingBottom: insets.bottom + 12,
            },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.footerLabel, { color: colors.textTertiary }]}>
              {selected.size} selected
            </Text>
            <Text style={[styles.footerTotal, { color: colors.text }]}>
              {formatAmount(selectedTotal)}
            </Text>
          </View>
          <Pressable
            onPress={handleImport}
            disabled={selected.size === 0 || stage === 'saving'}
            style={[
              styles.importBtn,
              {
                backgroundColor: selected.size === 0 ? colors.border : colors.accent,
              },
            ]}
          >
            {stage === 'saving' ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.importBtnText}>
                Import {selected.size > 0 ? selected.size : ''}
              </Text>
            )}
          </Pressable>
        </View>
      )}

      {/* Category picker */}
      <CustomModal
        visible={!!editingRow}
        onClose={() => setEditingRow(null)}
        showCloseButton={false}
      >
        <Text style={[styles.modalTitle, { color: colors.text }]}>Change category</Text>
        <Text style={[styles.modalSub, { color: colors.textTertiary }]} numberOfLines={1}>
          {editingRow?.description}
        </Text>
        <View style={styles.catGrid}>
          {EDIT_CATEGORIES.map((cat) => {
            const meta = CATEGORIES[cat];
            const active = editingRow?.category === cat;
            return (
              <Pressable
                key={cat}
                onPress={() => editingRow && applyCategory(editingRow.id, cat)}
                style={[
                  styles.catGridItem,
                  {
                    backgroundColor: active ? meta.color + '22' : colors.bgSecondary,
                    borderColor: active ? meta.color : colors.border,
                  },
                ]}
              >
                <Ionicons name={meta.icon as any} size={14} color={active ? meta.color : colors.textTertiary} />
                <Text
                  style={[styles.catGridText, { color: active ? meta.color : colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {meta.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </CustomModal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700' },
  body: { padding: 16 },

  pickBody: { alignItems: 'center', paddingTop: 12 },
  heroIcon: {
    width: 72, height: 72, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  heroTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  heroText: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginBottom: 22 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 50, alignSelf: 'stretch', borderRadius: 14, paddingHorizontal: 20,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  infoCard: {
    alignSelf: 'stretch', borderRadius: 14, borderWidth: 1,
    padding: 14, marginTop: 22, gap: 7,
  },
  infoTitle: { fontSize: 13, fontWeight: '700', marginBottom: 3 },
  bullet: { flexDirection: 'row', gap: 7 },
  bulletDot: { fontSize: 13, lineHeight: 18 },
  bulletText: { flex: 1, fontSize: 12, lineHeight: 18 },
  noteCard: {
    flexDirection: 'row', gap: 9, alignSelf: 'stretch',
    borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 14,
  },
  noteText: { flex: 1, fontSize: 12, lineHeight: 17 },

  summaryCard: { borderRadius: 13, borderWidth: 1, padding: 13, marginBottom: 14 },
  fileName: { fontSize: 14, fontWeight: '700' },
  summaryLine: { fontSize: 12, marginTop: 4, lineHeight: 17 },
  selectAllRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 10,
  },
  selectAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 32 },
  selectAllText: { fontSize: 13, fontWeight: '600' },
  selectedCount: { fontSize: 12 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8,
  },
  rowDesc: { fontSize: 13, fontWeight: '600' },
  rowMetaLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  rowDate: { fontSize: 11 },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 5,
    borderRadius: 14, borderWidth: 1, maxWidth: 104,
  },
  catChipText: { fontSize: 10, fontWeight: '700' },
  rowAmount: { fontSize: 13, fontWeight: '700', minWidth: 62, textAlign: 'right' },
  footnote: { fontSize: 11, lineHeight: 17, marginTop: 12, textAlign: 'center' },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerLabel: { fontSize: 11 },
  footerTotal: { fontSize: 17, fontWeight: '700', marginTop: 1 },
  importBtn: {
    minWidth: 130, minHeight: 48, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20,
  },
  importBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },

  modalTitle: { fontSize: 16, fontWeight: '700' },
  modalSub: { fontSize: 12, marginTop: 4, marginBottom: 14 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catGridItem: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 11, paddingVertical: 9,
    borderRadius: 18, borderWidth: 1,
  },
  catGridText: { fontSize: 12, fontWeight: '600' },
});
