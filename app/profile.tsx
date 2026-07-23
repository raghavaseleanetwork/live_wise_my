import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TextInput, Pressable, Platform, Image, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import * as ImagePicker from 'expo-image-picker';
import { uploadAvatar } from '@/lib/upload-avatar';
import DateTimePicker from '@react-native-community/datetimepicker';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, token, updateProfile } = useAuth();
  const { colors, isDark } = useTheme();

  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [email, setEmail] = useState(user?.email || '');
  const [dateOfBirth, setDateOfBirth] = useState((user as any)?.dateOfBirth || '');
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [error, setError] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>((user as any)?.avatarUrl || null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dobDate, setDobDate] = useState<Date>(
    (user as any)?.dateOfBirth ? new Date((user as any).dateOfBirth) : new Date(2000, 0, 1)
  );

  useEffect(() => {
    setName(user?.name || '');
    setPhone(user?.phone || '');
    setEmail(user?.email || '');
    setDateOfBirth((user as any)?.dateOfBirth || '');
    setAvatarUrl((user as any)?.avatarUrl || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const topInset = Platform.OS === 'web' ? 67 : insets.top;

  const handleSave = async () => {
    setError('');
    setSaving(true);
    const res = await updateProfile({
      name: name.trim() || user?.name || '',
      phone: phone.trim() || null,
      email: email.trim() || user?.email || '',
      dateOfBirth: dateOfBirth.trim() || null,
      avatarUrl: avatarUrl || null,
    });
    setSaving(false);
    if (!res.success) {
      setError(res.error || 'Failed to update profile');
    } else if (router.canGoBack()) {
      router.back();
    }
  };

  const handlePickAvatar = async () => {
    setError('');
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Media permission is required to pick an avatar');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets || !result.assets[0]) return;
    if (!user || !token) return;

    const previousAvatarUrl = avatarUrl;
    const asset = result.assets[0];
    setUploadingAvatar(true);
    try {
      const url = await uploadAvatar(token, asset.uri, asset.fileSize);
      const res = await updateProfile({ avatarUrl: url });
      if (!res.success) {
        throw new Error(res.error || 'Failed to save avatar');
      }
      setAvatarUrl(url);
    } catch (e: any) {
      setAvatarUrl(previousAvatarUrl);
      console.error('[Avatar] Upload Error:', e);
      setError(e.message || 'Upload failed. Please try again.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { paddingTop: topInset + 12 }]}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))} hitSlop={10}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Edit Profile</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.headerCard, { backgroundColor: colors.accentDim }]}>
          <Pressable
            onPress={handlePickAvatar}
            disabled={uploadingAvatar}
            style={[styles.avatarCircle, { backgroundColor: '#FFFFFF' }]}
          >
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
            ) : (
              <Ionicons name="person" size={34} color={colors.accent} />
            )}
            {uploadingAvatar && (
              <View style={styles.avatarUploadingOverlay}>
                <ActivityIndicator color="#FFFFFF" />
              </View>
            )}
            <View style={[styles.avatarEditBadge, { backgroundColor: colors.accent }]}>
              <Ionicons name="camera" size={14} color="#FFFFFF" />
            </View>
          </Pressable>
          <View style={styles.headerTextWrap}>
            <Text style={[styles.headerName, { color: colors.text }]}>
              {name || user?.name || 'Your name'}
            </Text>
            <View style={styles.emailRow}>
              <Text style={[styles.emailValue, { color: colors.textSecondary }]} numberOfLines={1}>
                {user?.email}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.body}>
          <View style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Full Name</Text>
            <View style={[styles.inputRow, { borderColor: colors.inputBorder, backgroundColor: colors.inputBg }]}>
              <Ionicons name="person-outline" size={18} color={colors.textTertiary} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                placeholderTextColor={colors.textTertiary}
              />
            </View>

            <Text style={[styles.label, { color: colors.textSecondary, marginTop: 14 }]}>Mobile Number</Text>
            <View style={[styles.inputRow, { borderColor: colors.inputBorder, backgroundColor: colors.inputBg }]}>
              <Ionicons name="call-outline" size={18} color={colors.textTertiary} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                value={phone}
                onChangeText={setPhone}
                placeholder="Add phone number"
                placeholderTextColor={colors.textTertiary}
                keyboardType="phone-pad"
              />
            </View>

            <Text style={[styles.label, { color: colors.textSecondary, marginTop: 14 }]}>Email</Text>
            <View style={[styles.inputRow, { borderColor: colors.border + '40', backgroundColor: colors.inputBg, opacity: 0.7 }]}>
              <Ionicons name="mail-outline" size={18} color={colors.textTertiary} />
              <TextInput
                style={[styles.input, { color: colors.textTertiary }]}
                value={email}
                editable={false}
                placeholder="Add email"
                placeholderTextColor={colors.textTertiary}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <Ionicons name="checkmark-circle" size={16} color={colors.accent} />
            </View>

            <Text style={[styles.label, { color: colors.textSecondary, marginTop: 14 }]}>Date of Birth</Text>
            <Pressable
              onPress={() => {
                if (Platform.OS === 'android' && showDatePicker) {
                  setShowDatePicker(false);
                  setTimeout(() => setShowDatePicker(true), 0);
                } else {
                  setShowDatePicker(true);
                }
              }}
              style={[styles.inputRow, { borderColor: colors.inputBorder, backgroundColor: colors.inputBg }]}
            >
              <Ionicons name="calendar-outline" size={18} color={colors.textTertiary} />
              <Text style={[styles.input, { color: dateOfBirth ? colors.text : colors.textTertiary, height: 'auto', paddingVertical: 12 }]}>
                {dateOfBirth || "Select Date of Birth"}
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
                  if (Platform.OS === 'android') {
                    setShowDatePicker(false);
                    if (event.type === 'dismissed') return;
                  }
                  if (date) {
                    setDobDate(date);
                    setDateOfBirth(date.toISOString().split('T')[0]);
                  }
                }}
              />
            )}

            {!!error && (
              <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
            )}

            <Pressable
              onPress={handleSave}
              disabled={saving}
              style={[styles.saveBtn, { backgroundColor: colors.accent }]}
            >
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save Changes'}</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
  },
  headerCard: {
    marginHorizontal: 20,
    marginTop: 8,
    borderRadius: 24,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  headerTextWrap: { flex: 1, gap: 6 },
  headerName: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    marginBottom: 20,
  },
  fieldCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
  },
  avatarCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 32,
  },
  avatarUploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  emailLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  emailValue: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    flexShrink: 1,
    maxWidth: '78%',
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
    minHeight: 44,
    gap: 8,
  },
  input: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    paddingVertical: 0,
    height: 20,
  },
  errorText: {
    marginTop: 10,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  saveBtn: {
    marginTop: 20,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 19,
    includeFontPadding: false,
  },
});

