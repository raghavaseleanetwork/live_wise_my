import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ScrollView, Pressable, Dimensions, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme-context';
import { BlurView } from 'expo-blur';
import { useQuery } from '@tanstack/react-query';
import { getApiUrl } from '@/lib/query-client';
import { useAuth } from '@/lib/auth-context';
import { format } from 'date-fns';
import { LinearGradient } from 'expo-linear-gradient';
import { FAQ_DATA } from '@/constants/faq';
import Animated, { useAnimatedStyle, withTiming, useSharedValue, interpolate, Extrapolate, withRepeat, withSequence } from 'react-native-reanimated';

const { width } = Dimensions.get('window');

function SkeletonTicket() {
  const { colors: theme } = useTheme();
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.7, { duration: 800 }),
        withTiming(0.3, { duration: 800 })
      ),
      -1,
      true
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <View style={[styles.ticketCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Animated.View style={animatedStyle}>
        <View style={[styles.skeletonLine, { width: '60%', backgroundColor: theme.border, height: 14 }]} />
        <View style={[styles.skeletonLine, { width: '100%', height: 12, marginTop: 12, backgroundColor: theme.border }]} />
        <View style={[styles.skeletonRow, { marginTop: 16 }]}>
          <View style={[styles.skeletonLine, { width: 60, height: 20, borderRadius: 6, backgroundColor: theme.border }]} />
          <View style={[styles.skeletonLine, { width: 60, height: 20, borderRadius: 6, backgroundColor: theme.border }]} />
        </View>
      </Animated.View>
    </View>
  );
}

function FAQItem({ item, isOpen, onPress }: { item: any, isOpen: boolean, onPress: () => void }) {
  const { colors: theme } = useTheme();
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withTiming(isOpen ? 1 : 0, { duration: 250 });
  }, [isOpen]);

  const arrowStyle = useAnimatedStyle(() => {
    return {
      transform: [{ rotate: `${interpolate(rotation.value, [0, 1], [0, 180])}deg` }]
    };
  });

  return (
    <View style={[styles.faqCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Pressable onPress={onPress} style={styles.faqHeader}>
        <Text style={[styles.faqQuestion, { color: theme.text }]}>{item.question}</Text>
        <Animated.View style={arrowStyle}>
          <Ionicons name="chevron-down" size={18} color={theme.textSecondary} />
        </Animated.View>
      </Pressable>
      
      {isOpen && (
        <View style={styles.faqAnswerContainer}>
          <Text style={[styles.faqAnswer, { color: theme.textSecondary }]}>
            {item.answer}
          </Text>
        </View>
      )}
    </View>
  );
}

export default function SupportScreen() {
  const { colors: theme } = useTheme();
  const router = useRouter();
  const { token } = useAuth();
  
  const [activeTab, setActiveTab] = useState<'faq' | 'tickets'>('faq');
  const [openFaqId, setOpenFaqId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const { data: tickets, isLoading, refetch } = useQuery({
    queryKey: ['support-tickets', search, filterStatus, sortOrder],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (filterStatus && filterStatus !== 'all') params.append('status', filterStatus);
      if (sortOrder) params.append('sort', sortOrder);
      
      const res = await fetch(`${baseUrl}/api/support/tickets?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch tickets');
      return res.json();
    },
    enabled: !!token,
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return '#10B981';
      case 'in_progress': return '#F59E0B';
      case 'closed': return '#ef4444';
      default: return '#6B7280';
    }
  };

  const renderTicket = ({ item }: { item: any }) => (
    <TouchableOpacity
      activeOpacity={0.7}
      style={[styles.ticketCard, { backgroundColor: theme.card, borderColor: theme.border }]}
      onPress={() => router.push(`/support/chat/${item._id}` as any)}
    >
      <View style={styles.ticketHeader}>
        <View style={styles.ticketTitleRow}>
          <View style={[styles.statusIndicator, { backgroundColor: getStatusColor(item.status) }]} />
          <Text style={[styles.ticketSubject, { color: theme.text }]} numberOfLines={1}>
            {item.subject}
          </Text>
        </View>
        <Text style={[styles.ticketTime, { color: theme.textSecondary }]}>
          {format(new Date(item.lastMessageAt), 'MMM d, h:mm a')}
        </Text>
      </View>
      
      <View style={styles.messagePreviewRow}>
        <Text style={[styles.ticketLastMsg, { color: theme.textSecondary }]} numberOfLines={1}>
          {item.lastMessage?.senderType === 'admin' ? 'Support: ' : 'You: '}
          {item.lastMessage?.content || item.description}
        </Text>
        {item.lastMessage?.status === 'read' && item.lastMessage?.senderType === 'user' && (
          <Ionicons name="checkmark-done" size={14} color="#38BDF8" style={{ marginLeft: 4 }} />
        )}
      </View>

      <View style={styles.ticketBadgeRow}>
        <View style={[styles.categoryBadge, { backgroundColor: theme.accent + '10' }]}>
          <Text style={[styles.categoryText, { color: theme.accent }]}>{item.category || 'General'}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) + '15' }]}>
          <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
            {item.status === 'active' ? 'Active' : item.status.replace('_', ' ').charAt(0).toUpperCase() + item.status.replace('_', ' ').slice(1)}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <LinearGradient
        colors={[theme.accent + '15', 'transparent']}
        style={styles.headerGradient}
      />
      
      <View style={styles.header}>
        <View>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Help Center</Text>
          <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]}>
            How can we help you today?
          </Text>
        </View>
        <TouchableOpacity 
          style={[styles.addButton, { backgroundColor: theme.accent }]}
          onPress={() => router.push('/support/create')}
        >
          <Ionicons name="add" size={28} color="#FFF" />
        </TouchableOpacity>
      </View>

      <View style={styles.tabContainer}>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'faq' && { borderBottomColor: theme.accent, borderBottomWidth: 3 }]}
          onPress={() => setActiveTab('faq')}
        >
          <Text style={[styles.tabText, { color: activeTab === 'faq' ? theme.text : theme.textSecondary }]}>FAQs</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'tickets' && { borderBottomColor: theme.accent, borderBottomWidth: 3 }]}
          onPress={() => setActiveTab('tickets')}
        >
          <Text style={[styles.tabText, { color: activeTab === 'tickets' ? theme.text : theme.textSecondary }]}>My Tickets</Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'faq' ? (
        <ScrollView 
          contentContainerStyle={styles.faqContent} 
          showsVerticalScrollIndicator={false}
        >
          {FAQ_DATA.map((category, catIdx) => (
            <View key={catIdx} style={styles.faqSection}>
              <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>{category.category}</Text>
              {category.questions.map((q) => (
                <FAQItem 
                  key={q.id} 
                  item={q} 
                  isOpen={openFaqId === q.id} 
                  onPress={() => setOpenFaqId(openFaqId === q.id ? null : q.id)}
                />
              ))}
            </View>
          ))}
          
          <View style={[styles.contactCard, { backgroundColor: theme.accent + '10', borderColor: theme.accent + '30' }]}>
            <Ionicons name="help-circle-outline" size={32} color={theme.accent} />
            <Text style={[styles.contactTitle, { color: theme.text }]}>Still have questions?</Text>
            <Text style={[styles.contactDesc, { color: theme.textSecondary }]}>
              Our support team is available 24/7 to help you with any issues.
            </Text>
            <TouchableOpacity 
              style={[styles.contactButton, { backgroundColor: theme.accent }]}
              onPress={() => router.push('/support/create')}
            >
              <Text style={styles.contactButtonText}>Contact Support</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      ) : (
        <View style={styles.flex1}>
          <View style={styles.searchContainer}>
            <View style={[styles.searchBar, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Ionicons name="search-outline" size={20} color={theme.textSecondary} />
              <TextInput
                style={[styles.searchInput, { color: theme.text }]}
                placeholder="Search ticket, ID, or message..."
                placeholderTextColor={theme.textSecondary + '70'}
                value={search}
                onChangeText={setSearch}
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch('')}>
                  <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity 
              style={[styles.sortButton, { backgroundColor: theme.card, borderColor: theme.border }]}
              onPress={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
            >
              <Ionicons name={sortOrder === 'desc' ? "arrow-down" : "arrow-up"} size={20} color={theme.accent} />
            </TouchableOpacity>
          </View>

          <View style={styles.filterWrapper}>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false} 
              style={styles.filterScroll}
              contentContainerStyle={styles.filterContent}
            >
              {['all', 'active', 'in_progress', 'closed'].map((status) => (
                <TouchableOpacity
                  key={status}
                  onPress={() => setFilterStatus(status)}
                  style={[
                    styles.filterChip,
                    { backgroundColor: theme.card, borderColor: theme.border },
                    filterStatus === status && { backgroundColor: theme.accent, borderColor: theme.accent }
                  ]}
                >
                  <Text style={[
                    styles.filterChipText,
                    { color: theme.textSecondary },
                    filterStatus === status && { color: '#FFF' }
                  ]}>
                    {status === 'all' ? 'All Tickets' : status === 'active' ? 'Active' : status.replace('_', ' ').charAt(0).toUpperCase() + status.replace('_', ' ').slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {isLoading ? (
            <View style={styles.ticketList}>
              {[1, 2, 3].map(i => <SkeletonTicket key={i} />)}
            </View>
          ) : tickets?.length === 0 ? (
            <View style={styles.centerContainer}>
              <View style={[styles.emptyIconContainer, { backgroundColor: theme.card }]}>
                <Ionicons name="search-outline" size={48} color={theme.textSecondary} style={{ opacity: 0.3 }} />
              </View>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>No tickets found</Text>
              <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
                Try adjusting your search or filters to find what you're looking for.
              </Text>
            </View>
          ) : (
            <FlatList
              data={tickets}
              renderItem={renderTicket}
              keyExtractor={(item) => item._id}
              contentContainerStyle={styles.ticketList}
              showsVerticalScrollIndicator={false}
              onRefresh={refetch}
              refreshing={isLoading}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex1: {
    flex: 1,
  },
  headerGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 300,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 15,
    marginTop: 4,
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(150,150,150,0.1)',
  },
  tab: {
    paddingVertical: 12,
    marginRight: 24,
    paddingHorizontal: 4,
  },
  tabText: {
    fontSize: 16,
    fontWeight: '600',
  },
  faqContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  faqSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 12,
    marginLeft: 4,
  },
  faqCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
  },
  faqHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  faqQuestion: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    marginRight: 10,
  },
  faqAnswerContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(150,150,150,0.1)',
  },
  faqAnswer: {
    fontSize: 14,
    lineHeight: 22,
  },
  ticketList: {
    padding: 20,
    paddingTop: 10,
  },
  ticketCard: {
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
  },
  ticketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  ticketTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  statusIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 8,
  },
  ticketSubject: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  ticketTime: {
    fontSize: 11,
    fontWeight: '600',
    opacity: 0.6,
  },
  messagePreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  ticketLastMsg: {
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  ticketBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  searchContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 16,
    gap: 12,
  },
  searchBar: {
    flex: 1,
    height: 50,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 15,
  },
  sortButton: {
    width: 50,
    height: 50,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  filterWrapper: {
    marginBottom: 16,
  },
  filterScroll: {
    maxHeight: 46,
  },
  filterContent: {
    paddingHorizontal: 20,
    gap: 10,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    minWidth: 80,
    alignItems: 'center',
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  skeletonLine: {
    height: 10,
    borderRadius: 5,
  },
  skeletonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  emptyIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(150,150,150,0.1)',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingBottom: 100,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  contactCard: {
    padding: 24,
    borderRadius: 24,
    alignItems: 'center',
    borderWidth: 1,
    marginTop: 20,
  },
  contactTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 12,
  },
  contactDesc: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
    lineHeight: 20,
  },
  contactButton: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 14,
  },
  contactButtonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
