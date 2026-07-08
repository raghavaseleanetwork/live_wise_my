import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Switch, Image, ActivityIndicator } from 'react-native';
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
          showAlert({ title: 'File Too Large', message: 'Maximum file size is 5MB.' });
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
      showAlert({ title: 'Required Fields', message: 'Please enter a subject and description.' });
      return;
    }

    setIsSubmitting(true);
    try {
      const baseUrl = getApiUrl();
      const formData = new FormData();
      formData.append('subject', subject);
      formData.append('category', category);
      formData.append('description', description);
      
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

      if (!res.ok) throw new Error('Failed to create ticket');

      queryClient.invalidateQueries({ queryKey: ['support-tickets'] });

      showAlert({
        title: 'Ticket Created',
        type: 'success',
        message: 'Your support ticket has been submitted. We will get back to you soon!',
        buttons: [{ 
          text: 'OK', 
          onPress: () => {
            router.replace('/support');
          } 
        }]
      });
    } catch (err) {
      console.error('Create ticket error:', err);
      showAlert({ title: 'Error', message: 'Could not create ticket. Please try again.' });
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
        <Text style={[styles.headerTitle, { color: theme.text }]}>New Ticket</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>Subject</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.card, color: theme.text, borderColor: theme.border }]}
            placeholder="What's the problem?"
            placeholderTextColor={theme.textSecondary + '80'}
            value={subject}
            onChangeText={setSubject}
          />
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>Category</Text>
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
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>Description</Text>
          <TextInput
            style={[styles.textArea, { backgroundColor: theme.card, color: theme.text, borderColor: theme.border }]}
            placeholder="Please provide details about your issue..."
            placeholderTextColor={theme.textSecondary + '80'}
            multiline
            numberOfLines={6}
            value={description}
            onChangeText={setDescription}
            textAlignVertical="top"
          />
        </View>

        <View style={styles.section}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>Attachments (Optional)</Text>
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
                  Upload Image or PDF (Max 5MB)
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
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <Text style={styles.submitButtonText}>Submit Ticket</Text>
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
    textTransform: 'uppercase',
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
