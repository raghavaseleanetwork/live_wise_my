import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { getApiUrl } from '@/lib/query-client';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useAlert } from '@/lib/alert-context';
import { useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { LoadingIndicator } from '@/components/PremiumLoader';
import { useTranslation } from 'react-i18next';

const CATEGORIES = [
  { label: 'Technical Issue', value: 'technical' },
  { label: 'Billing & Payment', value: 'billing' },
  { label: 'App Error/Bug', value: 'bug' },
  { label: 'Account Problem', value: 'account' },
  { label: 'General Inquiry', value: 'general' },
  { label: 'Feature Request', value: 'feature' },
];

export default function CreateTicketScreen() {
  const { colors: theme } = useTheme();
  const router = useRouter();
  const { token } = useAuth();
  const { showAlert } = useAlert();
  const { t } = useTranslation();

  const CATEGORY_LABELS: Record<string, string> = {
    technical: t('supportCreate.categoryTechnical'),
    billing: t('supportCreate.categoryBilling'),
    bug: t('supportCreate.categoryBug'),
    account: t('supportCreate.categoryAccount'),
    general: t('supportCreate.categoryGeneral'),
    feature: t('supportCreate.categoryFeature'),
  };

  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0].value);
  const [description, setDescription] = useState('');
  const [media, setMedia] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const queryClient = useQueryClient();

  const pickMedia = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf'],
        copyToCacheDirectory: true,
      });

      if (!result.canceled) {
        const asset = result.assets[0];
        if (asset.size && asset.size > 5 * 1024 * 1024) {
          showAlert({ title: t('supportCreate.fileTooLargeTitle'), message: t('supportCreate.fileTooLargeMessage') });
          return;
        }
        setMedia(asset);
      }
    } catch (err) {
      console.error('Pick media error:', err);
    }
  };

  const handleSubmit = async () => {
    if (!subject.trim() || !description.trim()) {
      showAlert({ title: t('supportCreate.requiredFieldsTitle'), message: t('supportCreate.requiredFieldsMessage') });
      return;
    }

    // Mirrors the server's SupportTicketSchema (subject min 3, description min 10)
    // so the user is told what's wrong here instead of getting a 400 back.
    if (subject.trim().length < 3) {
      showAlert({ title: t('supportCreate.subjectTooShortTitle'), message: t('supportCreate.subjectTooShortMessage') });
      return;
    }

    if (description.trim().length < 10) {
      showAlert({ title: t('supportCreate.descriptionTooShortTitle'), message: t('supportCreate.descriptionTooShortMessage') });
      return;
    }

    setIsSubmitting(true);
    try {
      const baseUrl = getApiUrl();
      const formData = new FormData();
      formData.append('subject', subject.trim());
      formData.append('category', category);
      formData.append('description', description.trim());
      
      if (media) {
        formData.append('media', {
          uri: media.uri,
          name: media.name,
          type: media.mimeType || 'application/octet-stream',
        } as any);
      }

      const res = await fetch(`${baseUrl}/api/support/tickets`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!res.ok) {
        // The server sends a real reason (validation, auth, upload); keep it
        // instead of collapsing every failure into "please try again".
        const detail = await res.text().catch(() => '');
        let message = '';
        try {
          message = JSON.parse(detail)?.message || '';
        } catch {
          message = '';
        }
        if (res.status === 401 || res.status === 403) {
          throw new Error(t('supportCreate.sessionExpired'));
        }
        throw new Error(message || t('supportCreate.createFailed', { status: res.status }));
      }

      queryClient.invalidateQueries({ queryKey: ['support-tickets'] });

      showAlert({
        title: t('supportCreate.ticketCreatedTitle'),
        type: 'success',
        message: t('supportCreate.ticketCreatedMessage'),
        buttons: [{
          text: t('common.ok'),
          onPress: () => {
            router.replace('/support');
          }
        }]
      });
    } catch (err) {
      console.error('Create ticket error:', err);
      showAlert({
        title: t('supportCreate.errorTitle'),
        message: err instanceof Error && err.message
          ? err.message
          : t('supportCreate.createFailedGeneric'),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <LinearGradient
        colors={[theme.accent + '10', 'transparent']}
        style={styles.headerGradient}
      />
      
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>{t('supportCreate.newTicket')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>{t('supportCreate.subjectLabel')}</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.card, color: theme.text, borderColor: theme.border }]}
            placeholder={t('supportCreate.subjectPlaceholder')}
            placeholderTextColor={theme.textSecondary + '80'}
            value={subject}
            onChangeText={setSubject}
          />
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>{t('supportCreate.categoryLabel')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.value}
                style={[
                  styles.categoryChip,
                  { backgroundColor: theme.card, borderColor: theme.border },
                  category === cat.value && { backgroundColor: theme.accent, borderColor: theme.accent }
                ]}
                onPress={() => setCategory(cat.value)}
              >
                <Text style={[
                  styles.categoryChipText,
                  { color: theme.textSecondary },
                  category === cat.value && { color: '#FFF' }
                ]}>
                  {CATEGORY_LABELS[cat.value] || cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>{t('supportCreate.descriptionLabel')}</Text>
          <TextInput
            style={[styles.textArea, { backgroundColor: theme.card, color: theme.text, borderColor: theme.border }]}
            placeholder={t('supportCreate.descriptionPlaceholder')}
            placeholderTextColor={theme.textSecondary + '80'}
            multiline
            numberOfLines={6}
            value={description}
            onChangeText={setDescription}
            textAlignVertical="top"
          />
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>{t('supportCreate.attachmentsLabel')}</Text>
          <TouchableOpacity
            style={[styles.mediaButton, { backgroundColor: theme.card, borderColor: theme.border, borderStyle: 'dashed' }]}
            onPress={pickMedia}
          >
            {media ? (
              <View style={styles.mediaSelected}>
                <Ionicons name="document-attach" size={24} color={theme.accent} />
                <Text style={[styles.mediaName, { color: theme.text }]} numberOfLines={1}>
                  {media.name}
                </Text>
                <TouchableOpacity onPress={() => setMedia(null)}>
                  <Ionicons name="close-circle" size={20} color={theme.danger} />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.mediaPlaceholder}>
                <Ionicons name="cloud-upload-outline" size={32} color={theme.textSecondary} />
                <Text style={[styles.mediaPlaceholderText, { color: theme.textSecondary }]}>
                  {t('supportCreate.mediaPlaceholder')}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        <TouchableOpacity
          style={[styles.submitButton, { backgroundColor: theme.accent }, isSubmitting && { opacity: 0.7 }]}
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <LoadingIndicator color="#FFF" />
          ) : (
            <>
              <Text style={styles.submitButtonText}>{t('supportCreate.submitTicket')}</Text>
              <Ionicons name="send" size={18} color="#FFF" style={{ marginLeft: 8 }} />
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 200,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 100,
  },
  section: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    marginLeft: 4,
    letterSpacing: 1,
  },
  input: {
    height: 56,
    borderRadius: 16,
    paddingHorizontal: 16,
    fontSize: 16,
    borderWidth: 1,
  },
  categoryScroll: {
    marginHorizontal: -20,
    paddingHorizontal: 20,
  },
  categoryChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    marginRight: 10,
    borderWidth: 1,
  },
  categoryChipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  textArea: {
    height: 150,
    borderRadius: 16,
    padding: 16,
    fontSize: 16,
    borderWidth: 1,
  },
  mediaButton: {
    height: 100,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  mediaPlaceholder: {
    alignItems: 'center',
  },
  mediaPlaceholderText: {
    fontSize: 14,
    marginTop: 8,
  },
  mediaSelected: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    width: '100%',
  },
  mediaName: {
    flex: 1,
    fontSize: 14,
    marginHorizontal: 12,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: 40,
    borderTopWidth: 1,
  },
  submitButton: {
    height: 56,
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitButtonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
  },
});
