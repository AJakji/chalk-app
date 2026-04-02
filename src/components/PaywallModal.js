import { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import Purchases from 'react-native-purchases';
import { colors } from '../theme';

const PLAN_LABELS = {
  monthly:     { name: "Chalky's Crew",  suffix: '/mo'   },
  three_month: { name: '3-Month Pass',   suffix: '/3 mo' },
  six_month:   { name: '6-Month Pass',   suffix: '/6 mo' },
  yearly:      { name: 'Annual Pass',    suffix: '/yr'   },
  lifetime:    { name: 'Lifetime',       suffix: ''      },
};

export default function PaywallModal({ visible, onClose }) {
  const [offerings, setOfferings]   = useState(null);
  const [purchasing, setPurchasing] = useState(false);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    if (!visible) return;

    (async () => {
      setLoading(true);
      try {
        const result = await Purchases.getOfferings();
        if (result.current) setOfferings(result.current);
      } catch (err) {
        console.error('[PaywallModal] getOfferings error:', err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [visible]);

  const handlePurchase = async (pkg) => {
    setPurchasing(true);
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      if (customerInfo.entitlements.active['crew']) {
        Alert.alert(
          "Welcome to Chalky's Crew! 🎉",
          "You now have full access to all of Chalky's premium picks.",
          [{ text: "Let's Go", onPress: onClose }]
        );
      }
    } catch (err) {
      if (!err.userCancelled) {
        Alert.alert('Purchase Failed', err.message || 'Something went wrong. Please try again.');
      }
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    setPurchasing(true);
    try {
      const customerInfo = await Purchases.restorePurchases();
      if (customerInfo.entitlements.active['crew']) {
        Alert.alert("Restored!", "Your Chalky's Crew access has been restored.", [
          { text: 'Done', onPress: onClose },
        ]);
      } else {
        Alert.alert('No purchases found', 'No active subscription found for this Apple ID.');
      }
    } catch (err) {
      Alert.alert('Restore Failed', err.message);
    } finally {
      setPurchasing(false);
    }
  };

  const packages = offerings?.availablePackages ?? [];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Chalky's Crew</Text>
          <Text style={styles.subtitle}>AI picks. No noise. Full access.</Text>
        </View>

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {loading ? (
            <ActivityIndicator size="large" color={colors.green} style={{ marginTop: 40 }} />
          ) : packages.length === 0 ? (
            <Text style={styles.emptyText}>No plans available. Check back soon.</Text>
          ) : (
            packages.map((pkg) => {
              const label = PLAN_LABELS[pkg.identifier] || { name: pkg.identifier, suffix: '' };
              const isFeatured = pkg.identifier === 'monthly';
              return (
                <TouchableOpacity
                  key={pkg.identifier}
                  style={[styles.card, isFeatured && styles.cardFeatured]}
                  onPress={() => handlePurchase(pkg)}
                  disabled={purchasing}
                  activeOpacity={0.85}
                >
                  {isFeatured && <Text style={styles.badge}>MOST POPULAR</Text>}
                  <Text style={[styles.planName, isFeatured && styles.planNameFeatured]}>
                    {label.name}
                  </Text>
                  <Text style={styles.price}>
                    {pkg.product.priceString}
                    <Text style={styles.priceSuffix}>{label.suffix}</Text>
                  </Text>
                </TouchableOpacity>
              );
            })
          )}

          {purchasing && (
            <ActivityIndicator size="small" color={colors.green} style={{ marginTop: 16 }} />
          )}

          <TouchableOpacity style={styles.restoreBtn} onPress={handleRestore} disabled={purchasing}>
            <Text style={styles.restoreText}>Restore purchases</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: colors.background },
  header:          { alignItems: 'center', paddingTop: 24, paddingHorizontal: 24, paddingBottom: 16 },
  closeBtn:        { position: 'absolute', top: 24, right: 24, padding: 8 },
  closeText:       { color: colors.grey, fontSize: 18 },
  title:           { fontSize: 28, fontWeight: '800', color: colors.offWhite, letterSpacing: -0.5, marginBottom: 6 },
  subtitle:        { fontSize: 15, color: colors.grey },
  body:            { paddingHorizontal: 24, paddingBottom: 40 },
  card:            { backgroundColor: '#1a1a1a', borderRadius: 14, padding: 20, marginBottom: 12, borderWidth: 1, borderColor: '#2a2a2a' },
  cardFeatured:    { borderColor: colors.green, borderWidth: 2 },
  badge:           { fontSize: 10, fontWeight: '700', color: colors.green, letterSpacing: 1, marginBottom: 8 },
  planName:        { fontSize: 18, fontWeight: '700', color: colors.offWhite, marginBottom: 4 },
  planNameFeatured:{ color: colors.green },
  price:           { fontSize: 22, fontWeight: '800', color: colors.offWhite },
  priceSuffix:     { fontSize: 14, fontWeight: '400', color: colors.grey },
  emptyText:       { color: colors.grey, textAlign: 'center', marginTop: 40 },
  restoreBtn:      { marginTop: 24, alignItems: 'center', padding: 12 },
  restoreText:     { color: colors.grey, fontSize: 13 },
});
