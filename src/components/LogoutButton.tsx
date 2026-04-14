'use client';

import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { LogOut } from 'lucide-react';
import { auth } from '@/src/lib/firebase';

export default function LogoutButton() {
  const router = useRouter();

  const handleLogout = async () => {
  try {
    await signOut(auth);
    // Видаляємо куку
    document.cookie = "session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    // ПОВНЕ ПЕРЕЗАВАНТАЖЕННЯ
    window.location.href = '/login';
  } catch (error) {
    console.error('Logout error:', error);
  }
};

  return (
    <button
      onClick={handleLogout}
      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
    >
      <LogOut className="h-4 w-4" />
      <span>Logout</span>
    </button>
  );
}
