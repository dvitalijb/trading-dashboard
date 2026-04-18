'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, writeBatch, collection, getDocs, addDoc } from 'firebase/firestore';
import { auth, db } from '@/src/lib/firebase';
import LogoutButton from '@/src/components/LogoutButton';
import { 
  FileCode, 
  Save, 
  AlertCircle, 
  CheckCircle2,
  RefreshCw,
  TrendingUp,
  Target,
  Plus,
  Trash2,
  Sparkles,
  ShieldAlert,
  Activity,
  BarChart3,
  TrendingUpIcon,
  PieChart,
  X,
  MoreHorizontal
} from 'lucide-react';

interface Trade {
  position_id: number;
  symbol: string;
  type: string;
  entry_price: number;
  exit_price: number;
  profit: number;
  commission: number;
  swap: number;
  net_profit: number;
  entry_time: number;
  exit_time: number;
  volume: number;
  ticket?: number;
  magic?: number;
  comment?: string;
  accountName?: string;
}

interface Account {
  id: string;
  name: string;
}

interface AccountInfo {
  account: number;
  count: number;
}

interface Metrics {
  totalNetProfit: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  expectedPayoff: number;
  recoveryFactor: number;
  sharpeRatio: number;
  maximalDrawdown: number;
  maximalDrawdownPercent: number;
  totalTrades: number;
  shortTrades: number;
  shortWonPercent: number;
  longTrades: number;
  longWonPercent: number;
}

const formatDate = (timestamp: number): string => {
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const parseHTMLFile = (content: string) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/html');

  const allRows = Array.from(doc.querySelectorAll('tr'));
  let startIdx = -1;
  let endIdx = allRows.length;

  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    const bTags = row.querySelectorAll('b');
    for (const b of bTags) {
      const bText = b.textContent?.trim().toLowerCase() || '';
      if (bText.includes('positions') && startIdx === -1) {
        startIdx = i;
      } else if (bText.includes('orders') && startIdx !== -1) {
        endIdx = i;
        break;
      }
    }
    if (startIdx !== -1 && endIdx !== allRows.length) break;
  }

  if (startIdx === -1) {
    throw new Error('Could not find Positions section in the HTML file');
  }

  const rows = allRows.slice(startIdx, endIdx);

  const parseNumber = (numStr: string): number => {
    if (!numStr) return 0;
    let cleaned = numStr.replace(/&nbsp;/g, '').replace(/\s/g, '');
    cleaned = cleaned.replace(/[^0-9.-]/g, '').replace(',', '.');
    const parsed = parseFloat(cleaned);
    const rounded = Math.round((parsed + Number.EPSILON) * 100) / 100;
    return isNaN(rounded) ? 0 : rounded;
  };

  const parseTime = (timeStr: string): number => {
    if (!timeStr) return Date.now() / 1000;
    try {
      let dateStr = timeStr.replace(/&nbsp;/g, '').trim();
      dateStr = dateStr.replace(/\./g, '-');
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return Math.floor(date.getTime() / 1000);
      }
    } catch {
    }
    return Date.now() / 1000;
  };

  const parseType = (typeStr: string): string => {
    const s = typeStr.toLowerCase().trim();
    if (s.includes('buy') || s.includes('купити') || s === '0') return 'buy';
    if (s.includes('sell') || s.includes('продати') || s === '1') return 'sell';
    return s;
  };

  const trades: Trade[] = [];

  for (let i = 2; i < rows.length; i++) {
    const cells = Array.from(rows[i].querySelectorAll('td'))
  .filter(cell => {
    const isHidden = cell.classList.contains('hidden');
    const isSpacer = cell.getAttribute('colspan') === '8' && !cell.textContent?.trim();
    return !isHidden && !isSpacer;
  })
  .map(cell => cell.textContent?.trim() || '');

    if (cells.length < 13) continue;

    const positionIdStr = cells[1]?.replace(/&nbsp;/g, '').trim() || '';
    const positionId = parseNumber(positionIdStr);

    if (positionId === 0 && !positionIdStr.includes('0')) continue;

    const profit = parseNumber(cells[12]);
    const commission = parseNumber(cells[10]);
    const swap = parseNumber(cells[11]);
    const netProfit = profit + commission + swap;

    const trade: Trade = {
      position_id: positionId,
      symbol: cells[2]?.replace(/&nbsp;/g, '').trim() || '',
      type: parseType(cells[3]),
      volume: parseNumber(cells[4]),
      entry_price: parseNumber(cells[5]),
      exit_price: parseNumber(cells[9]),
      profit: profit,
      commission: commission,
      swap: swap,
      net_profit: netProfit,
      entry_time: parseTime(cells[0]),
      exit_time: parseTime(cells[8]),
      ticket: positionId
    };

    if (!trade.symbol) continue;

    trades.push(trade);
  }

  console.log('Parsed Positions:', trades);
  console.log('Number of trades:', trades.length);

  let metrics: Metrics = {
    totalNetProfit: 0,
    grossProfit: 0,
    grossLoss: 0,
    profitFactor: 0,
    expectedPayoff: 0,
    recoveryFactor: 0,
    sharpeRatio: 0,
    maximalDrawdown: 0,
    maximalDrawdownPercent: 0,
    totalTrades: trades.length,
    shortTrades: 0,
    shortWonPercent: 0,
    longTrades: 0,
    longWonPercent: 0
  };

  const tables = Array.from(doc.querySelectorAll('table'));
  for (const table of tables) {
    const text = table.textContent?.toLowerCase() || '';
    if (text.includes('total net profit')) {
      const metricRows = Array.from(table.querySelectorAll('tr'));
      for (const row of metricRows) {
        const cells = Array.from(row.querySelectorAll('td, th')).map(cell => cell.textContent?.trim() || '');
        const rowText = cells.join(' ').toLowerCase();

        if (rowText.includes('total net profit')) {
          metrics.totalNetProfit = parseNumber(cells[cells.length - 1] || cells[1] || '0');
        } else if (rowText.includes('gross profit') && !rowText.includes('loss')) {
          metrics.grossProfit = parseNumber(cells[cells.length - 1] || cells[1] || '0');
        } else if (rowText.includes('gross loss')) {
          metrics.grossLoss = parseNumber(cells[cells.length - 1] || cells[1] || '0');
        } else if (rowText.includes('profit factor')) {
          metrics.profitFactor = parseNumber(cells[cells.length - 1] || cells[1] || '0');
        } else if (rowText.includes('expected payoff')) {
          metrics.expectedPayoff = parseNumber(cells[cells.length - 1] || cells[1] || '0');
        } else if (rowText.includes('recovery factor')) {
          metrics.recoveryFactor = parseNumber(cells[cells.length - 1] || cells[1] || '0');
        } else if (rowText.includes('sharpe ratio')) {
          metrics.sharpeRatio = parseNumber(cells[cells.length - 1] || cells[1] || '0');
        } else if (rowText.includes('maximal drawdown') && !rowText.includes('percent')) {
          metrics.maximalDrawdown = parseNumber(cells[cells.length - 1] || cells[1] || '0');
        } else if (rowText.includes('maximal drawdown') && (rowText.includes('%') || rowText.includes('percent'))) {
          metrics.maximalDrawdownPercent = parseNumber(cells[cells.length - 1] || cells[1] || '0');
        // } else if (rowText.includes('total trades')) {
        //   metrics.totalTrades = parseNumber(cells[cells.length - 1] || cells[1] || '0');
        } else if (rowText.includes('short trades')) {
          metrics.shortTrades = parseNumber(cells[cells.length - 1] || cells[1] || '0');
        } else if (rowText.includes('short won') || rowText.includes('short %')) {
          metrics.shortWonPercent = parseNumber(cells[cells.length - 1] || cells[1] || '0');
        } else if (rowText.includes('long trades')) {
          metrics.longTrades = parseNumber(cells[cells.length - 1] || cells[1] || '0');
        } else if (rowText.includes('long won') || rowText.includes('long %')) {
          metrics.longWonPercent = parseNumber(cells[cells.length - 1] || cells[1] || '0');
        }
      }
      break;
    }
  }

  return { trades, metrics };
};

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currentAccount, setCurrentAccount] = useState<Account | null>(null);
  const [showNewAccountModal, setShowNewAccountModal] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [processing, setProcessing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [status, setStatus] = useState('');
  const router = useRouter();

  const loadAccounts = useCallback(async (userId: string) => {
    try {
      const accountsCol = collection(db, 'users', userId, 'accounts');
      const snapshot = await getDocs(accountsCol);
      const accountList: Account[] = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name
      }));
      setAccounts(accountList);
      if (accountList.length > 0) {
        setCurrentAccount(accountList[0]);
      }
    } catch (err) {
      console.error('Error loading accounts:', err);
    }
  }, []);

  const loadAccountData = useCallback(async (userId: string, account: Account) => {
    try {
      const docRef = doc(db, 'users', userId, 'accounts', account.id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.trades) {
          setTrades(data.trades);
        }
        if (data.metrics) {
          setMetrics(data.metrics);
        }
        setStatus(`Showing ${account.name}`);
      } else {
        setTrades([]);
        setMetrics(null);
        setStatus(`Showing ${account.name} (no data yet)`);
      }
    } catch (err) {
      console.error('Error loading account data:', err);
      setError('Failed to load account data');
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        router.push('/login');
        return;
      }
      setUser(currentUser);
      await loadAccounts(currentUser.uid);
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, [router, loadAccounts]);

  useEffect(() => {
    if (user && currentAccount) {
      loadAccountData(user.uid, currentAccount);
    }
  }, [user, currentAccount, loadAccountData]);

  const handleCreateAccount = async () => {
    if (!user || !newAccountName.trim()) return;
    try {
      const accountsCol = collection(db, 'users', user.uid, 'accounts');
      const docRef = await addDoc(accountsCol, {
        name: newAccountName.trim()
      });
      const newAccount: Account = {
        id: docRef.id,
        name: newAccountName.trim()
      };
      setAccounts([...accounts, newAccount]);
      setCurrentAccount(newAccount);
      setShowNewAccountModal(false);
      setNewAccountName('');
      setSuccess('Account created successfully!');
    } catch (err) {
      console.error('Error creating account:', err);
      setError('Failed to create account');
    }
  };

  const handleFileUpload = useCallback((file: File) => {
    if (!currentAccount) {
      setError('Please select or create an account first');
      return;
    }
    if (!file.name.toLowerCase().endsWith('.html') && !file.name.toLowerCase().endsWith('.htm')) {
      setError('Please upload a valid HTML file');
      return;
    }

    setProcessing(true);
    setError('');
    setSuccess('');
    setStatus('');

    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const { trades: parsedTrades, metrics: parsedMetrics } = parseHTMLFile(content);
        
        if (parsedTrades.length === 0) {
          throw new Error('No trades found in the file');
        }

        const tradesWithAccount = parsedTrades.map(t => ({
          ...t,
          accountName: currentAccount.name
        }));

        if (!user) return;
        const docRef = doc(db, 'users', user.uid, 'accounts', currentAccount.id);
        
        await setDoc(docRef, {
          name: currentAccount.name,
          trades: tradesWithAccount,
          metrics: parsedMetrics,
          updatedAt: new Date()
        });

        setTrades(tradesWithAccount);
        setMetrics(parsedMetrics);
        setSuccess(`Successfully imported ${parsedTrades.length} trades!`);
        setStatus(`Showing ${currentAccount.name}`);
        setProcessing(false);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'An error occurred');
        setProcessing(false);
      }
    };

    reader.onerror = () => {
      setError('Failed to read file');
      setProcessing(false);
    };

    reader.readAsText(file);
  }, [currentAccount, user]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  }, [handleFileUpload]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  }, [handleFileUpload]);

  const handleRowClick = (trade: Trade) => {
    localStorage.setItem('selectedTrade', JSON.stringify(trade));
    window.open(`/trade/${trade.position_id}`, '_blank');
  };

  const { newTrades, existingTradesCount, newTradesCount } = useMemo(() => ({
    newTrades: [], existingTradesCount: 0, newTradesCount: 0
  }), []);

  const combinedTrades = useMemo(() => trades, [trades]);

  const fileLoaded = trades.length > 0;
  const hasSavedData = trades.length > 0;
  const displayTrades = combinedTrades;

  const displayMetrics = useMemo(() => {
    if (!metrics) return null;
    return {
      totalNetProfit: metrics.totalNetProfit ?? 0,
      grossProfit: metrics.grossProfit ?? 0,
      grossLoss: metrics.grossLoss ?? 0,
      profitFactor: metrics.profitFactor ?? 0,
      expectedPayoff: metrics.expectedPayoff ?? 0,
      recoveryFactor: metrics.recoveryFactor ?? 0,
      sharpeRatio: metrics.sharpeRatio ?? 0,
      maximalDrawdown: metrics.maximalDrawdown ?? 0,
      maximalDrawdownPercent: metrics.maximalDrawdownPercent ?? 0,
      totalTrades: metrics.totalTrades ?? 0,
      shortTrades: metrics.shortTrades ?? 0,
      shortWonPercent: metrics.shortWonPercent ?? 0,
      longTrades: metrics.longTrades ?? 0,
      longWonPercent: metrics.longWonPercent ?? 0,
    };
  }, [metrics]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-700 border-t-emerald-500" />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-slate-100 font-sans">
      <header className="flex items-center justify-between px-8 py-5 border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-emerald-400 tracking-tight">Trading Journal</h1>
          
          {accounts.length > 0 ? (
            <div className="flex items-center gap-3">
              <select
                value={currentAccount?.id || ''}
                onChange={(e) => {
                  const selected = accounts.find(a => a.id === e.target.value);
                  if (selected) setCurrentAccount(selected);
                }}
                className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {accounts.map(account => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </select>
              <button
                onClick={() => document.getElementById('file-upload-update')?.click()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium flex items-center gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Update History
              </button>
              <button
                onClick={() => setShowNewAccountModal(true)}
                className="p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowNewAccountModal(true)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-medium"
            >
              Create your first account
            </button>
          )}

          {status && (
            <span className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-sm font-medium">
              {status}
            </span>
          )}
        </div>

        <input
          type="file"
          accept=".html,.htm"
          onChange={handleFileSelect}
          className="hidden"
          id="file-upload-update"
        />

        <div className="flex items-center gap-4">
          {user && (
            <span className="text-sm font-medium text-slate-400 px-3 py-1.5 rounded-full bg-slate-800 border border-slate-700">
              {user.email}
            </span>
          )}
          <LogoutButton />
        </div>
      </header>

      <main className="flex-1 p-8">
        <div className="max-w-7xl mx-auto space-y-8">
          {/* Stats Cards */}
          {(hasSavedData) && displayMetrics && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {/* Net Profit */}
                <div className="p-4 rounded-xl border border-slate-800 bg-slate-900 shadow-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="h-4 w-4 text-emerald-400" />
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Net Profit</span>
                  </div>
                  <p className={`text-2xl font-bold font-mono ${displayMetrics.totalNetProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {displayMetrics.totalNetProfit >= 0 ? '+' : ''}{displayMetrics.totalNetProfit.toFixed(2)}
                  </p>
                </div>

                {/* Profit Factor */}
                <div className="p-4 rounded-xl border border-slate-800 bg-slate-900 shadow-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="h-4 w-4 text-blue-400" />
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Profit Factor</span>
                  </div>
                  <p className={`text-2xl font-bold font-mono ${displayMetrics.profitFactor > 1 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {displayMetrics.profitFactor.toFixed(2)}
                  </p>
                </div>

                {/* Expected Payoff */}
                <div className="p-4 rounded-xl border border-slate-800 bg-slate-900 shadow-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="h-4 w-4 text-purple-400" />
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Expected Payoff</span>
                  </div>
                  <p className={`text-2xl font-bold font-mono ${displayMetrics.expectedPayoff > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {displayMetrics.expectedPayoff >= 0 ? '+' : ''}{displayMetrics.expectedPayoff.toFixed(2)}
                  </p>
                </div>

                {/* Recovery Factor */}
                <div className="p-4 rounded-xl border border-slate-800 bg-slate-900 shadow-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUpIcon className="h-4 w-4 text-amber-400" />
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Recovery Factor</span>
                  </div>
                  <p className="text-2xl font-bold font-mono text-amber-400">
                    {displayMetrics.recoveryFactor.toFixed(2)}
                  </p>
                </div>

                {/* Sharpe Ratio */}
                <div className="p-4 rounded-xl border border-slate-800 bg-slate-900 shadow-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 className="h-4 w-4 text-cyan-400" />
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Sharpe Ratio</span>
                  </div>
                  <p className="text-2xl font-bold font-mono text-cyan-400">
                    {displayMetrics.sharpeRatio.toFixed(2)}
                  </p>
                </div>

                {/* Maximal Drawdown */}
                <div className="p-4 rounded-xl border border-slate-800 bg-slate-900 shadow-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldAlert className="h-4 w-4 text-rose-400" />
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Max Drawdown</span>
                  </div>
                  <p className="text-2xl font-bold font-mono text-rose-400">
                    {displayMetrics.maximalDrawdown.toFixed(2)}
                    <span className="text-xs text-slate-500 ml-1">
                      ({displayMetrics.maximalDrawdownPercent.toFixed(2)}%)
                    </span>
                  </p>
                </div>
              </div>

              {/* Trade Distribution */}
              <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/70 shadow-lg">
                <div className="flex items-center gap-2 mb-4">
                  <PieChart className="h-5 w-5 text-slate-400" />
                  <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Trade Distribution</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-lg bg-slate-800">
                    <span className="text-xs text-slate-500 uppercase tracking-wider">Total Trades</span>
                    <p className="text-2xl font-bold font-mono text-slate-200">
                      {displayMetrics.totalTrades}
                    </p>
                  </div>
                  <div className="p-4 rounded-lg bg-slate-800">
                    <span className="text-xs text-slate-500 uppercase tracking-wider">Short Won</span>
                    <p className="text-2xl font-bold font-mono text-amber-400">
                      {displayMetrics.shortTrades}
                      <span className="text-sm text-slate-500 ml-1">
                        ({displayMetrics.shortWonPercent}%)
                      </span>
                    </p>
                  </div>
                  <div className="p-4 rounded-lg bg-slate-800">
                    <span className="text-xs text-slate-500 uppercase tracking-wider">Long Won</span>
                    <p className="text-2xl font-bold font-mono text-emerald-400">
                      {displayMetrics.longTrades}
                      <span className="text-sm text-slate-500 ml-1">
                        ({displayMetrics.longWonPercent}%)
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Upload / File Controls */}
          {(!hasSavedData && currentAccount) && (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              className="border-2 border-dashed border-slate-700 rounded-2xl p-12 bg-slate-900/30 hover:border-emerald-500/50 transition-colors cursor-pointer"
            >
              <div className="flex flex-col items-center gap-4">
                <FileCode className="h-12 w-12 text-slate-500" />
                <div className="text-center">
                  <p className="text-lg font-medium text-slate-300">Please upload your MT5 HTML report to see the statistics</p>
                  <p className="text-sm text-slate-500 mt-2">Drag & drop file or click to browse</p>
                </div>
                <input
                  type="file"
                  accept=".html,.htm"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="file-upload"
                />
                <label
                  htmlFor="file-upload"
                  className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors"
                >
                  Select File
                </label>
              </div>
            </div>
          )}

          {/* Error and Success */}
          {error && (
            <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-rose-400" />
              <span className="text-rose-200">{error}</span>
            </div>
          )}

          {success && (
            <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              <span className="text-emerald-200">{success}</span>
            </div>
          )}

          {/* Trades Table */}
          {(hasSavedData) && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-900/80 border-b border-slate-800">
                    <tr>
                      <th className="text-left py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Position ID
                      </th>
                      <th className="text-left py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Time (Open)
                      </th>
                      <th className="text-left py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Time (Close)
                      </th>
                      <th className="text-left py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Symbol
                      </th>
                      <th className="text-left py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Type
                      </th>
                      <th className="text-left py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Volume
                      </th>
                      <th className="text-left py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Entry Price
                      </th>
                      <th className="text-left py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Exit Price
                      </th>
                      <th className="text-left py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Commission
                      </th>
                      <th className="text-left py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Swap
                      </th>
                      <th className="text-left py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Net Profit
                      </th>
                      <th className="text-left py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Profit
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {displayTrades.map((trade) => (
                      <tr
                        key={trade.position_id}
                        onClick={() => handleRowClick(trade)}
                        className="cursor-pointer hover:bg-slate-800/50 transition-colors"
                      >
                        <td className="py-4 px-6 font-mono text-slate-300">
                          {trade.position_id}
                        </td>
                        <td className="py-4 px-6 text-slate-300">
                          {formatDate(trade.entry_time)}
                        </td>
                        <td className="py-4 px-6 text-slate-300">
                          {formatDate(trade.exit_time)}
                        </td>
                        <td className="py-4 px-6 font-mono text-slate-200">
                          {trade.symbol}
                        </td>
                        <td className="py-4 px-6">
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${
                            trade.type.toLowerCase().includes('buy')
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-rose-500/10 text-rose-400'
                          }`}>
                            {trade.type.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-4 px-6 font-mono text-slate-200">
                          {trade.volume}
                        </td>
                        <td className="py-4 px-6 font-mono text-slate-200">
                          {trade.entry_price.toFixed(2)}
                        </td>
                        <td className="py-4 px-6 font-mono text-slate-200">
                          {trade.exit_price.toFixed(2)}
                        </td>
                        <td className="py-4 px-6 font-mono text-xs text-slate-500">
                          {trade.commission.toFixed(2)}
                        </td>
                        <td className="py-4 px-6 font-mono text-xs text-slate-500">
                          {trade.swap.toFixed(2)}
                        </td>
                        <td className="py-4 px-6">
                          <span className={`font-mono font-bold text-sm ${
                            trade.net_profit < 0 ? 'text-rose-400' : 'text-emerald-400'
                          }`}>
                            {trade.net_profit >= 0 ? '+' : ''}{trade.net_profit.toFixed(2)}
                          </span>
                        </td>
                        <td className="py-4 px-6">
                          <span className={`font-mono font-bold ${
                            trade.profit < 0 ? 'text-rose-400' : 'text-emerald-400'
                          }`}>
                            {trade.profit >= 0 ? '+' : ''}{trade.profit.toFixed(2)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* New Account Modal */}
      {showNewAccountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold">Create New Account</h3>
              <button
                onClick={() => setShowNewAccountModal(false)}
                className="p-2 hover:bg-slate-800 rounded-lg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-2">Account Name</label>
                <input
                  type="text"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  placeholder="e.g., FTMO Challenge #1"
                  className="w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setShowNewAccountModal(false)}
                  className="flex-1 px-4 py-3 border border-slate-700 hover:border-slate-600 text-slate-300 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateAccount}
                  disabled={!newAccountName.trim() || uploading}
                  className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg transition-colors"
                >
                  Create Account
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
