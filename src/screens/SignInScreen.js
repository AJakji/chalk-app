/**
 * SignInScreen — Chalky branded auth screen.
 * Handles both sign-in and sign-up with email + password.
 * Calls /api/users/sync after login to register user in the database.
 */
import React, { useState } from 'react';
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
  ScrollView,
} from 'react-native';
import { useSignIn, useSignUp } from '@clerk/clerk-expo';
import { colors, spacing, radius } from '../theme';
import ChalkyAvatar from '../components/ChalkyAvatar';
import { API_URL } from '../config';

export default function SignInScreen() {
  const { signIn, setActive: setSignInActive, isLoaded: signInLoaded } = useSignIn();
  const { signUp, setActive: setSignUpActive, isLoaded: signUpLoaded } = useSignUp();

  const [mode, setMode] = useState('signin'); // 'signin' | 'signup' | 'verify'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // After a successful auth, sync the user to our database
  async function syncToDatabase(token, displayName, usernameVal) {
    try {
      await fetch(`${API_URL}/api/users/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username: usernameVal, displayName }),
      });
    } catch (e) {
      // Non-fatal — user is still logged in
      console.warn('User sync failed (non-fatal):', e.message);
    }
  }

  async function handleSignIn() {
    if (!signInLoaded) return;
    setLoading(true);
    setError('');
    try {
      const result = await signIn.create({ identifier: email, password });
      if (result.status === 'complete') {
        await setSignInActive({ session: result.createdSessionId });
        // Sync happens via useAuth hook after session is active — no token needed here
      } else {
        setError('Sign in incomplete. Please try again.');
      }
    } catch (e) {
      setError(clerkErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSignUp() {
    if (!signUpLoaded) return;
    setLoading(true);
    setError('');
    try {
      await signUp.create({ emailAddress: email, password, username });
      // Clerk sends a verification email
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setMode('verify');
    } catch (e) {
      setError(clerkErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    if (!signUpLoaded) return;
    setLoading(true);
    setError('');
    try {
      const result = await signUp.attemptEmailAddressVerification({ code });
      if (result.status === 'complete') {
        await setSignUpActive({ session: result.createdSessionId });
      } else {
        setError('Verification incomplete. Try again.');
      }
    } catch (e) {
      setError(clerkErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  // ── Verify email code screen ──────────────────────────────────────────────
  if (mode === 'verify') {
    return (
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.inner}>
            <ChalkyAvatar size={56} showGlow />
            <Text style={styles.title}>Check your email</Text>
            <Text style={styles.subtitle}>
              We sent a 6-digit code to{'\n'}
              <Text style={styles.emailHighlight}>{email}</Text>
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Verification code</Text>
              <TextInput
                style={[styles.input, styles.codeInput]}
                value={code}
                onChangeText={setCode}
                placeholder="000000"
                placeholderTextColor={colors.grey}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
              />
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={handleVerify}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color={colors.background} />
                : <Text style={styles.btnText}>Verify & Enter</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setMode('signup')}>
              <Text style={styles.switchText}>Wrong email? Go back</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── Sign in / Sign up screen ──────────────────────────────────────────────
  const isSignUp = mode === 'signup';

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.inner}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Branding */}
          <View style={styles.brandRow}>
            <ChalkyAvatar size={64} showGlow />
            <Text style={styles.appName}>Chalky</Text>
            <Text style={styles.tagline}>The edge has a name... Chalky.</Text>
          </View>

          {/* Mode tabs */}
          <View style={styles.tabs}>
            <TouchableOpacity
              style={[styles.tab, !isSignUp && styles.tabActive]}
              onPress={() => { setMode('signin'); setError(''); }}
            >
              <Text style={[styles.tabText, !isSignUp && styles.tabTextActive]}>Sign In</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, isSignUp && styles.tabActive]}
              onPress={() => { setMode('signup'); setError(''); }}
            >
              <Text style={[styles.tabText, isSignUp && styles.tabTextActive]}>Create Account</Text>
            </TouchableOpacity>
          </View>

          {/* Fields */}
          <View style={styles.fields}>
            {isSignUp && (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Username</Text>
                <TextInput
                  style={styles.input}
                  value={username}
                  onChangeText={setUsername}
                  placeholder="yourhandle"
                  placeholderTextColor={colors.grey}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.grey}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder={isSignUp ? 'Min. 8 characters' : '••••••••'}
                placeholderTextColor={colors.grey}
                secureTextEntry
              />
            </View>
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={isSignUp ? handleSignUp : handleSignIn}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color={colors.background} />
              : <Text style={styles.btnText}>{isSignUp ? 'Create Account' : 'Sign In'}</Text>
            }
          </TouchableOpacity>

          <Text style={styles.disclaimer}>
            By continuing you agree to Chalky's Terms of Service.{'\n'}
            18+ only. Bet responsibly.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Extracts a readable message from Clerk errors
function clerkErrorMessage(e) {
  if (e?.errors?.[0]?.longMessage) return e.errors[0].longMessage;
  if (e?.errors?.[0]?.message) return e.errors[0].message;
  return 'Something went wrong. Please try again.';
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: { flex: 1 },
  inner: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: 48,
    gap: 20,
  },
  brandRow: {
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  appName: {
    fontSize: 36,
    fontWeight: '900',
    color: colors.offWhite,
    letterSpacing: -1.5,
  },
  tagline: {
    fontSize: 13,
    color: colors.grey,
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 4,
    alignSelf: 'stretch',
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.full,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.offWhite,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.grey,
  },
  tabTextActive: {
    color: colors.background,
  },
  fields: {
    alignSelf: 'stretch',
    gap: 14,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.grey,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: 15,
    color: colors.offWhite,
  },
  codeInput: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 8,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 13,
    color: colors.red,
    textAlign: 'center',
    lineHeight: 18,
  },
  btn: {
    backgroundColor: colors.green,
    borderRadius: radius.full,
    paddingVertical: 16,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.background,
    letterSpacing: 0.2,
  },
  emailHighlight: {
    color: colors.offWhite,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 14,
    color: colors.grey,
    textAlign: 'center',
    lineHeight: 22,
  },
  switchText: {
    fontSize: 13,
    color: colors.grey,
    textDecorationLine: 'underline',
  },
  disclaimer: {
    fontSize: 11,
    color: colors.grey,
    textAlign: 'center',
    lineHeight: 17,
  },
});
