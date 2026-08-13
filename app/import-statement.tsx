import React, { useCallback, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { useCurrency } from '@/lib/currency-context';
import { useAlert } from '@/lib/alert-context';
import { useExpenses } from '@/lib/expense-context';
import { getApiUrl } from '@/lib/query-client';
import { CATEGORIES, CategoryType } from '@/lib/data';
import CustomModal from '@/components/CustomModal';
import Money from '@/components/Money';
import { LoadingIndicator } from '@/components/PremiumLoader';

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
 * PDF goes through the SAME endpoint and the same review flow — the server
 * decides what it can read, so this screen never gates on file extension. If a
 * given format isn't supported the server answers 422 and we surface its
 * message verbatim; that way support for a new bank/format goes live without
 * shipping an app update.
 *
 * Password-protected statements (SBI mails these routinely) come back as 401
 * with `needsPassword: true`, which opens a prompt and retries the same upload
 * with a `password` field. The full contract this screen implements is written
 * up in `backend-team/BANK-STATEMENT-IMPORT-backend-requirements.md`.
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

/** The file being uploaded, kept so a password retry can re-send it. */
interface PickedFile {
  uri: string;
  name: string;
  mime: string;
}

/**
 * MIME type by extension rather than whatever the picker reported. On Android,
 * DocumentPicker commonly reports files from Downloads as
 * `application/octet-stream`, which a server that gates on content-type will
 * reject outright even when the bytes are a perfectly good CSV or PDF.
 */
function mimeForFile(name: string, fallback?: string | null): string {
  switch (name.split('.').pop()?.toLowerCase()) {
    case 'csv':
      return 'text/csv';
    case 'pdf':
      return 'application/pdf';
    case 'xls':
      return 'application/vnd.ms-excel';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    default:
      return fallback || 'application/octet-stream';
  }
}

/** Categories offered when correcting a row. */
const EDIT_CATEGORIES: CategoryType[] = [
  'food', 'transport', 'health', 'bills', 'shopping',
  'entertainment', 'subscriptions', 'education', 'travel',
  'investment', 'finance', 'family', 'others',
];

export default function ImportStatementScreen() {
  const { t } = useTranslation();
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
  const [sourceBank, setSourceBank] = useState('');

  // Password-protected PDF retry state.
  const [pendingFile, setPendingFile] = useState<PickedFile | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const debitCount = useMemo(() => rows.filter((r) => r.isDebit).length, [rows]);
  const creditCount = rows.length - debitCount;

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.id)),
    [rows, selected],
  );
  const selectedTotal = useMemo(
    () => selectedRows.reduce((sum, r) => sum + (r.isDebit ? r.amount : -r.amount), 0),
    [selectedRows],
  );

  /**
   * Upload one file to the preview endpoint and move to the review stage.
   *
   * Split out from the picker so the password retry can re-send the exact same
   * file without making the user choose it a second time.
   */
  const uploadFile = useCallback(
    async (file: PickedFile, password?: string) => {
      if (!token) return;
      try {
        setIsParsing(true);
        setFileName(file.name);

        const form = new FormData();
        form.append('file', {
          uri: file.uri,
          name: file.name,
          type: file.mime,
        } as any);
        if (password) form.append('password', password);

        const baseUrl = getApiUrl();
        const res = await fetch(new URL('/api/transactions/import/preview', baseUrl).toString(), {
          method: 'POST',
          // Do NOT set Content-Type manually — fetch needs to generate the
          // multipart boundary itself (same rule as receipt/avatar upload).
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });

        setIsParsing(false);

        // 401 is overloaded: an expired session AND a locked PDF. `needsPassword`
        // is what tells them apart — without it we'd sign the user out over an
        // encrypted statement.
        if (res.status === 401) {
          const json = await res.json().catch(() => null);
          if (json?.needsPassword) {
            setPendingFile(file);
            setPasswordError(password ? t('importStatement.wrongPassword') : '');
            setPasswordInput('');
            setPasswordVisible(true);
            return;
          }
          showAlert({
            title: t('importStatement.sessionExpiredTitle'),
            message: t('importStatement.sessionExpiredMessage'),
            type: 'error',
          });
          return;
        }

        if (res.status === 422) {
          const json = await res.json().catch(() => null);
          // Log the detail so a rejected file can actually be diagnosed — the
          // server's user-facing message doesn't say WHY it was rejected.
          console.warn('[Import] 422 rejected:', file.name, file.mime, JSON.stringify(json));
          showAlert({
            title: t('importStatement.couldNotReadStatementTitle'),
            message:
              json?.message ||
              t('importStatement.couldNotReadStatementMessage'),
            type: 'info',
          });
          return;
        }

        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          console.error(`[Import] HTTP ${res.status}:`, detail.slice(0, 300));
          showAlert({
            title: t('importStatement.couldNotReadFileTitle'),
            message:
              res.status === 413
                ? t('importStatement.fileTooLarge')
                : t('importStatement.uploadFailed', { status: res.status }),
            type: 'error',
          });
          return;
        }

        const { rows: previewRows, meta } = (await res.json()) as {
          rows: PreviewRow[];
          meta: { rowsFound: number; rowsSkipped: number; bank?: string; format?: string };
        };

        if (!previewRows || previewRows.length === 0) {
          showAlert({
            title: t('importStatement.noTransactionsFoundTitle'),
            message:
              file.mime === 'application/pdf'
                ? t('importStatement.noTransactionsFoundPdf')
                : t('importStatement.noTransactionsFoundGeneric'),
            type: 'error',
          });
          return;
        }

        const importRows: ImportRow[] = previewRows.map((r, i) => ({
          ...r,
          id: `imp_${i}_${r.dedupeKey}`,
          category: r.suggestedCategory || 'others',
        }));

        // Clear the retry state — a successful parse means the password (if any)
        // did its job and the file no longer needs holding on to.
        setPendingFile(null);
        setPasswordVisible(false);
        setPasswordInput('');

        setRows(importRows);
        setSkippedCount(meta?.rowsSkipped || 0);
        setSourceBank(meta?.bank || '');
        // Pre-select every row (debit and credit) — the doc's flow is "uncheck
        // what you don't want". Credits used to be dropped before this point,
        // so income (salary, refunds) could never be imported.
        setSelected(new Set(importRows.map((r) => r.id)));
        setStage('review');
      } catch (err) {
        setIsParsing(false);
        showAlert({
          title: t('importStatement.couldNotOpenFileTitle'),
          message: t('importStatement.checkConnectionMessage'),
          type: 'error',
        });
      }
    },
    [token, showAlert, t],
  );

  const handlePickFile = useCallback(async () => {
    if (!token) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'text/csv',
          'text/comma-separated-values',
          'text/plain',
          'application/pdf',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '*/*',
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      const name = asset.name || 'statement.csv';
      await uploadFile({ uri: asset.uri, name, mime: mimeForFile(name, asset.mimeType) });
    } catch (err) {
      showAlert({
        title: t('importStatement.couldNotOpenFileTitle'),
        message: t('importStatement.fileCouldNotBeOpened'),
        type: 'error',
      });
    }
  }, [token, uploadFile, showAlert, t]);

  const submitPassword = useCallback(() => {
    const pw = passwordInput.trim();
    if (!pw || !pendingFile) return;
    setPasswordVisible(false);
    void uploadFile(pendingFile, pw);
  }, [passwordInput, pendingFile, uploadFile]);

  const toggleRow = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected = selected.size === rows.length && rows.length > 0;
  const toggleAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }, [allSelected, rows]);

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
        isDebit: r.isDebit,
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
        title: t('importStatement.nothingImportedTitle'),
        message: t('importStatement.nothingImportedMessage'),
        type: 'error',
      });
      return;
    }

    const failed = selectedRows.length - saved;
    showAlert({
      title: t('importStatement.importCompleteTitle'),
      message:
        failed > 0
          ? t('importStatement.importCompletePartial', { saved, total: selectedRows.length, failed })
          : t('importStatement.importCompleteFull', { saved }),
      type: failed > 0 ? 'warning' : 'success',
      buttons: [{ text: t('common.done'), onPress: () => router.back() }],
    });
  }, [selectedRows, addTransactionsBulk, showAlert, router, t]);

  /* ---------------------------------------------------------------- */

  const renderPick = () => (
    <View style={styles.pickBody}>
      <View style={[styles.heroIcon, { backgroundColor: colors.accent + '18' }]}>
        <Ionicons name="document-text-outline" size={34} color={colors.accent} />
      </View>
      <Text style={[styles.heroTitle, { color: colors.text }]}>{t('importStatement.heroTitle')}</Text>
      <Text style={[styles.heroText, { color: colors.textSecondary }]}>
        {t('importStatement.heroText')}
      </Text>

      <Pressable
        onPress={handlePickFile}
        disabled={isParsing}
        style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
      >
        {isParsing ? (
          <LoadingIndicator size="small" color="#FFFFFF" />
        ) : (
          <>
            <Ionicons name="folder-open-outline" size={17} color="#FFFFFF" />
            <Text style={styles.primaryBtnText}>{t('importStatement.chooseStatementFile')}</Text>
          </>
        )}
      </Pressable>

      <View style={styles.formatRow}>
        {[t('importStatement.formatPdf'), t('importStatement.formatCsv'), t('importStatement.formatExcel')].map((fmt) => (
          <View
            key={fmt}
            style={[styles.formatChip, { backgroundColor: colors.bgSecondary, borderColor: colors.border }]}
          >
            <Text style={[styles.formatChipText, { color: colors.textSecondary }]}>{fmt}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.infoCard, { backgroundColor: colors.bgSecondary, borderColor: colors.border }]}>
        <Text style={[styles.infoTitle, { color: colors.text }]}>{t('importStatement.whereToFindTitle')}</Text>
        {[
          t('importStatement.whereToFindBullet1'),
          t('importStatement.whereToFindBullet2'),
          t('importStatement.whereToFindBullet3'),
        ].map((line) => (
          <View key={line} style={styles.bullet}>
            <Text style={[styles.bulletDot, { color: colors.textTertiary }]}>•</Text>
            <Text style={[styles.bulletText, { color: colors.textSecondary }]}>{line}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.noteCard, { borderColor: colors.border, backgroundColor: colors.bgSecondary }]}>
        <Ionicons name="lock-closed-outline" size={16} color={colors.textTertiary} />
        <Text style={[styles.noteText, { color: colors.textSecondary }]}>
          {t('importStatement.passwordProtectedNote')}
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
          {sourceBank ? `${sourceBank} · ` : ''}
          {t('importStatement.expenseCount', { count: debitCount })}
          {creditCount > 0 ? ` · ${t('importStatement.creditCount', { count: creditCount })}` : ''}
          {' '}{t('importStatement.foundSuffix')}
          {skippedCount > 0 ? ` · ${t('importStatement.rowsUnreadable', { count: skippedCount })}` : ''}
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
            {allSelected ? t('importStatement.deselectAll') : t('importStatement.selectAll')}
          </Text>
        </Pressable>
        <Text style={[styles.selectedCount, { color: colors.textTertiary }]}>
          {t('importStatement.selectedCount', { count: selected.size })}
        </Text>
      </View>

      {rows.map((row) => {
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

            <Money
              style={[
                styles.rowAmount,
                { color: row.isDebit ? colors.text : (colors.accentMint || colors.text) },
              ]}
            >
              {row.isDebit ? '' : '+'}{formatAmount(row.amount)}
            </Money>
          </Pressable>
        );
      })}

      <Text style={[styles.footnote, { color: colors.textTertiary }]}>
        {t('importStatement.footnote')}
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
          {stage === 'pick' ? t('importStatement.headerTitlePick') : t('importStatement.headerTitleReview')}
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
              {t('importStatement.selectedCount', { count: selected.size })}
            </Text>
            <Money style={[styles.footerTotal, { color: colors.text }]}>
              {formatAmount(selectedTotal)}
            </Money>
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
              <LoadingIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.importBtnText}>
                {selected.size > 0 ? t('importStatement.importWithCount', { count: selected.size }) : t('importStatement.importAction')}
              </Text>
            )}
          </Pressable>
        </View>
      )}

      {/* Password prompt for encrypted PDFs */}
      <CustomModal
        visible={passwordVisible}
        onClose={() => {
          setPasswordVisible(false);
          setPendingFile(null);
        }}
        showCloseButton={false}
      >
        <Text style={[styles.modalTitle, { color: colors.text }]}>{t('importStatement.pdfProtectedTitle')}</Text>
        <Text style={[styles.modalSub, { color: colors.textTertiary }]}>
          {t('importStatement.pdfProtectedMessage')}
        </Text>

        <TextInput
          value={passwordInput}
          onChangeText={(val) => {
            setPasswordInput(val);
            if (passwordError) setPasswordError('');
          }}
          placeholder={t('importStatement.statementPasswordPlaceholder')}
          placeholderTextColor={colors.textTertiary}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          onSubmitEditing={submitPassword}
          returnKeyType="done"
          style={[
            styles.pwInput,
            {
              color: colors.text,
              backgroundColor: colors.bgSecondary,
              borderColor: passwordError ? colors.danger : colors.border,
            },
          ]}
        />
        {!!passwordError && (
          <Text style={[styles.pwError, { color: colors.danger }]}>{passwordError}</Text>
        )}

        <View style={styles.pwActions}>
          <Pressable
            onPress={() => {
              setPasswordVisible(false);
              setPendingFile(null);
            }}
            style={[styles.pwBtn, { backgroundColor: colors.bgSecondary }]}
          >
            <Text style={[styles.pwBtnText, { color: colors.textSecondary }]}>{t('common.cancel')}</Text>
          </Pressable>
          <Pressable
            onPress={submitPassword}
            disabled={!passwordInput.trim()}
            style={[
              styles.pwBtn,
              { backgroundColor: passwordInput.trim() ? colors.accent : colors.border },
            ]}
          >
            <Text style={[styles.pwBtnText, { color: '#FFFFFF' }]}>{t('importStatement.unlock')}</Text>
          </Pressable>
        </View>
      </CustomModal>

      {/* Category picker */}
      <CustomModal
        visible={!!editingRow}
        onClose={() => setEditingRow(null)}
        showCloseButton={false}
      >
        <Text style={[styles.modalTitle, { color: colors.text }]}>{t('importStatement.changeCategory')}</Text>
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
  formatRow: { flexDirection: 'row', gap: 7, marginTop: 12 },
  formatChip: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 11, borderWidth: 1,
  },
  formatChipText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
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
  modalSub: { fontSize: 12, marginTop: 4, marginBottom: 14, lineHeight: 17 },

  pwInput: {
    minHeight: 48, borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 14, fontSize: 15,
  },
  pwError: { fontSize: 12, marginTop: 7 },
  pwActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  pwBtn: {
    flex: 1, minHeight: 46, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  pwBtnText: { fontSize: 14, fontWeight: '700' },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catGridItem: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 11, paddingVertical: 9,
    borderRadius: 16, borderWidth: 1,
  },
  catGridText: { fontSize: 12, fontWeight: '600' },
});
