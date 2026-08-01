import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useTheme } from '@/lib/theme-context';
import { useSubscription } from '@/lib/subscription-context';
import { usePaywall } from '@/lib/paywall-context';
import {
  FamilyDocument,
  DOCUMENT_TYPE_LABELS,
  loadFamilyDocuments,
  deleteFamilyDocument,
} from '@/lib/family-records';

export default function FamilyDocumentsScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { checkLimit } = useSubscription();
  const { presentPaywall } = usePaywall();

  const [items, setItems] = useState<FamilyDocument[]>([]);

  const load = useCallback(async () => {
    if (!memberId) return;
    setItems(await loadFamilyDocuments(String(memberId)));
  }, [memberId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Gate: storing another document beyond the plan's limit shows the paywall
  // (doc §5.1 — "2nd document on Free"). Opens the add page only if allowed.
  const handleOpenAdd = () => {
    const check = checkLimit('documents', items.length);
    if (!check.allowed && check.triggerKey) {
      presentPaywall(check.triggerKey);
      return;
    }
    router.push({ pathname: '/family-documents/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '' } });
  };

  const headerHeight = 110 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Insurance & Documents</Text>
          <Pressable onPress={handleOpenAdd} style={styles.addBtn} hitSlop={12}>
            <Ionicons name="add-circle" size={30} color={colors.accent} />
          </Pressable>
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>For {memberName}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {items.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="document-text-outline" size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No documents tracked yet</Text>
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>Tap + to track policy renewals and important documents.</Text>
          </View>
        ) : (
          items.map((doc) => {
            const def = DOCUMENT_TYPE_LABELS[doc.type];
            return (
              <Animated.View key={doc.id} entering={FadeInDown.duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.iconWrap, { backgroundColor: colors.accentDim }]}>
                  <Ionicons name={def.icon as any} size={18} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>{doc.title}</Text>
                  <Text style={[styles.cardSub, { color: colors.textTertiary }]}>
                    {def.label}
                    {doc.reminderDate ? ` · Renews ${new Date(doc.reminderDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                  </Text>
                  {!!doc.notes && <Text style={[styles.cardNotes, { color: colors.textSecondary }]}>{doc.notes}</Text>}
                </View>
                <Pressable onPress={() => router.push({ pathname: '/family-documents/add', params: { memberId: String(memberId), memberName: memberName ? String(memberName) : '', editId: doc.id } })} hitSlop={10} style={{ marginLeft: 8 }}>
                  <Ionicons name="create-outline" size={18} color={colors.textTertiary} />
                </Pressable>
                <Pressable onPress={async () => { await deleteFamilyDocument(String(memberId), doc.id); load(); }} hitSlop={10}>
                  <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
                </Pressable>
              </Animated.View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, justifyContent: 'center', borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  addBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  headerSubtitle: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 4, textAlign: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  emptyDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  cardNotes: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 4, fontStyle: 'italic' },
});
