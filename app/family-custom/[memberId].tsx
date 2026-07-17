import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown, FadeIn, FadeOut } from 'react-native-reanimated';

import { useTheme } from '@/lib/theme-context';
import {
  CustomFeatureConfig,
  CustomTrackerItem,
  loadCustomConfig,
  saveCustomConfig,
  loadCustomItems,
  addCustomItem,
  toggleCustomItem,
  deleteCustomItem,
} from '@/lib/family-records';

const ICON_OPTIONS = ['star', 'fitness', 'book', 'musical-notes', 'brush', 'football', 'game-controller', 'leaf'];

export default function FamilyCustomScreen() {
  const router = useRouter();
  const { memberId, memberName } = useLocalSearchParams<{ memberId: string; memberName?: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [config, setConfig] = useState<CustomFeatureConfig | null>(null);
  const [items, setItems] = useState<CustomTrackerItem[]>([]);
  const [showSetup, setShowSetup] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const [trackerName, setTrackerName] = useState('');
  const [trackerIcon, setTrackerIcon] = useState('star');
  const [itemTitle, setItemTitle] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!memberId) return;
    const [c, i] = await Promise.all([loadCustomConfig(String(memberId)), loadCustomItems(String(memberId))]);
    setConfig(c);
    setItems(i);
    if (!c) setShowSetup(true);
  }, [memberId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleSaveConfig = async () => {
    if (!trackerName.trim()) {
      setError('Please name your custom tracker');
      return;
    }
    if (!memberId) return;
    const newConfig: CustomFeatureConfig = { name: trackerName.trim(), icon: trackerIcon };
    await saveCustomConfig(String(memberId), newConfig);
    setConfig(newConfig);
    setShowSetup(false);
    setError('');
  };

  const handleAddItem = async () => {
    if (!itemTitle.trim()) {
      setError('Please enter an entry');
      return;
    }
    if (!memberId) return;
    await addCustomItem(String(memberId), itemTitle.trim());
    setItemTitle('');
    setShowAdd(false);
    setError('');
    load();
  };

  const headerHeight = 110 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <LinearGradient colors={colors.heroGradient as any} style={[styles.header, { height: headerHeight, paddingTop: insets.top }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: colors.text }]}>⚙️ {config?.name || 'Custom Feature'}</Text>
          <View style={styles.headerActions}>
            {config && (
              <Pressable onPress={() => { setTrackerName(config.name); setTrackerIcon(config.icon); setShowSetup(true); }} hitSlop={12}>
                <Ionicons name="settings-outline" size={20} color={colors.textSecondary} />
              </Pressable>
            )}
            <Pressable onPress={() => setShowAdd(true)} hitSlop={12}>
              <Ionicons name="add-circle" size={30} color={colors.accent} />
            </Pressable>
          </View>
        </View>
        {memberName ? <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>For {memberName}</Text> : null}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {showSetup && (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={styles.formSection}>
            <Text style={[styles.sectionHeading, { color: colors.text }]}>Name your tracker</Text>
            <Text style={[styles.sectionHint, { color: colors.textTertiary }]}>
              Give it a name and pick an icon. You can change this later.
            </Text>
            {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Tracker Name</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={trackerName}
              onChangeText={setTrackerName}
              placeholder="e.g. Physiotherapy Sessions"
              placeholderTextColor={colors.textTertiary}
            />

            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Icon</Text>
            <View style={styles.iconGrid}>
              {ICON_OPTIONS.map((icon) => (
                <Pressable
                  key={icon}
                  onPress={() => setTrackerIcon(icon)}
                  style={[styles.iconOption, { backgroundColor: colors.inputBg, borderColor: colors.border }, trackerIcon === icon && { backgroundColor: colors.accentDim, borderColor: colors.accent }]}
                >
                  <Ionicons name={icon as any} size={22} color={trackerIcon === icon ? colors.accent : colors.textTertiary} />
                </Pressable>
              ))}
            </View>

            <Pressable onPress={handleSaveConfig} style={[styles.primaryBtn, { backgroundColor: colors.accent }]}>
              <Text style={styles.primaryBtnLabel}>Save</Text>
            </Pressable>
            {!!config && (
              <Pressable onPress={() => { setShowSetup(false); setError(''); }} style={styles.cancelBtn}>
                <Text style={[styles.cancelBtnLabel, { color: colors.textTertiary }]}>Cancel</Text>
              </Pressable>
            )}
          </Animated.View>
        )}

        {showAdd && (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={styles.formSection}>
            <Text style={[styles.sectionHeading, { color: colors.text }]}>New entry</Text>
            {!!error && <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>}

            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Entry</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.inputBg }]}
              value={itemTitle}
              onChangeText={setItemTitle}
              placeholder="What do you want to log?"
              placeholderTextColor={colors.textTertiary}
              autoFocus
            />

            <Pressable onPress={handleAddItem} style={[styles.primaryBtn, { backgroundColor: colors.accent }]}>
              <Text style={styles.primaryBtnLabel}>Add</Text>
            </Pressable>
            <Pressable onPress={() => { setShowAdd(false); setItemTitle(''); setError(''); }} style={styles.cancelBtn}>
              <Text style={[styles.cancelBtnLabel, { color: colors.textTertiary }]}>Cancel</Text>
            </Pressable>
          </Animated.View>
        )}

        {showSetup || showAdd ? null : items.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name={(config?.icon || 'star') as any} size={48} color={colors.textTertiary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>Nothing tracked yet</Text>
            <Text style={[styles.emptyDesc, { color: colors.textTertiary }]}>Tap + to log your first entry for {config?.name || 'this tracker'}.</Text>
          </View>
        ) : (
          items.map((item) => (
            <Animated.View key={item.id} entering={FadeInDown.duration(300)} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Pressable onPress={async () => { await toggleCustomItem(String(memberId), item.id); load(); }} style={styles.checkCircle}>
                <Ionicons name={item.completed ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={item.completed ? '#10B981' : colors.textTertiary} />
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.text }, item.completed && { textDecorationLine: 'line-through', opacity: 0.5 }]}>{item.title}</Text>
                <Text style={[styles.cardSub, { color: colors.textTertiary }]}>
                  {new Date(item.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </Text>
              </View>
              <Pressable onPress={async () => { await deleteCustomItem(String(memberId), item.id); load(); }} hitSlop={10}>
                <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
              </Pressable>
            </Animated.View>
          ))
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, flex: 1, textAlign: 'center' },
  headerSubtitle: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 4, textAlign: 'center' },
  formSection: { marginBottom: 28 },
  sectionHeading: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  sectionHint: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 4, lineHeight: 18 },
  primaryBtn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 22 },
  primaryBtnLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, color: '#FFF' },
  cancelBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  cancelBtnLabel: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  emptyDesc: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, borderWidth: 1, padding: 14, marginBottom: 10 },
  checkCircle: { padding: 2 },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 10, textAlign: 'center' },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 6, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 14 },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  iconOption: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
