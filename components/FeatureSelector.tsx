import React from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme-context';
import { FAMILY_FEATURES, FamilyFeatureKey } from '@/lib/family-features';

interface FeatureSelectorProps {
  selected: FamilyFeatureKey[];
  onToggle: (key: FamilyFeatureKey) => void;
}

/**
 * Multi-select grid of all 15 Family Hub features. Tapping a card toggles it
 * on/off. Used by both the Add and Edit family member screens.
 */
export default function FeatureSelector({ selected, onToggle }: FeatureSelectorProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.grid}>
      {FAMILY_FEATURES.map((feature) => {
        const isOn = selected.includes(feature.key);
        return (
          <Pressable
            key={feature.key}
            onPress={() => onToggle(feature.key)}
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border },
              isOn && { borderColor: colors.accent, backgroundColor: colors.accentDim },
            ]}
          >
            <View style={styles.cardTop}>
              <View style={[styles.iconWrap, { backgroundColor: isOn ? colors.accent + '22' : colors.inputBg }]}>
                <Ionicons name={feature.icon as any} size={20} color={isOn ? colors.accent : colors.textTertiary} />
              </View>
              <View
                style={[
                  styles.checkDot,
                  { borderColor: colors.border },
                  isOn && { backgroundColor: colors.accent, borderColor: colors.accent },
                ]}
              >
                {isOn && <Ionicons name="checkmark" size={12} color="#FFF" />}
              </View>
            </View>
            <Text style={[styles.label, { color: colors.text }]} numberOfLines={1}>
              {feature.label}
            </Text>
            <Text style={[styles.desc, { color: colors.textTertiary }]} numberOfLines={2}>
              {feature.description}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  card: {
    width: '48%',
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 14,
    minHeight: 110,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    marginBottom: 3,
  },
  desc: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 15,
  },
});
