import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyD0vxE5ig-lvRtWbRClLVTFYBipK4k4aNQ",
  authDomain: "streakd-eabb1.firebaseapp.com",
  projectId: "streakd-eabb1",
  storageBucket: "streakd-eabb1.firebasestorage.app",
  messagingSenderId: "671783871741",
  appId: "1:671783871741:web:34f0ec609f94f3714b0a94",
  measurementId: "G-NDMJVHYGGF"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
