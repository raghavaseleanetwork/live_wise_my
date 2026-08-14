import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Image,
  Pressable,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme-context';
import { useAuth } from '@/lib/auth-context';
import { getApiUrl, apiRequest } from '@/lib/query-client';
import { io, Socket } from 'socket.io-client';
import { format, isSameDay, isToday, isYesterday } from 'date-fns';
import { BlurView } from 'expo-blur';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Animated, { useAnimatedStyle, withTiming, useSharedValue, interpolate, FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LoadingIndicator } from '@/components/PremiumLoader';
import { useTranslation } from 'react-i18next';

export default function ChatScreen() {
  const { id: ticketId } = useLocalSearchParams();
  const { colors: theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, token } = useAuth();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const [message, setMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isAdminTyping, setIsAdminTyping] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const flatListRef = useRef<FlatList>(null);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return '#10B981';
      case 'in_progress': return '#F59E0B';
      case 'closed': return '#ef4444';
      default: return '#6B7280';
    }
  };

  // Fetch Ticket Data
  const { data: ticket, isLoading: isTicketLoading } = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await fetch(`${baseUrl}/api/support/tickets/${ticketId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch ticket');
      return res.json();
    },
    enabled: !!token && !!ticketId,
  });

  // Fetch Message History
  const { data: messages, isLoading: isMessagesLoading } = useQuery({
    queryKey: ['messages', ticketId],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await fetch(`${baseUrl}/api/support/tickets/${ticketId}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch messages');
      
      try {
        await apiRequest('POST', `/api/tickets-read/${ticketId}`, undefined, token);
      } catch (e) {
        console.error('Failed to mark read:', e);
      }
      
      return res.json();
    },
    enabled: !!token && !!ticketId,
  });

  const isClosed = ticket?.status === 'closed';

  // Socket setup
  useEffect(() => {
    if (!token || !ticketId || !user || isClosed) return;

    const baseUrl = getApiUrl();
    const socket = io(baseUrl, {
      auth: { token },
      transports: ['websocket'],
    });

    socketRef.current = socket;
    socket.emit('join-ticket', ticketId);

    socket.on('new-message', (newMessage: any) => {
      queryClient.setQueryData(['messages', ticketId], (old: any) => {
        const list = old || [];
        if (list.some((m: any) => m._id === newMessage._id)) return list;
        return [...list, newMessage];
      });
      
      if (newMessage.senderType !== 'user') {
        socket.emit('message-delivered', { ticketId, messageId: newMessage._id });
        socket.emit('message-read', { ticketId, messageId: newMessage._id });
      }
      
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    });

    socket.on('message-status-update', (data: { messageId: string, status: string }) => {
      queryClient.setQueryData(['messages', ticketId], (old: any) => {
        if (!old) return old;
        return old.map((m: any) => 
          m._id === data.messageId ? { ...m, status: data.status } : m
        );
      });
    });

    socket.on('typing-status', (data: any) => {
      if (data.senderType === 'admin') {
        setIsAdminTyping(data.isTyping);
      }
    });

    socket.on('ticket-status-update', (data: { ticketId: string, status: string }) => {
      queryClient.setQueryData(['ticket', ticketId], (old: any) => {
        if (!old) return old;
        return { ...old, status: data.status };
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [ticketId, token, user, queryClient, isClosed]);

  const handleSend = () => {
    if (!message.trim() || !socketRef.current || !user || isClosed) return;

    socketRef.current.emit('send-message', {
      ticketId,
      userId: user.id || (user as any)._id,
      content: message,
      senderType: 'user',
    });

    setMessage('');
    socketRef.current.emit('typing', { ticketId, userId: user.id || (user as any)._id, isTyping: false, senderType: 'user' });
    setIsTyping(false);
  };

  const handleTyping = (text: string) => {
    if (isClosed) return;
    setMessage(text);
    if (!socketRef.current || !user) return;

    const currentUserId = user.id || (user as any)._id;

    if (!isTyping && text.length > 0) {
      setIsTyping(true);
      socketRef.current.emit('typing', { ticketId, userId: currentUserId, isTyping: true, senderType: 'user' });
    } else if (isTyping && text.length === 0) {
      setIsTyping(false);
      socketRef.current.emit('typing', { ticketId, userId: currentUserId, isTyping: false, senderType: 'user' });
    }
  };

  const groupedMessages = useMemo(() => {
    if (!messages) return [];
    const groups: any[] = [];
    let lastDate: Date | null = null;

    messages.forEach((msg: any) => {
      const msgDate = new Date(msg.createdAt);
      if (!lastDate || !isSameDay(msgDate, lastDate)) {
        groups.push({ type: 'date', date: msgDate, id: `date-${msg.createdAt}` });
      }
      groups.push({ ...msg, type: 'message' });
      lastDate = msgDate;
    });

    return groups;
  }, [messages]);

  const renderStatus = (status: string) => {
    if (status === 'sent') return <Ionicons name="checkmark" size={14} color="rgba(255,255,255,0.6)" />;
    if (status === 'delivered') return <Ionicons name="checkmark-done" size={14} color="rgba(255,255,255,0.6)" />;
    if (status === 'read') return <Ionicons name="checkmark-done" size={14} color="#38BDF8" />;
    return null;
  };

  const renderItem = ({ item }: { item: any }) => {
    if (item.type === 'date') {
      let dateText = format(item.date, 'MMMM d, yyyy');
      if (isToday(item.date)) dateText = t('supportChat.today');
      else if (isYesterday(item.date)) dateText = t('supportChat.yesterday');

      return (
        <View style={styles.dateHeader}>
          <View style={[styles.dateLine, { backgroundColor: theme.border }]} />
          <Text style={[styles.dateText, { color: theme.textSecondary, backgroundColor: theme.bg }]}>
            {dateText}
          </Text>
        </View>
      );
    }

    const isMe = item.senderType === 'user';
    
    return (
      <View style={[styles.messageRow, isMe ? styles.myMessageRow : styles.otherMessageRow]}>
        {!isMe && (
          <View style={[styles.avatar, { backgroundColor: theme.accent }]}>
            <Text style={styles.avatarText}>A</Text>
          </View>
        )}
        <View style={[
          styles.messageBubble,
          isMe 
            ? { backgroundColor: theme.accent, borderBottomRightRadius: 4 } 
            : { backgroundColor: theme.card, borderBottomLeftRadius: 4, borderColor: theme.border, borderWidth: 1 }
        ]}>
          <Text style={[styles.messageText, { color: isMe ? '#FFF' : theme.text }]}>
            {item.content}
          </Text>
          <View style={styles.messageFooter}>
            <Text style={[styles.messageTime, { color: isMe ? 'rgba(255,255,255,0.7)' : theme.textSecondary }]}>
              {format(new Date(item.createdAt), 'h:mm a')}
            </Text>
            {isMe && <View style={styles.statusIcon}>{renderStatus(item.status || 'sent')}</View>}
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <BlurView intensity={isDark ? 40 : 80} style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => router.back()} style={[styles.circleButton, { backgroundColor: theme.card + '50' }]}>
            <Ionicons name="chevron-back" size={24} color={theme.text} />
          </TouchableOpacity>
          <View style={styles.headerInfo}>
            <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
              {ticket?.subject || t('supportChat.supportChatTitle')}
            </Text>
            <View style={styles.headerBadgeRow}>
              <View style={[styles.statusDot, { backgroundColor: getStatusColor(ticket?.status || 'active') }]} />
              <Text style={[styles.headerStatusText, { color: theme.textSecondary }]}>
                {ticket?.status === 'active' ? t('support.statusActive') : (() => { const s = ticket?.status.replace('_', ' ') || ''; return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); })()} • {t('supportChat.idLabel')}: {String(ticketId).slice(-6).toUpperCase()}
              </Text>
            </View>
          </View>
          <TouchableOpacity 
            onPress={() => setShowDetails(!showDetails)}
            style={[styles.circleButton, { backgroundColor: showDetails ? theme.accent + '20' : theme.card + '50' }]}
          >
            <Ionicons name={showDetails ? "information-circle" : "information-circle-outline"} size={24} color={showDetails ? theme.accent : theme.textSecondary} />
          </TouchableOpacity>
        </View>

        {showDetails && (
          <Animated.View entering={FadeIn.duration(300)} style={[styles.detailsPanel, { borderTopColor: theme.border }]}>
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>{t('supportChat.createdLabel')}</Text>
              <Text style={[styles.detailValue, { color: theme.text }]}>
                {ticket?.createdAt ? format(new Date(ticket.createdAt), 'MMM d, yyyy') : t('common.loading')}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>{t('supportChat.categoryLabel')}</Text>
              <Text style={[styles.detailValue, { color: theme.text }]}>{ticket?.category || t('support.categoryGeneral')}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>{t('supportChat.descriptionLabel')}</Text>
              <Text style={[styles.detailValue, { color: theme.text }]} numberOfLines={2}>
                {ticket?.description}
              </Text>
            </View>
          </Animated.View>
        )}
      </BlurView>

      {isClosed && (
        <View style={[styles.closedBanner, { backgroundColor: theme.danger + '15', borderColor: theme.danger + '30' }]}>
          <Ionicons name="lock-closed" size={18} color={theme.danger} />
          <Text style={[styles.closedText, { color: theme.danger }]}>
            {t('supportChat.closedBanner')}
          </Text>
        </View>
      )}

      {(isMessagesLoading || isTicketLoading) ? (
        <View style={styles.centerContainer}>
          <LoadingIndicator size="large" color={theme.accent} />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={groupedMessages}
          renderItem={renderItem}
          keyExtractor={(item) => item.id || item._id}
          contentContainerStyle={[
            styles.messageList, 
            { paddingBottom: insets.bottom + (isClosed ? 20 : 100) }
          ]}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
          showsVerticalScrollIndicator={false}
        />
      )}

      {!isClosed && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          <BlurView intensity={100} tint={isDark ? 'dark' : 'light'} style={[styles.inputContainer, { borderTopColor: theme.border, paddingBottom: Math.max(insets.bottom, 16) }]}>
            {isAdminTyping && (
              <View style={styles.typingIndicator}>
                <Text style={[styles.typingText, { color: theme.accent }]}>{t('supportChat.adminTyping')}</Text>
              </View>
            )}
            <View style={styles.inputRow}>
              <TouchableOpacity style={[styles.attachButton, { backgroundColor: theme.border + '30' }]}>
                <Ionicons name="add-outline" size={28} color={theme.textSecondary} />
              </TouchableOpacity>
              <TextInput
                style={[styles.input, { backgroundColor: theme.card, color: theme.text, borderColor: theme.border }]}
                placeholder={t('supportChat.messagePlaceholder')}
                placeholderTextColor={theme.textSecondary + '80'}
                value={message}
                onChangeText={handleTyping}
                multiline
              />
              <TouchableOpacity 
                style={[styles.sendButton, { backgroundColor: theme.accent }, !message.trim() && { opacity: 0.5 }]}
                onPress={handleSend}
                disabled={!message.trim()}
              >
                <Ionicons name="arrow-up" size={24} color="#FFF" />
              </TouchableOpacity>
            </View>
          </BlurView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingBottom: 16,
    paddingHorizontal: 16,
    zIndex: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(150,150,150,0.2)',
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  circleButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerInfo: {
    flex: 1,
    marginLeft: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  headerBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  headerStatusText: {
    fontSize: 11,
    fontWeight: '600',
    opacity: 0.6,
  },
  detailsPanel: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  detailValue: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
    marginLeft: 20,
  },
  closedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderBottomWidth: 1,
    gap: 8,
  },
  closedText: {
    fontSize: 13,
    fontWeight: '600',
  },
  messageList: {
    padding: 16,
    paddingTop: 20,
  },
  dateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 24,
  },
  dateLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    opacity: 0.2,
  },
  dateText: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 12,
    letterSpacing: 0.5,
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: 8,
    maxWidth: '82%',
  },
  myMessageRow: {
    alignSelf: 'flex-end',
  },
  otherMessageRow: {
    alignSelf: 'flex-start',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    alignSelf: 'flex-end',
    marginBottom: 8,
  },
  avatarText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  messageBubble: {
    padding: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  messageTime: {
    fontSize: 10,
    marginRight: 4,
  },
  statusIcon: {
    marginLeft: 2,
  },
  typingIndicator: {
    position: 'absolute',
    top: -24,
    left: 20,
  },
  typingText: {
    fontSize: 12,
    fontWeight: '600',
    fontStyle: 'italic',
  },
  inputContainer: {
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  attachButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 10,
    fontSize: 16,
    borderWidth: 1,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
