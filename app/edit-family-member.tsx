import React, { useState, useEffect } from 'react';
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
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { useSubscription } from '@/lib/subscription-context';
import { usePaywall } from '@/lib/paywall-context';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { toLocalDateString, fromLocalDateString } from '@/lib/data';
import { Avatar } from '../components/Avatar';
import FeatureSelector from '@/components/FeatureSelector';
import {
  FamilyFeatureKey,
  DEFAULT_FEATURES,
  normalizeFeatures,
  loadMemberFeatures,
  saveMemberFeatures,
} from '@/lib/family-features';
import { LoadingIndicator } from '@/components/PremiumLoader';

const RELATIONSHIPS = [
  { key: 'self', label: 'Self', icon: 'person' },
  { key: 'spouse', label: 'Spouse', icon: 'heart' },
  { key: 'child', label: 'Child', icon: 'happy' },
  { key: 'parent', label: 'Parent', icon: 'people' },
  { key: 'sibling', label: 'Sibling', icon: 'people-circle' },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal' },
];

export default function EditFamilyMemberScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { token } = useAuth();
  const { checkLimit } = useSubscription();
  const { presentPaywall } = usePaywall();

  // Form State
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('other');
  const [otherRelationship, setOtherRelationship] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dobDate, setDobDate] = useState(new Date(2000, 0, 1));
  const [selectedFeatures, setSelectedFeatures] = useState<FamilyFeatureKey[]>([...DEFAULT_FEATURES]);
  const [showCaregiverHint, setShowCaregiverHint] = useState(false);

  const toggleFeature = (key: FamilyFeatureKey) => {
    setSelectedFeatures((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      // Gate turning a module ON by the plan's modules-per-member limit
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
    // Same caregiver logic as Add Family Member: parents get Emergency
    // Alerts + Call & Check-in auto-enabled.
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

  useEffect(() => {
    fetchMember();
  }, [id]);

  const fetchMember = async () => {
    if (!token || !id) return;
    try {
      // In a real app, we might have a GET /api/family/:id 
      // but for now we'll fetch all and find the one.
      const res = await apiRequest('GET', '/api/family', null, token);
      if (res.ok) {
        const data = await res.json();
        const member = data.find((m: any) => m.id === id);
        if (member) {
          setName(member.name);
          const knownKeys = RELATIONSHIPS.map((r) => r.key);
          const rel = member.relationship || 'other';
          if (rel && !knownKeys.includes(rel)) {
            setRelationship('other');
            setOtherRelationship(rel);
          } else {
            setRelationship(rel);
          }
          setAvatarUrl(member.avatarUrl || null);
          if (member.dateOfBirth) {
            // Normalise to a local calendar day: the stored value may be a bare
            // YYYY-MM-DD (which `new Date` would read as UTC) or a full
            // timestamp, and either must show the day the user actually picked.
            const dob = fromLocalDateString(member.dateOfBirth);
            setDateOfBirth(toLocalDateString(dob));
            setDobDate(dob);
          }
          // Prefer locally-stored feature selection (Phase 1 source of truth);
          // fall back to whatever the server returned (legacy boolean shape or
          // new array), normalizing either into the modern key list.
          const local = await loadMemberFeatures(String(id));
          if (local && local.length) {
            setSelectedFeatures(local);
          } else if (member.features) {
            setSelectedFeatures(normalizeFeatures(member.features));
          }
        } else {
          setError('Member not found');
        }
      } else {
        setError('Failed to load member details');
      }
    } catch (e) {
      console.error('Fetch member error:', e);
      setError('An unexpected error occurred.');
    } finally {
      setIsLoading(false);
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
      setError('Failed to pick image');
    }
  };

  const uploadImage = async (uri: string) => {
    // Show local preview immediately
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
        setAvatarUrl(data.url);
        console.log('[Upload] Success:', data.url);
      } else {
        const text = await res.text();
        console.error('[Upload] Server error:', res.status, text.slice(0, 200));
        if (!res.ok) setError(`Upload failed (${res.status}). Avatar saved locally.`);
      }
    } catch (e) {
      console.error('[Upload] Exception:', e);
      // Keep local URI — don't block user
    } finally {
      setIsUploading(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Please enter a name');
      return;
    }
    if (!relationship) {
      setError('Please select a relationship');
      return;
    }
    if (relationship === 'other' && !otherRelationship.trim()) {
      setError('Please specify the relationship');
      return;
    }
    if (selectedFeatures.length === 0) {
      setError('Select at least one feature to manage');
      return;
    }
    if (!token || !id) return;

    const relationshipToSave = relationship === 'other' ? otherRelationship.trim() : relationship;

    setIsSaving(true);
    try {
      const res = await apiRequest(
        'PUT',
        `/api/family/${id}`,
        {
          name: name.trim(),
          relationship: relationshipToSave,
          avatarUrl,
          dateOfBirth,
          features: selectedFeatures,
        },
        token
      );
      if (res.ok) {
        // Keep the local feature store in sync (Phase 1 source of truth).
        await saveMemberFeatures(String(id), selectedFeatures);
        router.back();
      } else {
        setError('Failed to update member. Please try again.');
      }
    } catch (e) {
      console.error('Update family member error:', e);
      setError('An unexpected error occurred.');
    } finally {
      setIsSaving(false);
    }
  };

  const headerHeight = 142 + insets.top;

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }]}>
        <LoadingIndicator size="large" color={colors.accent} />
      </View>
    );
  }

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
            style={[styles.header, { height: headerHeight, paddingTop: insets.top + 20 }]}
          >
            <View style={styles.headerTop}>
              <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={15}>
                <Ionicons name="chevron-back" size={24} color={colors.text} />
              </Pressable>
              <Text style={[styles.headerTitle, { color: colors.text }]}>Edit Member</Text>
            </View>

            <View style={styles.headerContent}>
              <View style={styles.avatarSection}>
                <Pressable onPress={pickImage} style={styles.avatarContainer}>
                  <Avatar name={name || 'Member'} uri={avatarUrl} size={88} />
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
                  Member Name <Text style={{ color: colors.danger }}>*</Text>
                </Text>
                <TextInput
                  style={[styles.nameInput, { color: colors.text }]}
                  value={name}
                  onChangeText={setName}
                  placeholder="Enter Name"
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

            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              Relationship <Text style={{ color: colors.danger }}>*</Text>
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
                    <Text style={[styles.relLabel, { color: isSelected ? colors.accent : colors.textSecondary }]}>{rel.label}</Text>
                    {isSelected && (
                      <View style={styles.checkWrap}>
                        <Ionicons name="checkmark-circle" size={14} color={colors.accent} />
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>

            {relationship === 'other' && (
              <Animated.View entering={FadeInDown}>
                <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                  Specify relationship <Text style={{ color: colors.danger }}>*</Text>
                </Text>
                <View style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.card, marginBottom: 12 }]}>
                  <Ionicons name="create-outline" size={18} color={colors.textSecondary} />
                  <TextInput
                    style={{ flex: 1, color: colors.text, fontFamily: 'Inter_500Medium' }}
                    value={otherRelationship}
                    onChangeText={setOtherRelationship}
                    placeholder="e.g. Grandparent, Friend"
                    placeholderTextColor={colors.textTertiary}
                  />
                </View>
              </Animated.View>
            )}

            {showCaregiverHint && (
              <Animated.View entering={FadeInDown} style={[styles.infoCard, { backgroundColor: colors.accentDim + '30', borderColor: colors.accent + '30', marginTop: 0, marginBottom: 12 }]}>
                <Ionicons name="shield-checkmark-outline" size={20} color={colors.accent} />
                <Text style={[styles.infoText, { color: colors.textSecondary }]}>
                  Since this is a parent, we've turned on <Text style={{ fontFamily: 'Inter_700Bold' }}>Emergency Alerts</Text> and <Text style={{ fontFamily: 'Inter_700Bold' }}>Call & Check-in</Text> below — you can turn them off if you don't need them.
                </Text>
              </Animated.View>
            )}

            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Date of birth</Text>
            <Pressable
              onPress={() => setShowDatePicker(true)}
              style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.card, marginBottom: 12 }]}
            >
              <Ionicons name="calendar-outline" size={18} color={colors.textSecondary} />
              <Text style={{ flex: 1, color: dateOfBirth ? colors.text : colors.textTertiary, fontFamily: 'Inter_500Medium' }}>
                {dateOfBirth || "Select Birthday"}
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

            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              Managed features <Text style={{ color: colors.danger }}>*</Text>
            </Text>
            <Text style={[styles.sectionHint, { color: colors.textTertiary }]}>
              Tap to turn features on or off for {name.trim() || 'this member'}.
            </Text>
            <FeatureSelector selected={selectedFeatures} onToggle={toggleFeature} />
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
              <Ionicons name="checkmark-outline" size={24} color="#FFF" />
              <Text style={styles.saveBtnText}>{isSaving ? 'Saving Changes...' : 'Save Changes'}</Text>
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
    marginBottom: 8,
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
    marginTop: 12,
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
    paddingTop: 24,
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
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    marginBottom: 6,
    marginTop: 8,
    letterSpacing: 1,
  },
  sectionHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 16,
  },
  relGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 10,
    columnGap: 10,
    marginBottom: 12,
  },
  relCard: {
    // Matches Add Family Member — see the note there on why `space-between`
    // is avoided for this grid.
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
