/**
 * Firebase Realtime Database 接続設定.
 *
 * 本番運用（複数端末でのリアルタイム同期）を行う場合は、
 * Firebase コンソールで作成したウェブアプリの設定値を下に入力してください。
 * 未設定のまま（apiKey / databaseURL が空）の場合は、
 * 同一ブラウザ内のマルチタブ同期（LocalSync モック）で動作します。
 */
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDJVFKkLvHmAgmQyCZcN_MdywNTmViKmm0",
  authDomain: "k-hug2026.firebaseapp.com",
  databaseURL: "https://k-hug2026-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "k-hug2026",
  storageBucket: "k-hug2026.firebasestorage.app",
  messagingSenderId: "709916039425",
  appId: "1:709916039425:web:bfe6a1f70907313b3aa300"
};

/**
 * Firebase 設定が入力済みかどうかを判定する.
 * @returns {boolean}
 */
export function isFirebaseConfigured() {
  return Boolean(
    FIREBASE_CONFIG &&
      typeof FIREBASE_CONFIG.apiKey === "string" &&
      FIREBASE_CONFIG.apiKey.trim() &&
      typeof FIREBASE_CONFIG.databaseURL === "string" &&
      FIREBASE_CONFIG.databaseURL.trim()
  );
}

