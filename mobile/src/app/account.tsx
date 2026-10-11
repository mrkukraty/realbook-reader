import React, { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { Stack } from 'expo-router';
import { Btn, Card, IconBtn, SectionTitle, useAppTheme } from '@/components/ui';
import { useAccount } from '@/state/account-store';
import { useLibrary } from '@/state/library-store';
import { formatBytes } from '@/storage/library-logic';

export default function AccountScreen() {
  const t = useAppTheme();
  const a = useAccount();
  const books = useLibrary((x) => x.books);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const onDevice = new Set(books.map((b) => b.hash));
  const missing = a.cloud.filter((r) => !onDevice.has(r.hash));

  const input = { borderWidth: 1, borderColor: t.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: t.chromeText, backgroundColor: t.chrome, fontSize: 16, marginBottom: 10 } as const;

  return (
    <ScrollView style={{ backgroundColor: t.chrome }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Account' }} />

      {!a.configured ? (
        <Card>
          <Text style={{ color: t.chromeText, fontWeight: '600', marginBottom: 6 }}>Accounts are not set up in this build</Text>
          <Text style={{ color: t.muted, lineHeight: 20 }}>Your books are stored only on this device. Signing in to reach them from other devices needs the app to be built with an account server.</Text>
        </Card>
      ) : !a.ready ? <ActivityIndicator color={t.accent} style={{ marginTop: 40 }} /> : !a.user ? (
        <>
          <SectionTitle>Sign in</SectionTitle>
          <Card>
            <Text style={{ color: t.muted, lineHeight: 20, marginBottom: 12 }}>Sign in to keep your books in your own private account and open them on any phone or tablet. Without an account everything stays on this device.</Text>
            <TextInput value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={t.muted} style={input}
              autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" autoComplete="email" accessibilityLabel="Email" />
            <TextInput value={password} onChangeText={setPassword} placeholder="Password (at least 6 characters)" placeholderTextColor={t.muted} style={input}
              secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password" autoComplete="password" accessibilityLabel="Password" />
            {a.error ? <Text style={{ color: '#c0392b', marginBottom: 10 }} accessibilityRole="alert">{a.error}</Text> : null}
            {a.notice ? <Text style={{ color: t.accent, marginBottom: 10 }}>{a.notice}</Text> : null}
            <Btn title={a.busy ?? 'Sign in'} icon="log-in-outline" disabled={!!a.busy} onPress={() => { void a.signIn(email, password); }} />
            <Btn title="Create a new account" kind="secondary" icon="person-add-outline" disabled={!!a.busy} style={{ marginTop: 10 }} onPress={() => { void a.signUp(email, password); }} />
          </Card>
        </>
      ) : (
        <>
          <SectionTitle>Signed in</SectionTitle>
          <Card>
            <Text style={{ color: t.chromeText, fontWeight: '600' }}>{a.user.email}</Text>
            <Text style={{ color: t.muted, marginTop: 4, lineHeight: 19 }}>
              {a.busy ?? (a.lastSync ? `${a.cloud.length} book${a.cloud.length === 1 ? '' : 's'} in your account · synced ${new Date(a.lastSync).toLocaleTimeString()}` : 'Not synced yet')}
            </Text>
            {a.error ? <Text style={{ color: '#c0392b', marginTop: 8 }} accessibilityRole="alert">{a.error}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Btn title="Sync now" icon="sync-outline" disabled={!!a.busy} style={{ flex: 1 }} onPress={() => { void a.sync(); }} />
              <Btn title="Sign out" kind="ghost" icon="log-out-outline" style={{ flex: 1 }} onPress={() => Alert.alert('Sign out?', 'The books on this device stay here. Books in your account stay there too.', [
                { text: 'Cancel', style: 'cancel' }, { text: 'Sign out', onPress: () => { void a.signOut(); } },
              ])} />
            </View>
            <Text style={{ color: t.muted, fontSize: 12, lineHeight: 17, marginTop: 10 }}>Books you add on this device are copied to your account automatically, with your reading position. Only you can see them. Bookmarks, highlights and notes stay on each device.</Text>
          </Card>

          {missing.length ? (
            <>
              <SectionTitle>In your account, not on this device</SectionTitle>
              <Card>
                {missing.length > 1 ? <Btn title={`Download all ${missing.length}`} kind="secondary" icon="cloud-download-outline" style={{ marginBottom: 8 }} onPress={() => { void (async () => { for (const r of missing) await a.download(r.hash); })(); }} /> : null}
                {missing.map((r) => (
                  <BookRow key={r.hash} title={r.title || r.file_name} sub={`${r.author ? `${r.author} · ` : ''}${r.format.toUpperCase()} · ${formatBytes(r.size)}`}>
                    {a.downloading.includes(r.hash) ? <ActivityIndicator color={t.accent} style={{ marginHorizontal: 12 }} /> : <IconBtn icon="cloud-download-outline" label={`Download ${r.title || r.file_name}`} onPress={() => { void a.download(r.hash); }} />}
                    <IconBtn icon="trash-outline" label={`Remove ${r.title || r.file_name} from your account`} onPress={() => confirmRemove(r.title || r.file_name, false, () => { void a.removeFromAccount(r.hash); })} />
                  </BookRow>
                ))}
              </Card>
            </>
          ) : null}

          {a.cloud.length > missing.length ? (
            <>
              <SectionTitle>In your account and on this device</SectionTitle>
              <Card>
                {a.cloud.filter((r) => onDevice.has(r.hash)).map((r) => (
                  <BookRow key={r.hash} title={r.title || r.file_name} sub={`${r.author ? `${r.author} · ` : ''}${r.format.toUpperCase()} · ${formatBytes(r.size)}`}>
                    <IconBtn icon="trash-outline" label={`Remove ${r.title || r.file_name} from your account`} onPress={() => confirmRemove(r.title || r.file_name, true, () => { void a.removeFromAccount(r.hash); })} />
                  </BookRow>
                ))}
              </Card>
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

function confirmRemove(title: string, onDevice: boolean, go: () => void) {
  Alert.alert('Remove from your account?', onDevice
    ? `"${title}" stays on this device but will no longer be available on your other devices.`
    : `"${title}" is not on this device. Removing it from your account deletes your only copy here; it cannot be undone.`, [
    { text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: go },
  ]);
}

function BookRow({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  const t = useAppTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.chromeText, fontSize: 15 }} numberOfLines={1}>{title}</Text>
        <Text style={{ color: t.muted, fontSize: 12 }} numberOfLines={1}>{sub}</Text>
      </View>
      {children}
    </View>
  );
}
