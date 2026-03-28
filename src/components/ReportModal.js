import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Image,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { API_URL } from '../config';

export default function ReportModal({ visible, onClose, question, chalkyResponse }) {
  const [details, setDetails]       = useState('');
  const [screenshot, setScreenshot] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);

  const reset = () => {
    setDetails('');
    setScreenshot(null);
    setSubmitting(false);
    setSubmitted(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const pickScreenshot = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to upload a screenshot.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.7,
      base64: true,
    });
    if (!result.canceled) setScreenshot(result.assets[0]);
  };

  const takeScreenshot = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow camera access to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      base64: true,
    });
    if (!result.canceled) setScreenshot(result.assets[0]);
  };

  const submitReport = async () => {
    setSubmitting(true);
    try {
      await fetch(`${API_URL}/api/reports/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          chalkyResponse,
          details,
          screenshotBase64: screenshot?.base64
            ? `data:image/jpeg;base64,${screenshot.base64}`
            : null,
        }),
      });
      setSubmitted(true);
      setTimeout(() => {
        handleClose();
      }, 2000);
    } catch {
      Alert.alert('Error', 'Could not submit report. Try again.');
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={handleClose} />

      <View style={styles.sheet}>
        <View style={styles.handle} />

        {submitted ? (
          <View style={styles.successWrap}>
            <Text style={styles.successIcon}>✓</Text>
            <Text style={styles.successText}>Report submitted. We'll look into it.</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>Report a Problem</Text>
            <Text style={styles.subtitle}>Help us improve Chalky's answers</Text>

            <Text style={styles.label}>Question asked</Text>
            <View style={styles.questionBox}>
              <Text style={styles.questionText} numberOfLines={3}>{question}</Text>
            </View>

            <Text style={styles.label}>
              What went wrong?<Text style={styles.optional}> (optional)</Text>
            </Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Wrong player stats, missing data, wrong game..."
              placeholderTextColor="#555555"
              value={details}
              onChangeText={setDetails}
              multiline
              numberOfLines={3}
            />

            <Text style={styles.label}>
              Screenshot<Text style={styles.optional}> (recommended)</Text>
            </Text>

            {screenshot ? (
              <View style={styles.imgWrap}>
                <Image source={{ uri: screenshot.uri }} style={styles.preview} resizeMode="cover" />
                <TouchableOpacity style={styles.removeImg} onPress={() => setScreenshot(null)}>
                  <Text style={styles.removeImgText}>✕ Remove</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.imgBtns}>
                <TouchableOpacity style={styles.imgBtn} onPress={pickScreenshot}>
                  <Text style={styles.imgBtnText}>📁  Upload Screenshot</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.imgBtn} onPress={takeScreenshot}>
                  <Text style={styles.imgBtnText}>📷  Take Photo</Text>
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity
              style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
              onPress={submitReport}
              disabled={submitting}
              activeOpacity={0.85}
            >
              <Text style={styles.submitText}>{submitting ? 'Sending...' : 'Submit Report'}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: '#0f0f0f',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: '#1e1e1e',
    padding: 24,
    paddingBottom: 48,
    maxHeight: '85%',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#3a3a3a',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    color: '#F5F5F0',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 6,
  },
  subtitle: {
    color: '#888888',
    fontSize: 13,
    marginBottom: 24,
  },
  label: {
    color: '#888888',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 16,
  },
  optional: {
    color: '#444444',
    fontWeight: '400',
    textTransform: 'none',
    letterSpacing: 0,
  },
  questionBox: {
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    borderRadius: 8,
    padding: 12,
  },
  questionText: {
    color: '#888888',
    fontSize: 13,
    lineHeight: 20,
  },
  input: {
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    borderRadius: 8,
    padding: 12,
    color: '#F5F5F0',
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  imgBtns: {
    flexDirection: 'row',
    gap: 12,
  },
  imgBtn: {
    flex: 1,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  imgBtnText: {
    color: '#888888',
    fontSize: 13,
    fontWeight: '500',
  },
  imgWrap: {
    position: 'relative',
  },
  preview: {
    width: '100%',
    height: 180,
    borderRadius: 8,
    backgroundColor: '#141414',
  },
  removeImg: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  removeImgText: {
    color: '#F5F5F0',
    fontSize: 11,
    fontWeight: '600',
  },
  submitBtn: {
    backgroundColor: '#00E87A',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 28,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitText: {
    color: '#080808',
    fontSize: 15,
    fontWeight: '700',
  },
  cancelBtn: {
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  cancelText: {
    color: '#3a3a3a',
    fontSize: 14,
  },
  successWrap: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  successIcon: {
    fontSize: 48,
    color: '#00E87A',
    marginBottom: 16,
  },
  successText: {
    color: '#888888',
    fontSize: 15,
    textAlign: 'center',
  },
});
