/**
 * VerifyEmailScreen — 6-digit code verification after email sign up.
 * Six individual boxes that auto-advance on each digit.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSignUp } from '@clerk/clerk-expo';
import { Ionicons } from '@expo/vector-icons';

export default function VerifyEmailScreen({ navigation, route }) {
  const { email } = route.params ?? {};
  const { signUp, setActive, isLoaded } = useSignUp();

  const [digits, setDigits]     = useState(['', '', '', '', '', '']);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [resendCountdown, setResendCountdown] = useState(30);
  const refs = [useRef(), useRef(), useRef(), useRef(), useRef(), useRef()];

  // Countdown timer for resend
  useEffect(() => {
    if (resendCountdown <= 0) return;
    const t = setTimeout(() => setResendCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCountdown]);

  // Auto-focus first box on mount
  useEffect(() => {
    setTimeout(() => refs[0].current?.focus(), 400);
  }, []);

  const handleDigit = (text, index) => {
    const cleaned = text.replace(/[^0-9]/g, '').slice(-1);
    const next = [...digits];
    next[index] = cleaned;
    setDigits(next);
    if (cleaned && index < 5) {
      refs[index + 1].current?.focus();
    }
    // Auto-submit when all filled
    if (cleaned && index === 5) {
      const code = [...next].join('');
      if (code.length === 6) submit(code);
    }
  };

  const handleKeyPress = (e, index) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
      refs[index - 1].current?.focus();
    }
  };

  const submit = async (code) => {
    if (!isLoaded) return;
    setLoading(true);
    setError('');
    try {
      const result = await signUp.attemptEmailAddressVerification({ code });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
      } else {
        setError('Verification incomplete. Please try again.');
      }
    } catch (e) {
      setError('Invalid code. Try again.');
      setDigits(['', '', '', '', '', '']);
      setTimeout(() => refs[0].current?.focus(), 100);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = () => {
    const code = digits.join('');
    if (code.length < 6) { setError('Enter all 6 digits.'); return; }
    submit(code);
  };

  const handleResend = async () => {
    if (resendCountdown > 0 || !isLoaded) return;
    try {
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setResendCountdown(30);
      setError('');
      setDigits(['', '', '', '', '', '']);
      setTimeout(() => refs[0].current?.focus(), 100);
    } catch (e) {
      setError('Could not resend code.');
    }
  };

  const isFilled = digits.every(d => d !== '');

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>

        {/* Back */}
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.6}>
          <Ionicons name="arrow-back" size={22} color="#888888" />
        </TouchableOpacity>

        <View style={s.content}>
          <Text style={s.headline}>Check your email</Text>
          <Text style={s.sub}>
            We sent a 6-digit code to{'\n'}
            <Text style={s.emailHighlight}>{email}</Text>
          </Text>

          {/* 6 boxes */}
          <View style={s.boxRow}>
            {digits.map((d, i) => (
              <TextInput
                key={i}
                ref={refs[i]}
                style={[s.box, d && s.boxFilled]}
                value={d}
                onChangeText={(t) => handleDigit(t, i)}
                onKeyPress={(e) => handleKeyPress(e, i)}
                keyboardType="number-pad"
                maxLength={1}
                textAlign="center"
                selectTextOnFocus
              />
            ))}
          </View>

          {error ? <Text style={s.error}>{error}</Text> : null}

          {/* Verify button */}
          <TouchableOpacity
            style={[s.ctaBtn, (!isFilled || loading) && s.ctaDisabled]}
            onPress={handleVerify}
            disabled={!isFilled || loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#080808" size="small" />
              : <Text style={s.ctaTxt}>Verify Email</Text>}
          </TouchableOpacity>

          {/* Resend */}
          <TouchableOpacity
            style={s.resendBtn}
            onPress={handleResend}
            disabled={resendCountdown > 0}
            activeOpacity={0.7}
          >
            <Text style={[s.resendTxt, resendCountdown > 0 && s.resendDisabled]}>
              {resendCountdown > 0
                ? `Resend code in ${resendCountdown}s`
                : 'Resend code'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080808' },
  flex: { flex: 1 },

  backBtn: {
    paddingHorizontal: 28,
    paddingTop: 16,
    paddingBottom: 8,
    alignSelf: 'flex-start',
  },

  content: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 40,
    gap: 0,
  },

  headline: {
    fontSize: 28,
    fontWeight: '800',
    color: '#F5F5F0',
    marginBottom: 12,
    letterSpacing: -0.4,
  },
  sub: {
    fontSize: 14,
    color: '#555555',
    lineHeight: 22,
    marginBottom: 40,
  },
  emailHighlight: {
    color: '#F5F5F0',
    fontWeight: '600',
  },

  // 6-box input
  boxRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
    justifyContent: 'center',
  },
  box: {
    width: 46,
    height: 58,
    backgroundColor: '#0f0f0f',
    borderWidth: 1,
    borderColor: '#1e1e1e',
    borderRadius: 12,
    fontSize: 24,
    fontWeight: '700',
    color: '#F5F5F0',
  },
  boxFilled: {
    borderColor: '#00E87A',
  },

  error: {
    color: '#FF4444',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 18,
  },

  ctaBtn: {
    backgroundColor: '#00E87A',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  ctaDisabled: { opacity: 0.4 },
  ctaTxt: { fontSize: 15, fontWeight: '700', color: '#080808', letterSpacing: 0.3 },

  resendBtn: { alignItems: 'center', paddingVertical: 8 },
  resendTxt: { fontSize: 13, color: '#555555' },
  resendDisabled: { color: '#333333' },
});
