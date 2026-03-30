import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useUser } from '@clerk/clerk-expo';
import * as ImagePicker from 'expo-image-picker';
import { API_URL } from '../config';

export default function SupportSuggestionsScreen({ navigation }) {
  const { user } = useUser();
  const [activeTab, setActiveTab] = useState('support');
  const [message, setMessage] = useState('');
  const [screenshot, setScreenshot] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to attach a screenshot.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets?.[0]) {
      setScreenshot(result.assets[0]);
    }
  };

  const handleSubmit = async () => {
    if (!message.trim()) {
      Alert.alert('', 'Please enter a message before submitting.');
      return;
    }
    setSubmitting(true);
    try {
      await fetch(`${API_URL}/api/reports/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: activeTab,
          message: message.trim(),
          userEmail: user?.primaryEmailAddress?.emailAddress,
          userId: user?.id,
          screenshotBase64: screenshot?.base64 ? `data:image/jpeg;base64,${screenshot.base64}` : null,
        }),
      });
      setSubmitted(true);
      setMessage('');
      setScreenshot(null);
      setTimeout(() => setSubmitted(false), 3000);
    } catch (err) {
      Alert.alert('Error', 'Could not submit. Please try again.');
    }
    setSubmitting(false);
  };

  const switchTab = (tab) => {
    setActiveTab(tab);
    setSubmitted(false);
    setMessage('');
    setScreenshot(null);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={22} color="#F5F5F0" />
            </TouchableOpacity>
            <Text style={styles.title}>Support & Suggestions</Text>
          </View>

          {/* Tab switcher */}
          <View style={styles.tabRow}>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'support' && styles.tabActive]}
              onPress={() => switchTab('support')}
            >
              <Ionicons name="construct-outline" size={16} color={activeTab === 'support' ? '#F5F5F0' : '#888888'} />
              <Text style={[styles.tabText, activeTab === 'support' && styles.tabTextActive]}>Support</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'suggestion' && styles.tabActive]}
              onPress={() => switchTab('suggestion')}
            >
              <Ionicons name="bulb-outline" size={16} color={activeTab === 'suggestion' ? '#F5F5F0' : '#888888'} />
              <Text style={[styles.tabText, activeTab === 'suggestion' && styles.tabTextActive]}>Suggestions</Text>
            </TouchableOpacity>
          </View>

          {/* Content */}
          <View style={styles.content}>
            <View style={styles.infoCard}>
              <Ionicons
                name={activeTab === 'support' ? 'construct' : 'bulb'}
                size={28}
                color="#00E87A"
                style={styles.infoIcon}
              />
              <Text style={styles.infoTitle}>
                {activeTab === 'support' ? 'Having a problem?' : 'Got an idea?'}
              </Text>
              <Text style={styles.infoBody}>
                {activeTab === 'support'
                  ? 'Report any issues, bugs, or errors you encounter in the app. Tell us what happened and we will look into it as soon as possible.'
                  : 'We want to hear what you would like to see in Chalky. New features, improvements, sports, bet types — anything. The best ideas come from the people using the app.'}
              </Text>
            </View>

            <Text style={styles.inputLabel}>
              {activeTab === 'support' ? 'Describe the issue' : 'Share your idea'}
            </Text>
            <TextInput
              style={styles.textArea}
              placeholder={
                activeTab === 'support'
                  ? 'What went wrong? What were you doing when it happened?...'
                  : 'What would make Chalky better for you?...'
              }
              placeholderTextColor="#3a3a3a"
              value={message}
              onChangeText={setMessage}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              maxLength={1000}
            />
            <Text style={styles.charCount}>{message.length}/1000</Text>

            {/* Screenshot picker */}
            <Text style={styles.inputLabel}>Screenshot (optional)</Text>
            {screenshot ? (
              <View style={styles.screenshotPreview}>
                <Image source={{ uri: screenshot.uri }} style={styles.screenshotImage} resizeMode="cover" />
                <TouchableOpacity style={styles.screenshotRemove} onPress={() => setScreenshot(null)}>
                  <Ionicons name="close-circle" size={24} color="#FF4444" />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.screenshotBtn} onPress={pickImage} activeOpacity={0.75}>
                <Ionicons name="image-outline" size={20} color="#888888" />
                <Text style={styles.screenshotBtnText}>Attach Screenshot</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Submit */}
          {submitted ? (
            <View style={styles.successRow}>
              <Ionicons name="checkmark-circle" size={20} color="#00E87A" />
              <Text style={styles.successText}>
                {activeTab === 'support' ? "Report submitted. We'll look into it." : 'Suggestion received. Thank you!'}
              </Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              <Text style={styles.submitText}>
                {submitting ? 'Sending...' : activeTab === 'support' ? 'Submit Report' : 'Send Suggestion'}
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080808' },
  container: { flex: 1, backgroundColor: '#080808' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  backBtn: { padding: 4 },
  title: { color: '#F5F5F0', fontSize: 20, fontWeight: '700' },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    backgroundColor: '#0f0f0f',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    padding: 4,
    marginBottom: 24,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 11,
    borderRadius: 9,
  },
  tabActive: { backgroundColor: '#1a1a1a' },
  tabText: { color: '#888888', fontSize: 14, fontWeight: '500' },
  tabTextActive: { color: '#F5F5F0', fontWeight: '700' },
  content: { paddingHorizontal: 20 },
  infoCard: {
    backgroundColor: '#0f0f0f',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e1e1e',
    padding: 20,
    alignItems: 'center',
    marginBottom: 24,
  },
  infoIcon: { marginBottom: 12 },
  infoTitle: { color: '#F5F5F0', fontSize: 18, fontWeight: '700', marginBottom: 10, textAlign: 'center' },
  infoBody: { color: '#888888', fontSize: 14, lineHeight: 22, textAlign: 'center' },
  inputLabel: {
    color: '#888888',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginLeft: 2,
  },
  textArea: {
    backgroundColor: '#0f0f0f',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    borderRadius: 12,
    padding: 16,
    color: '#F5F5F0',
    fontSize: 15,
    minHeight: 140,
    lineHeight: 22,
  },
  charCount: { color: '#3a3a3a', fontSize: 11, textAlign: 'right', marginTop: 6, marginBottom: 16 },
  screenshotBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0f0f0f',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    borderRadius: 12,
    borderStyle: 'dashed',
    paddingVertical: 16,
    marginBottom: 24,
  },
  screenshotBtnText: { color: '#888888', fontSize: 14, fontWeight: '500' },
  screenshotPreview: {
    position: 'relative',
    marginBottom: 24,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1e1e1e',
  },
  screenshotImage: { width: '100%', height: 180 },
  screenshotRemove: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#080808',
    borderRadius: 12,
  },
  submitBtn: {
    backgroundColor: '#00E87A',
    borderRadius: 12,
    paddingVertical: 16,
    marginHorizontal: 20,
    alignItems: 'center',
    marginBottom: 40,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitText: { color: '#080808', fontSize: 16, fontWeight: '800' },
  successRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 40,
    padding: 16,
    backgroundColor: '#0f0f0f',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#00E87A',
  },
  successText: { color: '#00E87A', fontSize: 14, fontWeight: '600' },
});
