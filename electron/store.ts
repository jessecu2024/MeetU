// ============================================================
// Encrypted Settings Store (electron-store)
// API Keys are encrypted at rest. Other settings are plain JSON.
// ============================================================

import Store from 'electron-store';
import { safeStorage } from 'electron';

interface StoreSchema {
  legalAccepted: boolean;
  isFirstLaunch: boolean;
  userRegion: 'global' | 'china' | null;
  aiConfig: {
    defaultProvider: string;
    functionOverrides: Record<string, string>;
    selectedModels: Record<string, string>;
  };
  sttEngine: string;
  userProfile: {
    name: string;
    nameEn: string;
    aliases: string[];
    role: string;
    preferredLanguage: string;
  };
  appSettings: {
    theme: string;
    windowOpacity: number;
    windowAlwaysOnTop: boolean;
    fontSize: string;
    autoStartRecording: boolean;
    summaryIntervalMinutes: number;
    audioRetentionDays: number;
  };
  customTerms: Array<{ source: string; target: string }>;
  // Encrypted API keys stored as base64 buffers
  encryptedApiKeys: Record<string, string>;
  encryptedSttApiKeys: Record<string, string>;
}

const store = new Store<StoreSchema>({
  name: 'meetu-settings',
  defaults: {
    legalAccepted: false,
    isFirstLaunch: true,
    userRegion: null,
    aiConfig: {
      defaultProvider: 'claude',
      functionOverrides: {},
      selectedModels: {},
    },
    sttEngine: 'deepgram',
    userProfile: {
      name: '',
      nameEn: '',
      aliases: [],
      role: '',
      preferredLanguage: 'zh',
    },
    appSettings: {
      theme: 'system',
      windowOpacity: 0.95,
      windowAlwaysOnTop: true,
      fontSize: 'medium',
      autoStartRecording: false,
      summaryIntervalMinutes: 5,
      audioRetentionDays: 30,
    },
    customTerms: [],
    encryptedApiKeys: {},
    encryptedSttApiKeys: {},
  },
});

/** Encrypt a string using Electron's safeStorage (OS-level encryption) */
function encryptString(value: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    const buffer = safeStorage.encryptString(value);
    return buffer.toString('base64');
  }
  // Fallback: base64 encoding (not truly encrypted, but better than plaintext)
  return Buffer.from(value).toString('base64');
}

/** Decrypt a base64-encoded encrypted string */
function decryptString(encrypted: string): string {
  const buffer = Buffer.from(encrypted, 'base64');
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(buffer);
  }
  return buffer.toString('utf-8');
}

// ── Public API ──

export function getSetting(key: string): unknown {
  if (key === 'apiKeys') {
    return getDecryptedApiKeys();
  }
  if (key === 'sttApiKeys') {
    return getDecryptedSttApiKeys();
  }
  if (key === 'all') {
    return getAllSettings();
  }
  return store.get(key as keyof StoreSchema);
}

export function setSetting(key: string, value: unknown): void {
  if (key === 'apiKey') {
    const { provider, apiKey } = value as { provider: string; apiKey: string };
    setEncryptedApiKey(provider, apiKey);
    return;
  }
  if (key === 'sttApiKey') {
    const { engine, apiKey } = value as { engine: string; apiKey: string };
    setEncryptedSttApiKey(engine, apiKey);
    return;
  }
  store.set(key as keyof StoreSchema, value as never);
}

function setEncryptedApiKey(provider: string, apiKey: string): void {
  const keys = store.get('encryptedApiKeys', {});
  if (apiKey) {
    keys[provider] = encryptString(apiKey);
  } else {
    delete keys[provider];
  }
  store.set('encryptedApiKeys', keys);
}

function setEncryptedSttApiKey(engine: string, apiKey: string): void {
  const keys = store.get('encryptedSttApiKeys', {});
  if (apiKey) {
    keys[engine] = encryptString(apiKey);
  } else {
    delete keys[engine];
  }
  store.set('encryptedSttApiKeys', keys);
}

function getDecryptedApiKeys(): Record<string, string> {
  const encrypted = store.get('encryptedApiKeys', {});
  const result: Record<string, string> = {};
  for (const [provider, enc] of Object.entries(encrypted)) {
    try {
      result[provider] = decryptString(enc);
    } catch {
      // Skip corrupted entries
    }
  }
  return result;
}

function getDecryptedSttApiKeys(): Record<string, string> {
  const encrypted = store.get('encryptedSttApiKeys', {});
  const result: Record<string, string> = {};
  for (const [engine, enc] of Object.entries(encrypted)) {
    try {
      result[engine] = decryptString(enc);
    } catch {
      // Skip corrupted entries
    }
  }
  return result;
}

function getAllSettings() {
  return {
    legalAccepted: store.get('legalAccepted'),
    isFirstLaunch: store.get('isFirstLaunch'),
    userRegion: store.get('userRegion'),
    aiConfig: {
      ...store.get('aiConfig'),
      apiKeys: getDecryptedApiKeys(),
    },
    sttEngine: store.get('sttEngine'),
    sttApiKeys: getDecryptedSttApiKeys(),
    userProfile: store.get('userProfile'),
    appSettings: store.get('appSettings'),
    customTerms: store.get('customTerms'),
  };
}

export default store;
