import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  TextInput,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../components/Avatar';

import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { toLocalDateString, calculateAge, BLOOD_GROUPS, BloodGroup } from '@/lib/data';
import FeatureSelector from '@/components/FeatureSelector';
import { FamilyFeatureKey, saveMemberFeatures } from '@/lib/family-features';
import { useSubscription } from '@/lib/subscription-context';
import { usePaywall } from '@/lib/paywall-context';

const RELATIONSHIPS = [
  { key: 'self', labelKey: 'familyMember.relationshipSelf', icon: 'person' },
  { key: 'spouse', labelKey: 'familyMember.relationshipSpouse', icon: 'heart' },
  { key: 'child', labelKey: 'familyMember.relationshipChild', icon: 'happy' },
  { key: 'parent', labelKey: 'familyMember.relationshipParent', icon: 'people' },
  { key: 'sibling', labelKey: 'familyMember.relationshipSibling', icon: 'people-circle' },
  { key: 'other', labelKey: 'familyMember.relationshipOther', icon: 'ellipsis-horizontal' },
];

export default function AddFamilyMemberScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const { token } = useAuth();
  const { checkLimit } = useSubscription();
  const { presentPaywall } = usePaywall();

  // Form State
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [otherRelationship, setOtherRelationship] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // New features
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dobDate, setDobDate] = useState(new Date(2000, 0, 1));
  const [bloodGroup, setBloodGroup] = useState<BloodGroup | ''>('');
  const [showBloodGroupPicker, setShowBloodGroupPicker] = useState(false);
  // Starts empty: the user picks what to manage, and `handleSave` already
  // rejects an empty selection rather than silently defaulting one on.
  const [selectedFeatures, setSelectedFeatures] = useState<FamilyFeatureKey[]>([]);
  const [showCaregiverHint, setShowCaregiverHint] = useState(false);

  const toggleFeature = (key: FamilyFeatureKey) => {
    setSelectedFeatures((prev) => {
      // Turning a module OFF is always allowed.
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      // Turning one ON is gated by the plan's modules-per-member limit
      // (doc §5.1 — "4th module on Free" → paywall).
      const check = checkLimit('modulesPerMember', prev.length);
      if (!check.allowed && check.triggerKey) {
        presentPaywall(check.triggerKey);
        return prev;
      }
      return [...prev, key];
    });
  };

  const handleSelectRelationship = (rel: string) => {
    setRelationship(rel);
    // Caregiver logic: parents get Emergency Alerts + Call & Check-in
    // auto-enabled, since these are the features that matter most for
    // keeping tabs on an aging parent's wellbeing.
    if (rel === 'parent') {
      setSelectedFeatures((prev) => {
        const additions: FamilyFeatureKey[] = ['emergency', 'checkin'];
        const missing = additions.filter((k) => !prev.includes(k));
        if (missing.length === 0) return prev;
        return [...prev, ...missing];
      });
      setShowCaregiverHint(true);
    } else {
      setShowCaregiverHint(false);
    }
    if (rel !== 'other') {
      setOtherRelationship('');
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t('familyMember.errorEnterName'));
      return;
    }
    if (!relationship) {
      setError(t('familyMember.errorSelectRelationship'));
      return;
    }
    if (relationship === 'other' && !otherRelationship.trim()) {
      setError(t('familyMember.errorSpecifyRelationship'));
      return;
    }
    if (selectedFeatures.length === 0) {
      setError(t('familyMember.errorSelectFeature'));
      return;
    }
    if (!token) return;

    const relationshipToSave = relationship === 'other' ? otherRelationship.trim() : relationship;

    setIsSaving(true);
    try {
      const res = await apiRequest(
        'POST',
        '/api/family',
        {
          name: name.trim(),
          relationship: relationshipToSave,
          avatarUrl,
          dateOfBirth,
          bloodGroup: bloodGroup || null,
          features: selectedFeatures,
        },
        token
      );
      if (res.ok) {
        // Persist features locally, keyed by the new member's id, so the
        // dashboard reflects the selection even though GET /api/family does
        // not yet return the `features` field (see Phase 5 backend doc).
        try {
          const created = await res.json();
          if (created?.id) await saveMemberFeatures(String(created.id), selectedFeatures);
        } catch {
          // Response body parse failed — not fatal; features still went to server.
        }
        // Not router.back(): if this screen was ever pushed twice (e.g. a
        // double-tap on the + button before the modal transition finished),
        // "back" pops to the OTHER copy of this same screen instead of
        // Family Hub — which read as "saving does nothing, I'm still here."
        // Navigating to the destination explicitly is correct regardless of
        // how many copies are on the stack.
        router.replace('/family');
      } else {
        setError(t('familyMember.errorAddFailed'));
      }
    } catch (e) {
      console.error('Add family member error:', e);
      setError(t('familyMember.errorUnexpected'));
    } finally {
      setIsSaving(false);
    }
  };

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0].uri) {
        uploadImage(result.assets[0].uri);
      }
    } catch (e) {
      console.error('Pick image error:', e);
      setError(t('familyMember.errorPickImage'));
    }
  };

  const uploadImage = async (uri: string) => {
    // Show local preview immediately — looks responsive
    setAvatarUrl(uri);
    if (!token) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      const filename = uri.split('/').pop() || 'avatar.jpg';
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `image/${match[1]}` : `image/jpeg`;
      formData.append('file', { uri, name: filename, type } as any);

      const apiBase = getApiUrl();
      console.log('[Upload] Uploading to:', `${apiBase}/api/upload`);

      const res = await fetch(`${apiBase}/api/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = await res.json();
        setAvatarUrl(data.url); // Replace preview with permanent S3 URL
        console.log('[Upload] Success:', data.url);
      } else {
        const text = await res.text();
        console.error('[Upload] Server error:', res.status, text.slice(0, 200));
        // Keep local preview — member can still be saved with local URI
        // (will work as long as caches persist; for permanent storage S3 is needed)
        if (!res.ok) setError(t('familyMember.errorUploadFailed', { status: res.status }));
      }
    } catch (e) {
      console.error('[Upload] Exception:', e);
      // Keep local URI as avatar, don't block the user
    } finally {
      setIsUploading(false);
    }
  };

  const headerHeight = 150 + insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined} 
        style={{ flex: 1 }}
      >
        <ScrollView 
          showsVerticalScrollIndicator={false} 
          contentContainerStyle={{ paddingBottom: insets.bottom + 140 }}
        >
          {/* Header */}
          <LinearGradient
            colors={colors.heroGradient as any}
            style={[styles.header, { height: headerHeight, paddingTop: insets.top + 36 }]}
          >
            <View style={styles.headerTop}>
              <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={15}>
                <Ionicons name="chevron-back" size={24} color={colors.text} />
              </Pressable>
              <Text style={[styles.headerTitle, { color: colors.text }]}>{t('familyMember.addTitle')}</Text>
            </View>

            <View style={styles.headerContent}>
              <View style={styles.avatarSection}>
                <Pressable onPress={pickImage} style={styles.avatarContainer}>
                  <Avatar name={name || 'New Member'} uri={avatarUrl} size={88} />
                  <View style={[styles.editIconBtn, { backgroundColor: colors.accent }]}>
                    <Ionicons name="camera" size={16} color="#FFF" />
                  </View>
                  {isUploading && (
                    <View style={styles.uploadOverlay}>
                      <Text style={styles.uploadText}>...</Text>
                    </View>
                  )}
                </Pressable>
              </View>

              <View style={styles.headerNameBlock}>
                <Text style={[styles.contextLabel, { color: colors.textSecondary }]}>
                  {t('familyMember.enterMemberDetails')} <Text style={{ color: colors.danger }}>*</Text>
                </Text>
                <TextInput
                  style={[styles.nameInput, { color: colors.text }]}
                  value={name}
                  onChangeText={setName}
                  placeholder={t('familyMember.namePlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                />
                <View style={[styles.nameUnderline, { backgroundColor: colors.accent }]} />
              </View>
            </View>
          </LinearGradient>

          <View style={styles.form}>
            {error ? (
              <Animated.View entering={FadeInDown} style={[styles.errorBox, { backgroundColor: colors.dangerDim }]}>
                <Ionicons name="alert-circle" size={18} color={colors.danger} />
                <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
              </Animated.View>
            ) : null}

            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('familyMember.relationship')} <Text style={{ color: colors.danger }}>*</Text>
            </Text>
            <View style={styles.relGrid}>
              {RELATIONSHIPS.map((rel) => {
                const isSelected = relationship === rel.key;
                return (
                  <Pressable
                    key={rel.key}
                    onPress={() => handleSelectRelationship(rel.key)}
                    style={[
                      styles.relCard,
                      { backgroundColor: colors.card, borderColor: colors.border },
                      isSelected && { borderColor: colors.accent, backgroundColor: colors.accentDim },
                    ]}
                  >
                    <Ionicons name={rel.icon as any} size={20} color={isSelected ? colors.accent : colors.textTertiary} />
                    <Text style={[styles.relLabel, { color: isSelected ? colors.accent : colors.textSecondary }]}>{t(rel.labelKey)}</Text>
                    {isSelected && (
                      <View style={[styles.checkWrap]}>
                        <Ionicons name="checkmark-circle" size={14} color={colors.accent} />
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>

            {relationship === 'other' && (
              <Animated.View entering={FadeInDown}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  {t('familyMember.specifyRelationship')} <Text style={{ color: colors.danger }}>*</Text>
                </Text>
                <View style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.card, marginBottom: 12 }]}>
                  <Ionicons name="create-outline" size={18} color={colors.textSecondary} />
                  <TextInput
                    style={{ flex: 1, color: colors.text, fontFamily: 'Inter_500Medium' }}
                    value={otherRelationship}
                    onChangeText={setOtherRelationship}
                    placeholder={t('familyMember.specifyRelationshipPlaceholder')}
                    placeholderTextColor={colors.textTertiary}
                  />
                </View>
              </Animated.View>
            )}

            {showCaregiverHint && (
              <Animated.View entering={FadeInDown} style={[styles.infoCard, { backgroundColor: colors.accentDim + '30', borderColor: colors.accent + '30', marginTop: 0, marginBottom: 12 }]}>
                <Ionicons name="shield-checkmark-outline" size={20} color={colors.accent} />
                <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                  {t('familyMember.caregiverHintPrefix')} <Text style={{ fontFamily: 'Inter_700Bold' }}>{t('familyMember.caregiverHintFeature1')}</Text> {t('familyMember.caregiverHintMid')} <Text style={{ fontFamily: 'Inter_700Bold' }}>{t('familyMember.caregiverHintFeature2')}</Text> {t('familyMember.caregiverHintSuffix')}
                </Text>
              </Animated.View>
            )}

            <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('familyMember.dateOfBirth')}</Text>
            <Pressable
              onPress={() => setShowDatePicker(true)}
              style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.card, marginBottom: 14 }]}
            >
              <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
              <Text style={{ flex: 1, color: dateOfBirth ? colors.text : colors.textTertiary, fontFamily: 'Inter_500Medium' }}>
                {dateOfBirth || t('familyMember.selectBirthday')}
              </Text>
            </Pressable>

            {showDatePicker && (
              <DateTimePicker
                value={dobDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                maximumDate={new Date()}
                themeVariant={isDark ? 'dark' : 'light'}
                onChange={(event, date) => {
                  setShowDatePicker(false);
                  if (date) {
                    setDobDate(date);
                    setDateOfBirth(toLocalDateString(date));
                  }
                }}
              />
            )}

            <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('familyMember.age')}</Text>
            <View style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.card, marginBottom: 14 }]}>
              <Ionicons name="hourglass-outline" size={18} color={colors.textSecondary} />
              <Text style={{ flex: 1, color: dateOfBirth ? colors.text : colors.textTertiary, fontFamily: 'Inter_500Medium' }} numberOfLines={1}>
                {(() => {
                  const age = calculateAge(dateOfBirth);
                  return age === null ? t('familyMember.agePlaceholder') : t('familyMember.ageYears', { count: age });
                })()}
              </Text>
            </View>

            <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('familyMember.bloodGroup')}</Text>
            <Pressable
              onPress={() => setShowBloodGroupPicker(true)}
              style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.card, marginBottom: 14 }]}
            >
              <Ionicons name="water-outline" size={18} color={colors.textSecondary} />
              <Text style={{ flex: 1, color: bloodGroup ? colors.text : colors.textTertiary, fontFamily: 'Inter_500Medium' }}>
                {bloodGroup || t('familyMember.selectBloodGroup')}
              </Text>
            </Pressable>

            {showBloodGroupPicker && (
              <Animated.View entering={FadeInDown} style={styles.bloodGroupGrid}>
                {BLOOD_GROUPS.map((bg) => {
                  const isSelected = bloodGroup === bg;
                  return (
                    <Pressable
                      key={bg}
                      onPress={() => {
                        setBloodGroup(bg);
                        setShowBloodGroupPicker(false);
                      }}
                      style={[
                        styles.bloodGroupChip,
                        { backgroundColor: colors.card, borderColor: colors.border },
                        isSelected && { borderColor: colors.accent, backgroundColor: colors.accentDim },
                      ]}
                    >
                      <Text style={[styles.bloodGroupChipText, { color: isSelected ? colors.accent : colors.textSecondary }]}>{bg}</Text>
                    </Pressable>
                  );
                })}
              </Animated.View>
            )}

            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t('familyMember.selectWhatToManage')} <Text style={{ color: colors.danger }}>*</Text>
            </Text>
            <Text style={[styles.sectionHint, { color: colors.textTertiary }]}>
              {t('familyMember.selectWhatToManageHint', { name: name.trim() || t('familyMember.thisMember') })}
            </Text>
            <FeatureSelector selected={selectedFeatures} onToggle={toggleFeature} />

            <View style={[styles.infoCard, { backgroundColor: colors.accentDim + '30', borderColor: colors.accent + '30' }]}>
               <Ionicons name="information-circle-outline" size={20} color={colors.accent} />
               <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                 {t('familyMember.medicineTrackingInfo')}
               </Text>
            </View>
          </View>
        </ScrollView>

        {/* Footer Save */}
        <View style={[
          styles.footer, 
          { 
            backgroundColor: colors.bg, 
            paddingBottom: Math.max(insets.bottom, 20) + 4,
            borderTopColor: colors.border,
            borderTopWidth: 1,
          }
        ]}>
          <Pressable onPress={handleSave} disabled={isSaving} style={styles.saveBtn}>
            <LinearGradient
              colors={colors.buttonGradient as any}
              style={styles.saveGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Ionicons name="person-add-outline" size={24} color="#FFF" />
              <Text style={styles.saveBtnText}>{isSaving ? t('familyMember.addingMember') : t('familyMember.addMemberButton')}</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    justifyContent: 'center',
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    height: 44,
    marginBottom: 0,
  },
  backBtn: {
    position: 'absolute',
    left: 0,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  headerTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    textAlign: 'center',
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 16,
  },
  avatarSection: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarContainer: {
    position: 'relative',
    padding: 2,
    borderRadius: 50,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  editIconBtn: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFF',
  },
  uploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadText: {
    color: '#FFF',
    fontFamily: 'Inter_700Bold',
  },
  headerNameBlock: {
    flex: 1,
    justifyContent: 'center',
  },
  contextLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    marginBottom: 2,
    opacity: 0.9,
  },
  nameInput: {
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
    paddingVertical: 4,
    letterSpacing: -0.5,
  },
  nameUnderline: {
    height: 3,
    width: 60,
    borderRadius: 2,
    marginTop: 2,
  },
  form: {
    paddingTop: 28,
    paddingHorizontal: 20,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 16,
    marginBottom: 20,
  },
  errorText: {
    marginLeft: 8,
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    marginBottom: 6,
    marginTop: 0,
    letterSpacing: 0,
  },
  sectionHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
  },
  relGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 10,
    columnGap: 10,
    marginBottom: 14,
  },
  relCard: {
    // Three per row with the 10px columnGap between them. `space-between` is
    // deliberately not used: with cards narrower than a third of the row it
    // spreads the leftover width between columns and overrides the gap.
    flexBasis: '31%',
    flexGrow: 1,
    borderRadius: 16,
    borderWidth: 1.5,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 8,
    position: 'relative',
  },
  relLabel: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  checkWrap: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  infoCard: {
    marginTop: 24,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
  },
  infoText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 20,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  saveBtn: {
    height: 62,
    borderRadius: 16,
    overflow: 'hidden',
  },
  saveGradient: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  saveBtnText: {
    color: '#FFF',
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  bloodGroupGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 10,
    columnGap: 10,
    marginTop: -4,
    marginBottom: 14,
  },
  bloodGroupChip: {
    flexBasis: '22%',
    flexGrow: 1,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingVertical: 12,
    alignItems: 'center',
  },
  bloodGroupChipText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
  },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 8,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
  },
  featureInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  featureLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  divider: {
    height: 1,
    marginHorizontal: 12,
    opacity: 0.3,
  },
});
