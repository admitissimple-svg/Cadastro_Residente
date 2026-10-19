import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  getDocs,
  query,
  orderBy,
  Firestore
} from 'firebase/firestore';
import { Paciente } from '../types/patient';

export const DEFAULT_PROJECT_ID = 'cadastro-de-pacientes-be77f';
const STORAGE_KEY_API_KEY = 'victoria_firebase_api_key';
const STORAGE_KEY_APP_ID = 'victoria_firebase_app_id';
const STORAGE_KEY_AUTH_DOMAIN = 'victoria_firebase_auth_domain';
const STORAGE_KEY_PROJECT_ID = 'victoria_firebase_project_id';

// Clean up any deprecated local storage cache from previous sessions
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem('victoria_lar_pacientes_cache');
    localStorage.removeItem('victoria_lar_custom_logo');
  } catch {}
}

export interface SavedFirebaseConfig {
  apiKey: string;
  projectId: string;
  authDomain: string;
  storageBucket: string;
  appId?: string;
  messagingSenderId?: string;
}

export function getActiveFirebaseConfig(): SavedFirebaseConfig {
  const envApiKey = (import.meta as any).env?.VITE_FIREBASE_API_KEY || '';
  const storedApiKey = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY_API_KEY) || '' : '';
  const apiKey = envApiKey || storedApiKey;

  const envProjectId = (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID || '';
  const storedProjectId = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY_PROJECT_ID) || '' : '';
  const projectId = envProjectId || storedProjectId || DEFAULT_PROJECT_ID;

  const envAuthDomain = (import.meta as any).env?.VITE_FIREBASE_AUTH_DOMAIN || '';
  const storedAuthDomain = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY_AUTH_DOMAIN) || '' : '';
  const authDomain = envAuthDomain || storedAuthDomain || `${projectId}.firebaseapp.com`;

  const envAppId = (import.meta as any).env?.VITE_FIREBASE_APP_ID || '';
  const storedAppId = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY_APP_ID) || '' : '';
  const appId = envAppId || storedAppId || '';

  return {
    apiKey,
    projectId,
    authDomain,
    storageBucket: `${projectId}.firebasestorage.app`,
    appId,
    messagingSenderId: (import.meta as any).env?.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  };
}

let firebaseAppInstance: FirebaseApp | null = null;
let firestoreInstance: Firestore | null = null;

export function initializeFirebase(): { app: FirebaseApp | null; db: Firestore | null; error?: string } {
  const config = getActiveFirebaseConfig();

  if (!config.apiKey || config.apiKey.trim() === '') {
    return {
      app: null,
      db: null,
      error: 'Chave Web API do Firebase não configurada. Configure VITE_FIREBASE_API_KEY nos Secrets ou informe a chave no painel de conexão.',
    };
  }

  try {
    if (getApps().length > 0) {
      firebaseAppInstance = getApp();
    } else {
      firebaseAppInstance = initializeApp({
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        projectId: config.projectId,
        storageBucket: config.storageBucket,
        appId: config.appId || undefined,
        messagingSenderId: config.messagingSenderId || undefined,
      });
    }

    firestoreInstance = getFirestore(firebaseAppInstance);
    return { app: firebaseAppInstance, db: firestoreInstance };
  } catch (err: any) {
    console.error('Erro ao inicializar Firebase:', err);
    return {
      app: null,
      db: null,
      error: err?.message || 'Falha ao conectar ao Firebase.',
    };
  }
}

export function saveUserCredentials(apiKey: string, appId?: string, projectId?: string) {
  if (typeof window !== 'undefined') {
    if (apiKey) localStorage.setItem(STORAGE_KEY_API_KEY, apiKey.trim());
    if (appId) localStorage.setItem(STORAGE_KEY_APP_ID, appId.trim());
    if (projectId) localStorage.setItem(STORAGE_KEY_PROJECT_ID, projectId.trim());
    firebaseAppInstance = null;
    firestoreInstance = null;
  }
}

export function clearUserCredentials() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY_API_KEY);
    localStorage.removeItem(STORAGE_KEY_APP_ID);
    localStorage.removeItem(STORAGE_KEY_PROJECT_ID);
    localStorage.removeItem(STORAGE_KEY_AUTH_DOMAIN);
    firebaseAppInstance = null;
    firestoreInstance = null;
  }
}

// DIRECT FIRESTORE CRUD ONLY — ZERO LOCAL STORAGE FOR PATIENTS
export async function cadastrarPacienteNoFirebase(paciente: Omit<Paciente, 'id'>): Promise<{ id: string }> {
  const timestamp = new Date().toISOString();
  const pacienteCompleto = {
    ...paciente,
    criadoEm: timestamp,
    atualizadoEm: timestamp,
  };

  const { db, error } = initializeFirebase();

  if (!db || error) {
    throw new Error(
      error || 'Firebase não conectado. Configure a Chave de API para salvar no banco de dados Firestore da Victoria Lar.'
    );
  }

  const colRef = collection(db, 'pacientes');
  const docRef = await addDoc(colRef, pacienteCompleto);
  return { id: docRef.id };
}

export async function atualizarPacienteNoFirebase(id: string, dados: Partial<Paciente>): Promise<boolean> {
  const { db, error } = initializeFirebase();

  if (!db || error) {
    throw new Error(error || 'Firebase não conectado.');
  }

  const timestamp = new Date().toISOString();
  const dadosAtualizados = {
    ...dados,
    atualizadoEm: timestamp,
  };

  const docRef = doc(db, 'pacientes', id);
  await updateDoc(docRef, dadosAtualizados);
  return true;
}

export async function excluirPacienteNoFirebase(id: string): Promise<boolean> {
  const { db, error } = initializeFirebase();

  if (!db || error) {
    throw new Error(error || 'Firebase não conectado.');
  }

  const docRef = doc(db, 'pacientes', id);
  await deleteDoc(docRef);
  return true;
}

// REALTIME LISTENER DIRECTLY FROM FIRESTORE
export function ouvirPacientes(
  onUpdate: (pacientes: Paciente[], isOnline: boolean) => void,
  onError?: (error: string) => void
): () => void {
  const { db, error } = initializeFirebase();

  if (!db || error) {
    onUpdate([], false);
    if (error && onError) onError(error);
    return () => {};
  }

  try {
    const colRef = collection(db, 'pacientes');
    const q = query(colRef, orderBy('criadoEm', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const pacientes: Paciente[] = [];
        snapshot.forEach((docSnapshot) => {
          pacientes.push({
            id: docSnapshot.id,
            ...(docSnapshot.data() as Omit<Paciente, 'id'>),
          });
        });

        onUpdate(pacientes, true);
      },
      (snapshotError) => {
        console.error('Erro ao escutar Firestore:', snapshotError);
        onUpdate([], false);
        if (onError) onError(snapshotError.message);
      }
    );

    return unsubscribe;
  } catch (err: any) {
    onUpdate([], false);
    if (onError) onError(err?.message || 'Erro inesperado.');
    return () => {};
  }
}

// Test connection
export async function testarConexaoFirestore(): Promise<{ ok: boolean; message: string; count?: number }> {
  const { db, error } = initializeFirebase();
  if (!db || error) {
    return { ok: false, message: error || 'Firebase não configurado.' };
  }

  try {
    const colRef = collection(db, 'pacientes');
    const snap = await getDocs(colRef);
    return {
      ok: true,
      message: `Conexão bem-sucedida com o projeto ${DEFAULT_PROJECT_ID}. ${snap.size} registros lidos diretamente da coleção 'pacientes' no Firestore.`,
      count: snap.size,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: err?.message || 'Falha ao consultar coleção no Firestore.',
    };
  }
}
