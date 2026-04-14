'use client';

import LogoutButton from '@/src/components/LogoutButton';

export default function DashboardPage() {
  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
        <h1 className="text-xl font-bold text-emerald-400">Trading Dashboard</h1>
        <LogoutButton />
      </header>
      <main className="flex-1 p-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl font-semibold mb-4">Welcome to your Dashboard</h2>
          <p className="text-slate-400">Your trading tools and history will appear here.</p>
        </div>
      </main>
    </div>
  );
}
